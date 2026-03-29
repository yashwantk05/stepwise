import React from 'react';

interface WeakTopicCardProps {
  topic: string;
  notebook: string;
  mistakes: number;
}

export function WeakTopicCard({ topic, notebook, mistakes }: WeakTopicCardProps) {
  return (
    <article className="weak-topic-card">
      <div className="weak-topic-copy">
        <h3>{topic}</h3>
        <span className="weak-topic-tag" data-no-translate="true">{notebook}</span>
      </div>
      <div className="weak-topic-metric">
        <strong>{mistakes}</strong>
        <span>mistakes</span>
      </div>
    </article>
  );
}
