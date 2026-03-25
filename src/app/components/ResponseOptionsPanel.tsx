import React from 'react';
import { AudioLines, Eye, Play } from 'lucide-react';

interface ResponseOptionsPanelProps {
  activeOption: 'voice' | 'diagram' | 'steps';
  onSelect: (option: 'voice' | 'diagram' | 'steps') => void;
}

export function ResponseOptionsPanel({ activeOption, onSelect }: ResponseOptionsPanelProps) {
  const options = [
    { id: 'voice' as const, label: 'Voice Explanation', icon: <AudioLines size={16} /> },
    { id: 'diagram' as const, label: 'Visual Diagram', icon: <Eye size={16} /> },
    { id: 'steps' as const, label: 'Step-by-step Animation', icon: <Play size={16} /> },
  ];

  return (
    <section className="socratic-side-panel">
      <h3>Response Options</h3>
      <div className="socratic-side-list">
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            className={`socratic-side-button ${activeOption === option.id ? 'active' : ''}`}
            onClick={() => onSelect(option.id)}
          >
            {option.icon}
            {option.label}
          </button>
        ))}
      </div>
    </section>
  );
}
