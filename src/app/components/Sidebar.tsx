import React from 'react';
import { AlertTriangle, LayoutDashboard, NotebookPen, PanelTopOpen } from 'lucide-react';

interface SidebarProps {
  currentPage: string;
  onNavigate: (page: string) => void;
}

export function Sidebar({ currentPage, onNavigate }: SidebarProps) {
  return (
    <div className="app-sidebar">
      <div className="sidebar-header">
        <div className="sidebar-logo">M</div>
        <div className="sidebar-title">
          <h1>StepWise</h1>
        </div>
      </div>

      <nav className="sidebar-nav">
        <button
          className={`nav-item ${currentPage === 'dashboard' ? 'active' : ''}`}
          onClick={() => onNavigate('dashboard')}
        >
          <span className="nav-icon"><LayoutDashboard size={20} /></span>
          Dashboard
        </button>

        <button
          className={`nav-item ${currentPage === 'whiteboard' ? 'active' : ''}`}
          onClick={() => onNavigate('whiteboard')}
        >
          <span className="nav-icon"><PanelTopOpen size={20} /></span>
          AI Whiteboard
        </button>

        <button
          className={`nav-item ${currentPage === 'weak-areas' ? 'active' : ''}`}
          onClick={() => onNavigate('weak-areas')}
        >
          <span className="nav-icon"><AlertTriangle size={20} /></span>
          Weak Areas
        </button>

        <button
          className={`nav-item ${currentPage === 'notes' ? 'active' : ''}`}
          onClick={() => onNavigate('notes')}
        >
          <span className="nav-icon"><NotebookPen size={20} /></span>
          My Notes
        </button>
      </nav>
    </div>
  );
}
