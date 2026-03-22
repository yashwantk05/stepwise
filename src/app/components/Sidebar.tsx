import React from 'react';

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
          <span className="nav-icon">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="6" height="6" rx="1" />
              <rect x="11" y="3" width="6" height="6" rx="1" />
              <rect x="3" y="11" width="6" height="6" rx="1" />
              <rect x="11" y="11" width="6" height="6" rx="1" />
            </svg>
          </span>
          Dashboard
        </button>

        <button
          className={`nav-item ${currentPage === 'whiteboard' ? 'active' : ''}`}
          onClick={() => handleNavigate('whiteboard')}
        >
          <span className="nav-icon">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 3h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
              <path d="M6 7h8M6 10h8M6 13h5" strokeLinecap="round" />
            </svg>
          </span>
          AI Whiteboard
        </button>

        <button
          className={`nav-item ${currentPage === 'notes' ? 'active' : ''}`}
          onClick={() => handleNavigate('notes')}
        >
          <span className="nav-icon">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M5 3h8l3 3v11a1 1 0 0 1-1 1H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
              <path d="M13 3v4h4" />
              <path d="M7 10h6M7 13h6" strokeLinecap="round" />
            </svg>
          </span>
          My Notes
        </button>

        <button
          className={`nav-item ${currentPage === 'flashcards' ? 'active' : ''}`}
          onClick={() => onNavigate('flashcards')}
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
          onClick={() => onNavigate('quiz')}
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
          onClick={() => onNavigate('mind-map')}
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
          onClick={() => onNavigate('revision-sheet')}
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
