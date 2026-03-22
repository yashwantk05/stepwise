import React from 'react';
import { Calculator, Image, Mic, MessageSquareText } from 'lucide-react';

interface InputModesPanelProps {
  activeMode: 'text' | 'voice' | 'image' | 'equation';
  onSelect: (mode: 'text' | 'voice' | 'image' | 'equation') => void;
}

export function InputModesPanel({ activeMode, onSelect }: InputModesPanelProps) {
  const options = [
    { id: 'text' as const, label: 'Text', icon: <MessageSquareText size={16} /> },
    { id: 'voice' as const, label: 'Voice', icon: <Mic size={16} /> },
    { id: 'image' as const, label: 'Image Upload', icon: <Image size={16} /> },
    { id: 'equation' as const, label: 'Equation Input', icon: <Calculator size={16} /> },
  ];

  return (
    <section className="socratic-side-panel">
      <h3>Input Modes</h3>
      <div className="socratic-side-list">
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            className={`socratic-side-button ${activeMode === option.id ? 'active' : ''}`}
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
