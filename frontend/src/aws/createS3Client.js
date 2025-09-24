const EMPTY_PAYLOAD_SHA256 =
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

function toHex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

async function sha256Hex(data) {
  const encoder = new TextEncoder();
  let buffer;
  if (typeof data === 'string') {
    buffer = encoder.encode(data);
  } else if (data instanceof ArrayBuffer) {
    buffer = new Uint8Array(data);
  } else if (ArrayBuffer.isView(data)) {
    buffer = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  } else if (data && typeof data.arrayBuffer === 'function') {
    buffer = new Uint8Array(await data.arrayBuffer());
  } else if (!data) {
    buffer = new Uint8Array();
  } else {
    throw new Error('Unsupported data type for hashing.');
  }

  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  return toHex(hashBuffer);
}

async function hmacKey(key, data) {
  return crypto.subtle.sign(
    'HMAC',
    await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']),
    data
  );
}

async function deriveSigningKey(secretAccessKey, dateStamp, region, service) {
  const encoder = new TextEncoder();
  const kSecret = encoder.encode(`AWS4${secretAccessKey}`);
  const kDate = await hmacKey(kSecret, encoder.encode(dateStamp));
  const kRegion = await hmacKey(kDate, encoder.encode(region));
  const kService = await hmacKey(kRegion, encoder.encode(service));
  return hmacKey(kService, encoder.encode('aws4_request'));
}

function formatAmzDate(date) {
  const pad = (value, size = 2) => value.toString().padStart(size, '0');
  const year = date.getUTCFullYear();
  const month = pad(date.getUTCMonth() + 1);
  const day = pad(date.getUTCDate());
  const hours = pad(date.getUTCHours());
  const minutes = pad(date.getUTCMinutes());
  const seconds = pad(date.getUTCSeconds());
  return {
    amzDate: `${year}${month}${day}T${hours}${minutes}${seconds}Z`,
    dateStamp: `${year}${month}${day}`,
  };
}

function encodeS3Key(key) {
  return key
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
    .replace(/%2F/g, '/');
}

function buildCanonicalHeaders(headers) {
  return Object.entries(headers)
    .map(([name, value]) => [name.toLowerCase(), value])
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, value]) => `${name}:${value.toString().trim()}`)
    .join('\n');
}

function buildSignedHeaders(headers) {
  return Object.keys(headers)
    .map((name) => name.toLowerCase())
    .sort()
    .join(';');
}

async function signRequest({
  method,
  bucket,
  region,
  key,
  headers = {},
  body,
  accessKeyId,
  secretAccessKey,
  sessionToken,
}) {
  const service = 's3';
  const host = `${bucket}.s3.${region}.amazonaws.com`;
  const { amzDate, dateStamp } = formatAmzDate(new Date());

  const payloadHash = body ? await sha256Hex(body) : EMPTY_PAYLOAD_SHA256;
  const mergedHeaders = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    ...headers,
  };

  if (sessionToken) {
    mergedHeaders['x-amz-security-token'] = sessionToken;
  }

  const canonicalHeaders = buildCanonicalHeaders(mergedHeaders);
  const signedHeaders = buildSignedHeaders(mergedHeaders);
  const canonicalRequest = [
    method.toUpperCase(),
    `/${encodeS3Key(key)}`,
    '',
    `${canonicalHeaders}\n`,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${await sha256Hex(
    canonicalRequest
  )}`;

  const signingKey = await deriveSigningKey(secretAccessKey, dateStamp, region, service);
  const signatureBytes = await hmacKey(signingKey, new TextEncoder().encode(stringToSign));
  const signature = toHex(signatureBytes);

  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    url: `https://${host}/${encodeS3Key(key)}`,
    headers: {
      ...mergedHeaders,
      Authorization: authorization,
    },
    body,
  };
}

async function makeRequest(config) {
  const { method, body } = config;
  const payload = body && typeof body.arrayBuffer === 'function' ? await body.arrayBuffer() : body;
  const signed = await signRequest({ ...config, body: payload });
  const response = await fetch(signed.url, {
    method,
    headers: signed.headers,
    body: payload || undefined,
  });

  if (!response.ok) {
    const error = new Error(`S3 request failed with status ${response.status}`);
    error.response = response;
    throw error;
  }

  return response;
}

export function createS3Client({ region, accessKeyId, secretAccessKey, sessionToken }) {
  if (!region) {
    throw new Error('Region is required to create an S3 client.');
  }

  if (!accessKeyId || !secretAccessKey) {
    throw new Error('Access key ID and secret access key are required.');
  }

  return {
    async putObject({ Bucket: bucket, Key: key, Body: body, ContentType, Metadata }) {
      const headers = {};
      if (ContentType) {
        headers['Content-Type'] = ContentType;
      }
      if (Metadata) {
        for (const [metaKey, metaValue] of Object.entries(Metadata)) {
          headers[`x-amz-meta-${metaKey.toLowerCase()}`] = metaValue;
        }
      }
      await makeRequest({
        method: 'PUT',
        bucket,
        region,
        key,
        headers,
        body,
        accessKeyId,
        secretAccessKey,
        sessionToken,
      });
    },

    async headObject({ Bucket: bucket, Key: key }) {
      const response = await makeRequest({
        method: 'HEAD',
        bucket,
        region,
        key,
        headers: {},
        body: null,
        accessKeyId,
        secretAccessKey,
        sessionToken,
      });
      return { headers: response.headers, status: response.status };
    },

    async getObject({ Bucket: bucket, Key: key }) {
      const response = await makeRequest({
        method: 'GET',
        bucket,
        region,
        key,
        headers: {},
        body: null,
        accessKeyId,
        secretAccessKey,
        sessionToken,
      });
      const arrayBuffer = await response.arrayBuffer();
      const contentType = response.headers.get('content-type');
      return {
        Body: {
          async transformToByteArray() {
            return new Uint8Array(arrayBuffer);
          },
        },
        ContentType: contentType,
      };
    },
  };
}
