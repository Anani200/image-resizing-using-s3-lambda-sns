import React from 'react';

export default function ActivityLog({ entries }) {
  if (!entries || entries.length === 0) {
    return <p className="empty-placeholder">No activity yet.</p>;
  }

  return (
    <ol className="activity-log">
      {entries.map((entry) => (
        <li key={entry.id}>
          <span className="activity-timestamp">{entry.timestamp}</span>
          <span className="activity-message">{entry.message}</span>
        </li>
      ))}
    </ol>
  );
}
