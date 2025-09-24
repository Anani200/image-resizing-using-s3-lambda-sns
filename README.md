# Image Resizing using AWS S3, Lambda, and SNS

This project demonstrates how to automatically stylize images uploaded to an S3 bucket using AWS Lambda and notify via SNS.

## Prerequisites

- AWS Account
- AWS CLI configured
- Python 3.x
- Node.js 18+
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
2. The Lambda function will automatically detect whether the image is grayscale or color.
3. Grayscale uploads are colorized, while color images are cartoonized with preserved transparency.
4. The stylized image is uploaded to the `image-sized-1` bucket under a `stylized/` prefix.
5. A notification is sent to the SNS topic summarizing the transformation.

## Frontend control panel

A React single-page application is available under `frontend/` to drive the Lambda workflow from the browser. It supports:

- Uploading images directly to the source bucket using SigV4-signed requests.
- Polling the destination bucket for the stylized output and presenting it in the UI.
- Tracking progress with a real-time activity log and status updates.
- Supplying optional metadata that records the desired transformation preference.

To run the UI locally:

```sh
cd frontend
npm install
npm run dev
```

The development server listens on [http://localhost:5173](http://localhost:5173). Provide temporary AWS credentials with access to both buckets when prompted by the UI. For production deployments, host the compiled assets produced by `npm run build` behind an authenticated origin.

## License

This project is licensed under the MIT License.
