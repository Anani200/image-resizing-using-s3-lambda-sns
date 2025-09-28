import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createS3Client } from '../aws/createS3Client.js';

const DEFAULT_INPUT_PREFIX = 'uploads/';
const DEFAULT_OUTPUT_PREFIX = 'stylized/';
const POLL_INTERVAL_MS = 5000;
const MAX_POLLS = 24; // Poll for up to 2 minutes.

function toLogEntry(message) {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    timestamp: new Date().toLocaleTimeString(),
    message,
  };
}

export function useStylizeWorkflow() {
  const [status, setStatus] = useState('idle');
  const [log, setLog] = useState([]);
  const [resultUrl, setResultUrl] = useState(null);
  const [resultContentType, setResultContentType] = useState(null);
  const abortRef = useRef(null);

  useEffect(() => {
    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
      }
      if (resultUrl) {
        URL.revokeObjectURL(resultUrl);
      }
    };
  }, [resultUrl]);

  const appendLog = useCallback((message) => {
    setLog((previous) => [...previous, toLogEntry(message)]);
  }, []);

  const reset = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setStatus('idle');
    setLog([]);
    if (resultUrl) {
      URL.revokeObjectURL(resultUrl);
      setResultUrl(null);
    }
    setResultContentType(null);
  }, [resultUrl]);

  const start = useCallback(
    async ({
      file,
      region,
      accessKeyId,
      secretAccessKey,
      sessionToken,
      inputBucket,
      outputBucket,
      transformation,
      inputPrefix,
      outputPrefix,
    }) => {
      if (!file) {
        appendLog('Please choose an image to upload.');
        return;
      }

      setStatus('preparing');
      appendLog(`Preparing to upload ${file.name}`);

      if (!region || !accessKeyId || !secretAccessKey) {
        appendLog('Region, access key ID, and secret access key are required.');
        setStatus('error');
        return;
      }

      if (!inputBucket?.trim()) {
        appendLog('Please provide the source bucket that triggers the Lambda.');
        setStatus('error');
        return;
      }

      if (!outputBucket?.trim()) {
        appendLog('Please provide the destination bucket for stylized assets.');
        setStatus('error');
        return;
      }

      const client = createS3Client({ region, accessKeyId, secretAccessKey, sessionToken });
      const sourceBucket = inputBucket.trim();
      const destinationBucket = outputBucket.trim();
      const normalizedInputPrefix = (inputPrefix || DEFAULT_INPUT_PREFIX).trim();
      const rawPrefix =
        normalizedInputPrefix === '' ? '' : normalizedInputPrefix.replace(/^\/+/, '');
      const uploadPrefix =
        rawPrefix === '' ? '' : rawPrefix.endsWith('/') ? rawPrefix : `${rawPrefix}/`;
      const baseName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const uniqueId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}`;
      const objectKey = `${uploadPrefix}${uniqueId}-${baseName}`;

      const metadata = {};
      if (transformation && transformation !== 'auto') {
        metadata['stylize-preference'] = transformation;
      }

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        setStatus('uploading');
        appendLog(`Uploading to s3://${sourceBucket}/${objectKey}`);
        await client.putObject({
          Bucket: sourceBucket,
          Key: objectKey,
          Body: file,
          ContentType: file.type || 'application/octet-stream',
          Metadata: Object.keys(metadata).length ? metadata : undefined,
        });
      } catch (error) {
        setStatus('error');
        appendLog(`Upload failed: ${error.message}`);
        abortRef.current = null;
        return;
      }

      const normalizedOutputPrefix = (outputPrefix || DEFAULT_OUTPUT_PREFIX).trim();
      const rawOutputPrefix =
        normalizedOutputPrefix === '' ? '' : normalizedOutputPrefix.replace(/^\/+/, '');
      const outputKeyPrefix =
        rawOutputPrefix === '' ? '' : rawOutputPrefix.endsWith('/') ? rawOutputPrefix : `${rawOutputPrefix}/`;
      const outputKey = `${outputKeyPrefix}${objectKey}`;

      setStatus('waiting');
      appendLog('Upload complete. Waiting for stylized output...');

      let attempt = 0;
      while (attempt < MAX_POLLS) {
        if (controller.signal.aborted) {
          appendLog('Workflow aborted by user.');
          setStatus('idle');
          abortRef.current = null;
          return;
        }

        attempt += 1;
        appendLog(`Checking for stylized asset (attempt ${attempt}/${MAX_POLLS})`);
        try {
          const headResult = await client.headObject({ Bucket: destinationBucket, Key: outputKey });
          appendLog('Stylized asset found. Downloading...');
          setStatus('downloading');
          const getResult = await client.getObject({ Bucket: destinationBucket, Key: outputKey });
          const arrayBuffer = await getResult.Body?.transformToByteArray();
          if (!arrayBuffer) {
            throw new Error('Unable to read stylized image body.');
          }
          const mimeType =
            getResult.ContentType || headResult.headers?.get?.('content-type') || 'image/jpeg';
          const blob = new Blob([arrayBuffer], { type: mimeType });
          if (resultUrl) {
            URL.revokeObjectURL(resultUrl);
          }
          const newUrl = URL.createObjectURL(blob);
          setResultUrl(newUrl);
          setResultContentType(mimeType);
          appendLog('Stylized image downloaded successfully.');
          setStatus('complete');
          abortRef.current = null;
          return;
        } catch (error) {
          const statusCode = error?.response?.status || error?.$metadata?.httpStatusCode;
          if (statusCode === 404) {
            // Not ready yet.
          } else {
            setStatus('error');
            appendLog(`Failed to retrieve stylized image: ${error.message}`);
            abortRef.current = null;
            return;
          }
        }

        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }

      setStatus('error');
      appendLog('Timed out waiting for stylized image.');
      abortRef.current = null;
    },
    [appendLog, resultUrl]
  );

  const statusMessage = useMemo(() => {
    switch (status) {
      case 'idle':
        return 'Idle';
      case 'preparing':
        return 'Preparing upload';
      case 'uploading':
        return 'Uploading source image';
      case 'waiting':
        return 'Waiting for Lambda to finish';
      case 'downloading':
        return 'Downloading stylized image';
      case 'complete':
        return 'Complete';
      case 'error':
        return 'Error';
      default:
        return status;
    }
  }, [status]);

  return {
    status,
    statusMessage,
    log,
    resultUrl,
    resultContentType,
    start,
    reset,
  };
}
