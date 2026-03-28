import React, { useState, useEffect, useCallback } from 'react';
import { Plus } from 'lucide-react';
import { listSubjects, createSubject, deleteSubject } from '../services/storage';

const formatDate = (time: number) => new Date(time).toLocaleDateString();

interface WhiteboardPageProps {
  onOpenSubject: (subjectId: string) => void;
}

interface SubjectRecord {
  id: string;
  name: string;
  createdAt: number;
}

export function WhiteboardPage({ onOpenSubject }: WhiteboardPageProps) {
  const [subjects, setSubjects] = useState<SubjectRecord[]>([]);
  const [subjectName, setSubjectName] = useState('');
  const [loading, setLoading] = useState(false);

  const loadSubjects = useCallback(async () => {
    const data = (await listSubjects()) as SubjectRecord[];
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
    if (!window.confirm(`Delete notebook "${name}"? This will remove all related assignments and notes.`)) return;

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
        <h1 className="page-hero-title">My Subjects</h1>
        <p className="page-hero-subtitle">Create subjects and manage your problem-solving assignments.</p>
      </div>

      <div className="form-section mb-3">
        <h2>Create New Notebook</h2>
        <form onSubmit={handleCreateSubject} className="form-row">
          <input
            type="text"
            value={subjectName}
            onChange={(e) => setSubjectName(e.target.value)}
            placeholder="Notebook name (e.g., Calculus, Physics)"
            disabled={loading}
          />
          <button type="submit" className="btn-primary" disabled={loading || !subjectName.trim()}>
            <Plus size={16} />
            Create Notebook
          </button>
        </form>
      </div>

      <div className="mb-4">
        <h2 className="page-section-title mb-2">
          My Notebooks
        </h2>
        {subjects.length === 0 ? (
          <p className="text-muted">No notebooks yet. Create your first notebook above to get started.</p>
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
                <p className="text-sm text-muted">Created: {formatDate(subject.createdAt)}</p>
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
                      void handleDeleteSubject(subject.id, subject.name);
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
    </div>
  );
}
