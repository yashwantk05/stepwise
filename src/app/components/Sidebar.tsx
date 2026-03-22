import React from 'react';
import { AlertTriangle, BarChart3, BrainCircuit, LayoutDashboard, NotebookPen, PanelTopOpen } from 'lucide-react';

interface SidebarProps {
  currentPage: string;
  onNavigate: (page: string) => void;
  isOpen?: boolean;
  isCompact?: boolean;
  onClose?: () => void;
}

export function Sidebar({ currentPage, onNavigate, isOpen = false, isCompact = false, onClose }: SidebarProps) {
  const handleNavigate = (page: string) => {
    onNavigate(page);
    if (isCompact) {
      onClose?.();
    }
  };

  return (
    <div className={`app-sidebar ${isOpen ? 'open' : ''}`}>
      <div className="sidebar-header">
        <div className="sidebar-logo">M</div>
        <div className="sidebar-title">
          <h1>StepWise</h1>
        </div>
        {isCompact && (
          <button
            className="icon-button sidebar-close-btn"
            onClick={onClose}
            title="Toggle menu"
            aria-label="Toggle menu"
          >
            <svg width="24" height="24" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.4">
              <path d="M3 5h14M3 10h14M3 15h14" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>

      <nav className="sidebar-nav">
        <button
          className={`nav-item ${currentPage === 'dashboard' ? 'active' : ''}`}
          onClick={() => handleNavigate('dashboard')}
        >
          <span className="nav-icon"><LayoutDashboard size={20} /></span>
          Dashboard
        </button>

        <button
          className={`nav-item ${currentPage === 'whiteboard' ? 'active' : ''}`}
          onClick={() => handleNavigate('whiteboard')}
        >
          <span className="nav-icon"><PanelTopOpen size={20} /></span>
          AI Whiteboard
        </button>

        <button
          className={`nav-item ${currentPage === 'weak-areas' ? 'active' : ''}`}
          onClick={() => handleNavigate('weak-areas')}
        >
          <span className="nav-icon"><AlertTriangle size={20} /></span>
          Weak Areas
        </button>

        <button
          className={`nav-item ${currentPage === 'progress-analytics' ? 'active' : ''}`}
          onClick={() => handleNavigate('progress-analytics')}
        >
          <span className="nav-icon"><BarChart3 size={20} /></span>
          Progress Analytics
        </button>

        <button
          className={`nav-item ${currentPage === 'socratic-tutor' ? 'active' : ''}`}
          onClick={() => handleNavigate('socratic-tutor')}
        >
          <span className="nav-icon"><BrainCircuit size={20} /></span>
          Socratic Tutor
        </button>

        <button
          className={`nav-item ${currentPage === 'notes' ? 'active' : ''}`}
          onClick={() => handleNavigate('notes')}
        >
          <span className="nav-icon"><NotebookPen size={20} /></span>
          My Notes
        </button>

        <button
          className={`nav-item ${currentPage === 'flashcards' ? 'active' : ''}`}
          onClick={() => handleNavigate('flashcards')}
        >
          <span className="nav-icon">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="5" width="14" height="10" rx="2" />
              <path d="M7 8h6M7 12h4" strokeLinecap="round" />
            </svg>
          </span>
          Flashcards
        </button>

        <button
          className={`nav-item ${currentPage === 'quiz' ? 'active' : ''}`}
          onClick={() => handleNavigate('quiz')}
        >
          <span className="nav-icon">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="10" cy="10" r="7" />
              <path d="M8.5 8a1.5 1.5 0 1 1 2.6 1c-.6.5-1.1.9-1.1 1.8" strokeLinecap="round" />
              <path d="M10 14h.01" strokeLinecap="round" />
            </svg>
          </span>
          Quizzes
        </button>

        <button
          className={`nav-item ${currentPage === 'mind-map' ? 'active' : ''}`}
          onClick={() => handleNavigate('mind-map')}
        >
          <span className="nav-icon">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="10" cy="4" r="2" />
              <circle cx="4" cy="16" r="2" />
              <circle cx="16" cy="16" r="2" />
              <path d="M10 6v4M10 10l-6 4M10 10l6 4" strokeLinecap="round" />
            </svg>
          </span>
          Mind Maps
        </button>

        <button
          className={`nav-item ${currentPage === 'revision-sheet' ? 'active' : ''}`}
          onClick={() => handleNavigate('revision-sheet')}
        >
          <span className="nav-icon">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M5 3h7l3 3v11a1 1 0 0 1-1 1H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
              <path d="M12 3v4h4" />
              <path d="M7 10h6M7 13h6" strokeLinecap="round" />
            </svg>
          </span>
          Revision Sheet
        </button>
      </nav>
    </div>
  );
}
