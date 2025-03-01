# Image Resizing using AWS S3, Lambda, and SNS

This project demonstrates how to automatically resize images uploaded to an S3 bucket using AWS Lambda and notify via SNS.

## Prerequisites

- AWS Account
- AWS CLI configured
- Python 3.x
- Boto3 library
- Pillow library

## Setup

1. **Clone the repository:**
    ```sh
    git clone https://github.com/your-repo/image-resizing-using-s3-lambda-sns.git
    cd image-resizing-using-s3-lambda-sns
    ```

2. **Install dependencies:**
    ```sh
    pip install boto3 Pillow
    ```

3. **Configure AWS resources:**
    - Create two S3 buckets: `image-non-sized-1` and `image-sized-1`.
    - Create an SNS topic and note its ARN.
    - Update the `bucket_1`, `bucket_2`, and `sns_topic_arn` variables in `image-resizing-s3.py` with your bucket names and SNS topic ARN.

4. **Deploy the Lambda function:**
    - Zip the project files:
        ```sh
        zip -r function.zip .
        ```
    - Create a Lambda function and upload the `function.zip` file.
    - Set the handler to `image-resizing-s3.lambda_handler`.
    - Add necessary permissions to the Lambda function to access S3 and SNS.

5. **Configure S3 event notifications:**
    - Set up an event notification on the `image-non-sized-1` bucket to trigger the Lambda function on object creation.

## Usage

1. **Upload an image to the `image-non-sized-1` bucket.**
2. The Lambda function will automatically resize and compress the image.
3. The resized image will be uploaded to the `image-sized-1` bucket.
4. A notification will be sent to the SNS topic.

## License

This project is licensed under the MIT License.
