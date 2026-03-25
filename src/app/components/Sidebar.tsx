import React from 'react';
import { AlertTriangle, BarChart3, BrainCircuit, LayoutDashboard, NotebookPen, PanelTopOpen, Settings } from 'lucide-react';

interface SidebarProps {
  currentPage: string;
  onNavigate: (page: string) => void;
  isExpanded?: boolean;
  onToggleExpanded?: () => void;
}

export function Sidebar({
  currentPage,
  onNavigate,
  isExpanded = false,
  onToggleExpanded,
}: SidebarProps) {
  const handleNavigate = (page: string) => {
    onNavigate(page);
  };

  return (
    <div className={`app-sidebar ${isExpanded ? 'open' : 'collapsed'}`}>
      <div className="sidebar-top-hamburger-row">
        <button
          className="icon-button sidebar-hamburger-btn"
          onClick={onToggleExpanded}
          title={isExpanded ? "Collapse menu" : "Expand menu"}
          aria-label={isExpanded ? "Collapse menu" : "Expand menu"}
        >
          {/* Hamburger (inline SVG so we can control size precisely) */}
          <svg width="30" height="30" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.6">
            <path d="M3 5h14M3 10h14M3 15h14" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <nav className="sidebar-nav">
        <button
          className={`nav-item ${currentPage === 'dashboard' ? 'active' : ''}`}
          onClick={() => handleNavigate('dashboard')}
        >
          <span className="nav-icon"><LayoutDashboard size={20} /></span>
          <span className="nav-label">Dashboard</span>
        </button>

        <button
          className={`nav-item ${currentPage === 'whiteboard' ? 'active' : ''}`}
          onClick={() => handleNavigate('whiteboard')}
        >
          <span className="nav-icon"><PanelTopOpen size={20} /></span>
          <span className="nav-label">AI Whiteboard</span>
        </button>

        <button
          className={`nav-item ${currentPage === 'weak-areas' ? 'active' : ''}`}
          onClick={() => handleNavigate('weak-areas')}
        >
          <span className="nav-icon"><AlertTriangle size={20} /></span>
          <span className="nav-label">Improvement Zones</span>
        </button>

        <button
          className={`nav-item ${currentPage === 'progress-analytics' ? 'active' : ''}`}
          onClick={() => handleNavigate('progress-analytics')}
        >
          <span className="nav-icon"><BarChart3 size={20} /></span>
          <span className="nav-label">Progress Analytics</span>
        </button>

        <button
          className={`nav-item ${currentPage === 'socratic-tutor' ? 'active' : ''}`}
          onClick={() => handleNavigate('socratic-tutor')}
        >
          <span className="nav-icon"><BrainCircuit size={20} /></span>
          <span className="nav-label">Socratic Tutor</span>
        </button>

        <button
          className={`nav-item ${currentPage === 'notes' ? 'active' : ''}`}
          onClick={() => handleNavigate('notes')}
        >
          <span className="nav-icon"><NotebookPen size={20} /></span>
          <span className="nav-label">My Notes</span>
        </button>

        <button
          className={`nav-item ${currentPage === 'settings' ? 'active' : ''}`}
          onClick={() => handleNavigate('settings')}
        >
          <span className="nav-icon"><Settings size={20} /></span>
          <span className="nav-label">Accessibility</span>
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
          <span className="nav-label">Flashcards</span>
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
          <span className="nav-label">Quizzes</span>
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
          <span className="nav-label">Mind Maps</span>
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
          <span className="nav-label">Revision Sheet</span>
        </button>
      </nav>
    </div>
  );
}
