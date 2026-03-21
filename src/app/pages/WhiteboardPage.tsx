import React, { useState, useEffect, useCallback } from 'react';
import { listSubjects, createSubject, deleteSubject, getSubjectById } from '../services/storage';

const formatDate = (time: number) => new Date(time).toLocaleString();

interface WhiteboardPageProps {
  onOpenSubject: (subjectId: string) => void;
}

export function WhiteboardPage({ onOpenSubject }: WhiteboardPageProps) {
  const [subjects, setSubjects] = useState<any[]>([]);
  const [subjectName, setSubjectName] = useState('');
  const [loading, setLoading] = useState(false);

  const loadSubjects = useCallback(async () => {
    const data = await listSubjects();
    setSubjects(data);
  }, []);

  useEffect(() => {
    void loadSubjects();
  }, [loadSubjects]);

  const handleCreateSubject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subjectName.trim()) return;

    setLoading(true);
    try {
      await createSubject(subjectName.trim());
      setSubjectName('');
      await loadSubjects();
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteSubject = async (subjectId: string, name: string) => {
    if (!window.confirm(`Delete subject "${name}"? This will remove all related assignments.`)) return;
    
    setLoading(true);
    try {
      await deleteSubject(subjectId);
      await loadSubjects();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app-content">
      <div className="welcome-section">
        <p className="eyebrow">AI Whiteboard</p>
        <h1>My Subjects</h1>
        <p>Create subjects and manage your problem-solving assignments</p>
      </div>

      <div>
        {subjects.length === 0 ? (
          <p className="text-muted">No subjects yet. Create your first subject below to get started.</p>
        ) : (
          <div className="cards-grid">
            {subjects.map((subject) => (
              <div
                key={subject.id}
                className="card"
                onClick={() => onOpenSubject(subject.id)}
                style={{ cursor: 'pointer' }}
              >
                <h2>{subject.name}</h2>
                <p className="text-sm text-muted">
                  Created: {formatDate(subject.createdAt)}
                </p>
                <div className="card-actions">
                  <button
                    className="btn-sm btn-primary"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenSubject(subject.id);
                    }}
                  >
                    Open
                  </button>
                  <button
                    className="btn-sm btn-danger"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteSubject(subject.id, subject.name);
                    }}
                    disabled={loading}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="form-section mb-3">
        <h2>Create New Subject</h2>
        <form onSubmit={handleCreateSubject} className="form-row">
          <input
            type="text"
            value={subjectName}
            onChange={(e) => setSubjectName(e.target.value)}
            placeholder="Subject name (e.g., Calculus, Physics)"
            disabled={loading}
          />
          <button type="submit" className="btn-primary" disabled={loading || !subjectName.trim()}>
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M10 5v10M5 10h10" strokeLinecap="round" />
            </svg>
            Create Subject
          </button>
        </form>
      </div>
    </div>
  );
}