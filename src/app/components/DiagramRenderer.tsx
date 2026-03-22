import React from 'react';

export function DiagramRenderer({ topic, concept }: { topic: string; concept: string }) {
  return (
    <section className="socratic-visual-card">
      <h3>Visual Diagram</h3>
      <div className="socratic-diagram-shell">
        <div className="socratic-diagram-node">{topic || 'Topic'}</div>
        <div className="socratic-diagram-connector" />
        <div className="socratic-diagram-node subtle">{concept || 'Key concept'}</div>
      </div>
    </section>
  );
}
