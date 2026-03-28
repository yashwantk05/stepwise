import React from 'react';
import { Plus } from 'lucide-react';

export function AddQuestionButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="add-question-button" onClick={onClick}>
      <Plus size={14} />
      Add Question
    </button>
  );
}
