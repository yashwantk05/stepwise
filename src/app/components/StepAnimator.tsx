import React from 'react';

export function StepAnimator({ steps }: { steps: string[] }) {
  return (
    <section className="socratic-visual-card">
      <h3>Step-by-step Animation</h3>
      <div className="socratic-step-list">
        {steps.map((step, index) => (
          <div key={`${step}-${index}`} className="socratic-step-item">
            <span>{index + 1}</span>
            <p>{step}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
