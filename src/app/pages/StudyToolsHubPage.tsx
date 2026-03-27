import React from 'react';
import { BookOpen, CheckCircle2, FileText, GitBranch } from 'lucide-react';
import type { StudyToolType } from '../services/studyTools';

interface StudyToolsHubPageProps {
  onOpenStudyTool: (tool: StudyToolType) => void;
}

const toolCards: Array<{
  tool: StudyToolType;
  title: string;
  description: string;
  icon: React.ReactNode;
}> = [
  {
    tool: 'flashcards',
    title: 'Flashcards',
    description: 'Quick active recall cards from your notes.',
    icon: <BookOpen size={20} />,
  },
  {
    tool: 'revision-sheet',
    title: 'Revision Sheet',
    description: 'Concise summary for fast exam prep.',
    icon: <FileText size={20} />,
  },
  {
    tool: 'mind-map',
    title: 'Mind Maps',
    description: 'Visual connections across key concepts.',
    icon: <GitBranch size={20} />,
  },
  {
    tool: 'quiz',
    title: 'Quizzes',
    description: 'Timed practice with immediate feedback.',
    icon: <CheckCircle2 size={20} />,
  },
];

export function StudyToolsHubPage({ onOpenStudyTool }: StudyToolsHubPageProps) {
  return (
    <main className="study-tools-hub-shell">
      <header className="study-tools-hub-header">
        <h1>Study Tools</h1>
        <p>Choose a tool to open its page.</p>
      </header>

      <section className="study-tools-hub-grid" aria-label="Study tools">
        {toolCards.map((card) => (
          <button
            key={card.tool}
            type="button"
            className="study-tools-hub-button"
            onClick={() => onOpenStudyTool(card.tool)}
          >
            <span className="study-tools-hub-button-icon">{card.icon}</span>
            <span className="study-tools-hub-button-title">{card.title}</span>
            <span className="study-tools-hub-button-description">{card.description}</span>
          </button>
        ))}
      </section>
    </main>
  );
}
