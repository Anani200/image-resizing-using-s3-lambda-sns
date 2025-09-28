import React from 'react';

export default function FilePreview({ url, name, mimeType, emptyHint }) {
  if (!url) {
    return <p className="empty-placeholder">{emptyHint}</p>;
  }

  const isImage = mimeType ? mimeType.startsWith('image/') : true;
  const filename = name || 'preview-image';

  return (
    <div className="file-preview">
      {isImage ? (
        <img src={url} alt={filename} />
      ) : (
        <p className="empty-placeholder">
          The stylized file is not an image preview.{' '}
          <a href={url} download={filename}>
            Download {filename}
          </a>
        </p>
      )}
      <div className="file-preview-footer">
        <a href={url} download={filename}>
          Download {filename}
        </a>
        {mimeType ? <span className="file-preview-meta">{mimeType}</span> : null}
      </div>
    </div>
  );
}
