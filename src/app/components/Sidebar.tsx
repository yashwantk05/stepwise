import React from 'react';
import { AlertTriangle, BarChart3, BrainCircuit, Gamepad2, LayoutDashboard, NotebookPen, PanelTopOpen, Settings, Shapes } from 'lucide-react';

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
          className={`nav-item ${currentPage === 'refresh-zone' ? 'active' : ''}`}
          onClick={() => handleNavigate('refresh-zone')}
        >
          <span className="nav-icon"><Gamepad2 size={20} /></span>
          <span className="nav-label">Refresh Zone</span>
        </button>

        <button
          className={`nav-item ${currentPage === 'notes' ? 'active' : ''}`}
          onClick={() => handleNavigate('notes')}
        >
          <span className="nav-icon"><NotebookPen size={20} /></span>
          <span className="nav-label">My Notes</span>
        </button>

        <button
          className={`nav-item ${currentPage === 'study-tools' ? 'active' : ''}`}
          onClick={() => handleNavigate('study-tools')}
        >
          <span className="nav-icon"><Shapes size={20} /></span>
          <span className="nav-label">Study Tools</span>
        </button>

        <button
          className={`nav-item ${currentPage === 'settings' ? 'active' : ''}`}
          onClick={() => handleNavigate('settings')}
        >
          <span className="nav-icon"><Settings size={20} /></span>
          <span className="nav-label">Accessibility</span>
        </button>
      </nav>
    </div>
  );
}
