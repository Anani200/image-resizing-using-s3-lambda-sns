import React, { useEffect, useMemo, useState } from 'react';
import { useStylizeWorkflow } from './hooks/useStylizeWorkflow.js';
import SectionCard from './components/SectionCard.jsx';
import ActivityLog from './components/ActivityLog.jsx';
import FilePreview from './components/FilePreview.jsx';

const TRANSFORM_OPTIONS = [
  { value: 'auto', label: 'Auto-detect (color images cartoonized, grayscale colorized)' },
  { value: 'cartoon', label: 'Force cartoonize' },
  { value: 'colorize', label: 'Force colorize' },
];

const BUSY_STATUSES = new Set(['preparing', 'uploading', 'waiting', 'downloading']);

export default function App() {
  const [region, setRegion] = useState('');
  const [accessKeyId, setAccessKeyId] = useState('');
  const [secretAccessKey, setSecretAccessKey] = useState('');
  const [sessionToken, setSessionToken] = useState('');
  const [inputBucket, setInputBucket] = useState('');
  const [outputBucket, setOutputBucket] = useState('');
  const [inputPrefix, setInputPrefix] = useState('uploads/');
  const [outputPrefix, setOutputPrefix] = useState('stylized/');
  const [transformation, setTransformation] = useState('auto');
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);

  const { status, statusMessage, log, resultUrl, resultContentType, start, reset } =
    useStylizeWorkflow();

  const busy = useMemo(() => BUSY_STATUSES.has(status), [status]);

  useEffect(() => {
    if (!file) {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
        setPreviewUrl(null);
      }
      return undefined;
    }

    const newUrl = URL.createObjectURL(file);
    setPreviewUrl((previous) => {
      if (previous) {
        URL.revokeObjectURL(previous);
      }
      return newUrl;
    });

    return () => {
      URL.revokeObjectURL(newUrl);
    };
  }, [file]);

  const handleFileChange = (event) => {
    const nextFile = event.target.files && event.target.files[0];
    setFile(nextFile || null);
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    start({
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
    });
  };

  const handleReset = () => {
    reset();
    setFile(null);
    setTransformation('auto');
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>Stylize Images with Lambda</h1>
        <p>
          Upload a source photo to your S3 bucket and let the Lambda function automatically
          cartoonize or colorize it. Provide temporary AWS credentials tied to a role with
          access to both the source and destination buckets.
        </p>
      </header>

      <main>
        <form className="layout-grid" onSubmit={handleSubmit}>
          <SectionCard title="AWS credentials">
            <p className="section-hint">
              Use short-lived IAM credentials (such as from AWS SSO or STS) when testing from
              the browser.
            </p>
            <label className="field">
              <span>Region</span>
              <input
                type="text"
                value={region}
                onChange={(event) => setRegion(event.target.value)}
                placeholder="ap-south-1"
                required
              />
            </label>
            <label className="field">
              <span>Access key ID</span>
              <input
                type="text"
                value={accessKeyId}
                onChange={(event) => setAccessKeyId(event.target.value)}
                required
              />
            </label>
            <label className="field">
              <span>Secret access key</span>
              <input
                type="password"
                value={secretAccessKey}
                onChange={(event) => setSecretAccessKey(event.target.value)}
                required
              />
            </label>
            <label className="field">
              <span>Session token (optional)</span>
              <input
                type="password"
                value={sessionToken}
                onChange={(event) => setSessionToken(event.target.value)}
              />
            </label>
          </SectionCard>

          <SectionCard title="S3 buckets">
            <p className="section-hint">
              The Lambda function listens to uploads in the source bucket and stores stylized
              results in the destination bucket under a stylized prefix.
            </p>
            <label className="field">
              <span>Source bucket</span>
              <input
                type="text"
                value={inputBucket}
                onChange={(event) => setInputBucket(event.target.value)}
                placeholder="image-non-sized-1"
                required
              />
            </label>
            <label className="field">
              <span>Upload prefix</span>
              <input
                type="text"
                value={inputPrefix}
                onChange={(event) => setInputPrefix(event.target.value)}
                placeholder="uploads/"
              />
            </label>
            <label className="field">
              <span>Destination bucket</span>
              <input
                type="text"
                value={outputBucket}
                onChange={(event) => setOutputBucket(event.target.value)}
                placeholder="image-sized-1"
                required
              />
            </label>
            <label className="field">
              <span>Stylized prefix</span>
              <input
                type="text"
                value={outputPrefix}
                onChange={(event) => setOutputPrefix(event.target.value)}
                placeholder="stylized/"
              />
            </label>
          </SectionCard>

          <SectionCard title="Upload">
            <label className="field">
              <span>Choose an image</span>
              <input type="file" accept="image/*" onChange={handleFileChange} />
            </label>
            <label className="field">
              <span>Transformation preference</span>
              <select
                value={transformation}
                onChange={(event) => setTransformation(event.target.value)}
              >
                {TRANSFORM_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <p className="section-hint">
              The Lambda will automatically inspect the image. Setting a preference stores it as
              object metadata for observability and future overrides.
            </p>
            <div className="button-row">
              <button type="submit" disabled={busy}>
                {busy ? 'Working…' : 'Start stylizing'}
              </button>
              <button type="button" onClick={handleReset} disabled={busy && status !== 'error'}>
                Reset
              </button>
            </div>
            <div className="status-pill" data-status={status}>
              <span>Status:</span>
              <strong>{statusMessage}</strong>
            </div>
          </SectionCard>
        </form>

        <section className="results-grid">
          <SectionCard title="Source preview">
            <FilePreview url={previewUrl} name={file?.name} emptyHint="No image selected yet." />
          </SectionCard>
          <SectionCard title="Stylized output">
            {status === 'complete' && resultUrl ? (
              <FilePreview
                url={resultUrl}
                name={file?.name ? `stylized-${file.name}` : 'stylized-image'}
                mimeType={resultContentType}
                emptyHint="Upload an image to see the stylized result."
              />
            ) : (
              <p className="empty-placeholder">Upload an image to see the stylized result.</p>
            )}
          </SectionCard>
          <SectionCard title="Activity log">
            <ActivityLog entries={log} />
          </SectionCard>
        </section>
      </main>

      <footer className="app-footer">
        <p>
          The UI signs requests with AWS Signature Version 4 directly in the browser. Always use
          temporary credentials and revoke them after use.
        </p>
      </footer>
    </div>
  );
}
