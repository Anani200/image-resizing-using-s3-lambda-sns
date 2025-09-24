import React from 'react';

export default function SectionCard({ title, children }) {
  return (
    <section className="section-card">
      <header>
        <h2>{title}</h2>
      </header>
      <div className="section-content">{children}</div>
    </section>
  );
}
