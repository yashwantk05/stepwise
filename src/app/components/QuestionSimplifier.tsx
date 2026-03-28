import React, { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

export function QuestionSimplifier({ onOpen }: { onOpen: () => Promise<string> }) {
  const [isOpen, setIsOpen] = useState(false);
  const [explanation, setExplanation] = useState('');
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const handleToggle = async () => {
    const nextOpen = !isOpen;
    setIsOpen(nextOpen);

    if (!nextOpen || loaded || loading) {
      return;
    }

    setLoading(true);
    try {
      const result = await onOpen();
      setExplanation(result);
      setLoaded(true);
    } catch {
      setExplanation('This question is asking you to understand the goal of the problem in simpler language.');
      setLoaded(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={`question-simplifier ${isOpen ? 'open' : ''}`}>
      <button type="button" className="question-simplifier-trigger" onClick={() => void handleToggle()}>
        <span className="question-simplifier-icon">
          {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </span>
        <span>Do you want me to explain this question?</span>
      </button>

      <div className={`question-simplifier-body ${isOpen ? 'open' : ''}`}>
        {isOpen ? (
          <div className="question-simplifier-card">
            {loading ? <p className="subtle">Reading the question...</p> : <p>{explanation}</p>}
          </div>
        ) : null}
      </div>
    </div>
  );
}
