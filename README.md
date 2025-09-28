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

## Local testing workflow

You can exercise the entire pipeline without touching AWS by running the Lambda against [LocalStack](https://docs.localstack.cloud/getting-started/installation/) and pointing the React frontend at the same local endpoints.

### 1. Start LocalStack and provision resources

```sh
# Install and launch LocalStack (choose either the CLI or Docker variant)
pip install "localstack[full]"
LOCALSTACK_API_KEY=<if you have one> localstack start -d

# Configure credentials for the LocalStack endpoints
export AWS_ACCESS_KEY_ID=test
export AWS_SECRET_ACCESS_KEY=test
export AWS_DEFAULT_REGION=us-east-1

# Convenience variable so we do not have to repeat the endpoint URL
export LOCALSTACK_ENDPOINT=http://localhost:4566

# Create the source and destination buckets that the Lambda expects
aws --endpoint-url "$LOCALSTACK_ENDPOINT" s3 mb s3://image-non-sized-1
aws --endpoint-url "$LOCALSTACK_ENDPOINT" s3 mb s3://image-sized-1

# Create the SNS topic consumed by downstream listeners
aws --endpoint-url "$LOCALSTACK_ENDPOINT" sns create-topic --name stylized-updates

# Record the returned TopicArn and update sns_topic_arn in image-resizing-s3.py accordingly
```

### 2. Deploy the Lambda to LocalStack

```sh
# Install Python dependencies into a deployable folder
rm -rf build && mkdir build
python -m pip install --target build Pillow
cp image-resizing-s3.py build/

# Bundle the handler and dependencies
cd build
zip -r ../lambda.zip .
cd ..

# Create the Lambda function inside LocalStack
aws --endpoint-url "$LOCALSTACK_ENDPOINT" lambda create-function \
  --function-name image-stylizer \
  --runtime python3.11 \
  --role arn:aws:iam::000000000000:role/lambda-ex \
  --handler image-resizing-s3.lambda_handler \
  --zip-file fileb://lambda.zip

# Wire the function to the S3 notification
aws --endpoint-url "$LOCALSTACK_ENDPOINT" s3api put-bucket-notification-configuration \
  --bucket image-non-sized-1 \
  --notification-configuration '{"LambdaFunctionConfigurations":[{"LambdaFunctionArn":"arn:aws:lambda:us-east-1:000000000000:function:image-stylizer","Events":["s3:ObjectCreated:*"]}]}'

# Allow S3 to invoke the Lambda inside LocalStack
aws --endpoint-url "$LOCALSTACK_ENDPOINT" lambda add-permission \
  --function-name image-stylizer \
  --statement-id s3invoke \
  --action "lambda:InvokeFunction" \
  --principal s3.amazonaws.com \
  --source-arn arn:aws:s3:::image-non-sized-1
```

### 3. Run the React frontend against LocalStack

A React single-page application lives under `frontend/` and provides a UI for uploading and tracking transformations. To run it against the LocalStack endpoints:

```sh
cd frontend
npm install

# Point the app at LocalStack
cat <<'EOF' > .env.local
VITE_S3_ENDPOINT=http://localhost:4566
VITE_REGION=us-east-1
EOF

npm run dev
```

The development server listens on [http://localhost:5173](http://localhost:5173). When prompted for credentials in the UI, reuse the `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` values set in step 1 (`test`/`test` when using LocalStack defaults).

### 4. Trigger a test run

1. Drag an image into the upload box.
2. The frontend uploads the file to the `image-non-sized-1` bucket.
3. LocalStack forwards the event to the Lambda, which writes the stylized version to `s3://image-sized-1/stylized/...`.
4. The UI polls the destination bucket and streams the finished asset back into the preview area for download.

If you prefer running against actual AWS services, skip the LocalStack-specific flags but keep the same bucket and topic names.


## License

This project is licensed under the MIT License.
