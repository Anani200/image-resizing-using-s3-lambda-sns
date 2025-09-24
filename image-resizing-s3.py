"""Stylize uploaded images into cartoons or colorized versions and notify SNS."""

from __future__ import annotations

import logging
from io import BytesIO
from typing import Optional, Tuple

import boto3
from botocore.exceptions import ClientError
from PIL import Image, ImageChops, ImageEnhance, ImageFile, ImageFilter, ImageOps

# Allow Pillow to load truncated images instead of raising an exception. Lambda
# functions often process images that may be partially uploaded when the event
# fires. Pillow recommends enabling this flag in such environments.
ImageFile.LOAD_TRUNCATED_IMAGES = True

logger = logging.getLogger(__name__)

# Initialize AWS clients once so that Lambda can reuse connections between
# invocations. This reduces cold-start latency and improves overall throughput.
s3 = boto3.client("s3")
sns = boto3.client("sns")

# Define the S3 buckets and SNS topic
SOURCE_BUCKET = "image-non-sized-1"  # your-source-bucket
DESTINATION_BUCKET = "image-sized-1"  # your-destination-bucket
SNS_TOPIC_ARN = "arn:aws:sns:ap-south-1:804937851364:image-resizing-topic"  # your-sns-topic

# Maximum size for the longest image edge. Images smaller than the constraint
# keep their original dimensions.
MAX_DIMENSION = (1280, 1280)


def lambda_handler(event, context):  # pylint: disable=unused-argument
    """Entry point for the Lambda function."""

    records = event.get("Records") if isinstance(event, dict) else None
    if not records:
        records = [event]

    for record in records:
        try:
            source_bucket, object_key = _extract_s3_info(record)
        except ValueError as exc:  # pragma: no cover - defensive guard
            logger.error("Unable to parse S3 event record: %s", exc)
            continue

        if SOURCE_BUCKET and source_bucket != SOURCE_BUCKET:
            logger.info(
                "Skipping object %s from unexpected bucket %s", object_key, source_bucket
            )
            continue

        try:
            image_bytes, content_type = _download_s3_object(source_bucket, object_key)
        except ClientError:
            logger.exception("Failed to download %s from %s", object_key, source_bucket)
            continue

        try:
            stylized_bytes, output_content_type, transformation = stylize_image(
                image_bytes,
                source_content_type=content_type,
            )
        except OSError as exc:  # pragma: no cover - guard for unsupported images
            logger.exception("Failed to process image %s: %s", object_key, exc)
            continue

        destination_key = f"stylized/{object_key}"

        _upload_stylized_image(destination_key, stylized_bytes, output_content_type)
        _publish_stylize_notification(object_key, destination_key, transformation)


def _extract_s3_info(record: dict) -> Tuple[str, str]:
    """Extract the S3 bucket name and object key from an event record."""

    if not isinstance(record, dict):
        raise ValueError("Record is not a dictionary")

    s3_info = record.get("s3") or {}
    bucket_info = s3_info.get("bucket") or {}
    object_info = s3_info.get("object") or {}

    bucket_name = bucket_info.get("name")
    object_key = object_info.get("key")

    if not bucket_name or not object_key:
        raise ValueError("Missing S3 bucket name or object key")

    return bucket_name, object_key


def _download_s3_object(bucket: str, key: str) -> Tuple[bytes, str]:
    """Download an object from S3 and return its bytes and content type."""

    response = s3.get_object(Bucket=bucket, Key=key)
    body = response["Body"].read()
    content_type = response.get("ContentType", "application/octet-stream")
    return body, content_type


