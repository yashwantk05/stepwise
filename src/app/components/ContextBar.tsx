import React from 'react';

export interface TutorContextState {
  topic: string;
  concept: string;
  errorType: string;
  source: 'manual' | 'whiteboard' | 'auto' | 'weak-areas';
  assignmentId?: string;
  problemIndex?: number;
}

interface ContextBarProps {
  context: TutorContextState;
  notebookOptions: string[];
  onChange: (updates: Partial<TutorContextState>) => void;
}

export function ContextBar({ context, notebookOptions, onChange }: ContextBarProps) {
  return (
    <section className="socratic-context-bar">
      <div className="socratic-context-copy">
        <h2>Topic / Notebook Context</h2>
        <p>Guide the tutor with notebook context so every question stays focused.</p>
      </div>

      <div className="socratic-context-grid">
        <label>
          Topic
          <input
            type="text"
            value={context.topic}
            list="socratic-topic-list"
            onChange={(event) => onChange({ topic: event.target.value, source: 'manual' })}
            placeholder="Quadratic Equations"
          />
          <datalist id="socratic-topic-list">
            {notebookOptions.map((option) => (
              <option key={option} value={option} />
            ))}
          </datalist>
        </label>

        <label>
          Concept
          <input
            type="text"
            value={context.concept}
            onChange={(event) => onChange({ concept: event.target.value, source: 'manual' })}
            placeholder="Factoring"
          />
        </label>

        <label>
          Focus
          <input
            type="text"
            value={context.errorType}
            onChange={(event) => onChange({ errorType: event.target.value, source: 'manual' })}
            placeholder="Sign Errors"
          />
        </label>

        <label>
          Source
          <input type="text" value={context.source} readOnly />
        </label>
      </div>
    </section>
  );
}