def stylize_image(
    image_data: bytes,
    *,
    source_content_type: Optional[str] = None,
    quality: int = 80,
    max_dimension: Tuple[int, int] = MAX_DIMENSION,
) -> Tuple[bytes, str, str]:
    """Transform an image into a cartoon or colorized rendition.

    The function analyses the input image to determine whether it is grayscale
    or colored. Grayscale photos are colorized using a warm/cool duotone palette
    while colored photos receive a stylized cartoon treatment. The longest edge
    is constrained by ``max_dimension`` to keep output sizes manageable.
    """

    with BytesIO(image_data) as input_buffer, Image.open(input_buffer) as image:
        image_format = (image.format or _content_type_to_format(source_content_type)).upper()
        image = ImageOps.exif_transpose(image)

        if image.mode in {"RGBA", "LA", "P"}:
            rgba_image = image.convert("RGBA")
            alpha_channel = rgba_image.split()[-1]
            working_image = rgba_image.convert("RGB")
        else:
            alpha_channel = None
            working_image = image.convert("RGB")

        _constrain_size(working_image, max_dimension)
        if alpha_channel is not None and alpha_channel.size != working_image.size:
            alpha_channel = alpha_channel.resize(working_image.size, Image.LANCZOS)

        if _is_grayscale(working_image):
            stylized_rgb = _colorize_grayscale(working_image)
            transformation = "colorized"
        else:
            stylized_rgb = _cartoonize(working_image)
            transformation = "cartoonized"

        if alpha_channel is not None:
            stylized = stylized_rgb.convert("RGBA")
            stylized.putalpha(alpha_channel)
        else:
            stylized = stylized_rgb

        output_buffer = BytesIO()
        save_kwargs = {"format": image_format}

        if image_format in {"JPEG", "JPG"}:
            stylized = stylized.convert("RGB")
            save_kwargs.update({"quality": quality, "optimize": True, "progressive": True})
        elif image_format == "PNG":
            stylized = stylized.convert("RGBA")
            save_kwargs.update({"optimize": True, "compress_level": 9})
        else:
            stylized = stylized.convert("RGB")

        stylized.save(output_buffer, **save_kwargs)
        output_bytes = output_buffer.getvalue()

    return (
        output_bytes,
        _format_to_content_type(image_format, source_content_type),
        transformation,
    )


def _upload_stylized_image(object_key: str, data: bytes, content_type: str) -> None:
    """Upload the stylized image to the destination bucket."""

    s3.put_object(Bucket=DESTINATION_BUCKET, Key=object_key, Body=data, ContentType=content_type)


def _publish_stylize_notification(original_key: str, destination_key: str, transformation: str) -> None:
    """Send a notification to SNS once the image has been stylized."""

    message = (
        f"Image {original_key} has been {transformation} and uploaded to {DESTINATION_BUCKET}"
        f" as {destination_key}"
    )
    sns.publish(TopicArn=SNS_TOPIC_ARN, Message=message)


def _constrain_size(image: Image.Image, max_dimension: Tuple[int, int]) -> None:
    """Resize an image in-place so its longest edge does not exceed ``max_dimension``."""

    image.thumbnail(max_dimension, Image.LANCZOS)


def _is_grayscale(image: Image.Image) -> bool:
    """Return ``True`` if the provided image has no color information."""

    if image.mode in {"1", "L", "LA"}:
        return True

    converted = image.convert("RGB") if image.mode != "RGB" else image

    r, g, b = converted.split()
    return (
        ImageChops.difference(r, g).getbbox() is None
        and ImageChops.difference(r, b).getbbox() is None
    )


def _cartoonize(image: Image.Image) -> Image.Image:
    """Apply a cartoon-like stylization to a color image."""

    base = image.convert("RGB")

    # Smooth gradients while keeping overall structure.
    smooth = base.filter(ImageFilter.SMOOTH_MORE).filter(ImageFilter.SMOOTH_MORE)

    # Reduce the number of colors to create flat color regions typical of cartoons.
    reduced = smooth.quantize(colors=48, method=Image.MEDIANCUT).convert("RGB")

    # Detect edges and enhance them to create bold outlines.
    edges = base.convert("L")
    edges = edges.filter(ImageFilter.MedianFilter(size=3)).filter(ImageFilter.FIND_EDGES)
    edges = ImageOps.invert(edges)
    edges = ImageOps.autocontrast(edges, cutoff=10)
    edges = edges.point(lambda x: 255 if x > 110 else 0)
    edges = ImageOps.invert(edges).convert("RGB")

    # Combine the color-reduced image with the edge mask for the cartoon look.
    cartoon = ImageChops.multiply(reduced, edges)
    return ImageOps.autocontrast(cartoon, cutoff=2)


def _colorize_grayscale(image: Image.Image) -> Image.Image:
    """Colorize a grayscale image with a balanced warm and cool palette."""

    grayscale = image.convert("L")
    grayscale = ImageOps.autocontrast(grayscale, cutoff=5)

    # Apply a duotone colorization with cooler shadows and warm highlights.
    colorized = ImageOps.colorize(
        grayscale,
        black="#1f2a44",
        white="#f5d7af",
        mid="#6b9ac4",
    )
    enhancer = ImageEnhance.Color(colorized)
    return enhancer.enhance(1.15)


def _format_to_content_type(image_format: str, fallback: Optional[str]) -> str:
    """Return the MIME type for a Pillow image format."""

    mime_type = Image.MIME.get(image_format)
    if mime_type:
        return mime_type
    return fallback or "application/octet-stream"


def _content_type_to_format(content_type: Optional[str]) -> str:
    """Infer a Pillow format from a MIME type."""

    if not content_type:
        return "JPEG"

    for format_name, mime in Image.MIME.items():
        if mime == content_type:
            return format_name

    return "JPEG"
