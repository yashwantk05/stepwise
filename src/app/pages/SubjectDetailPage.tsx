import React, { useState, useEffect, useCallback } from 'react';
import { getSubjectById, listAssignments, createAssignment, deleteAssignment } from '../services/storage';

const MIN_PROBLEM_COUNT = 1;
const MAX_PROBLEM_COUNT = 60;
const formatDate = (time: number) => new Date(time).toLocaleString();
const normalizeProblemCount = (value: number) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return MIN_PROBLEM_COUNT;
  return Math.min(MAX_PROBLEM_COUNT, Math.max(MIN_PROBLEM_COUNT, parsed));
};

interface SubjectDetailPageProps {
  subjectId: string;
  onBack: () => void;
  onOpenAssignment: (assignmentId: string) => void;
}

export function SubjectDetailPage({ subjectId, onBack, onOpenAssignment }: SubjectDetailPageProps) {
  const [subject, setSubject] = useState<any>(null);
  const [assignments, setAssignments] = useState<any[]>([]);
  const [assignmentTitle, setAssignmentTitle] = useState('');
  const [problemCount, setProblemCount] = useState(String(MIN_PROBLEM_COUNT));
  const [loading, setLoading] = useState(false);

  const loadSubject = useCallback(async () => {
    try {
      const data = await getSubjectById(subjectId);
      setSubject(data);
    } catch {
      alert('Notebook not found');
      onBack();
    }
  }, [subjectId, onBack]);

  const loadAssignments = useCallback(async () => {
    const data = await listAssignments(subjectId);
    setAssignments(data);
  }, [subjectId]);

  useEffect(() => {
    void loadSubject();
    void loadAssignments();
  }, [loadSubject, loadAssignments]);

  const handleCreateAssignment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assignmentTitle.trim()) return;

    const parsedCount = Number(problemCount);
    if (
      !Number.isInteger(parsedCount) ||
      parsedCount < MIN_PROBLEM_COUNT ||
      parsedCount > MAX_PROBLEM_COUNT
    ) {
      alert(`Problem count must be between ${MIN_PROBLEM_COUNT} and ${MAX_PROBLEM_COUNT}`);
      return;
    }

    setLoading(true);
    try {
      await createAssignment(subjectId, assignmentTitle.trim(), parsedCount);
      setAssignmentTitle('');
      setProblemCount(String(MIN_PROBLEM_COUNT));
      await loadAssignments();
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteAssignment = async (assignmentId: string, title: string) => {
    if (!window.confirm(`Delete assignment "${title}"?`)) return;

    setLoading(true);
    try {
      await deleteAssignment(assignmentId);
      await loadAssignments();
    } finally {
      setLoading(false);
    }
  };

  if (!subject) {
    return (
      <div className="app-content">
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <div className="app-content">
      <div className="welcome-section">
        <button 
          onClick={onBack}
          className="btn-secondary"
          style={{ marginBottom: '16px', width: 'fit-content' }}
        >
          <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M15 10H5M5 10l4 4M5 10l4-4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Back to Notebooks
        </button>
        <h1>📚 {subject.name}</h1>
        <p>Manage assignments and problems for this notebook</p>
      </div>

      <div className="form-section mb-3">
        <h2>Create New Assignment</h2>
        <form onSubmit={handleCreateAssignment} className="form-row">
          <input
            type="text"
            value={assignmentTitle}
            onChange={(e) => setAssignmentTitle(e.target.value)}
            placeholder="Assignment title (e.g., Chapter 3 Problems)"
            disabled={loading}
          />
          <input
            type="number"
            min={MIN_PROBLEM_COUNT}
            max={MAX_PROBLEM_COUNT}
            value={problemCount}
            onChange={(e) => setProblemCount(e.target.value)}
            placeholder="Problems (1-60)"
            style={{ width: '150px' }}
            disabled={loading}
          />
          <button type="submit" className="btn-primary" disabled={loading || !assignmentTitle.trim()}>
            Create
          </button>
        </form>
      </div>

      <div>
        <h2 className="page-section-title mb-2">
          📝 Assignments
        </h2>
        {assignments.length === 0 ? (
          <p className="text-muted">No assignments yet. Create one to get started!</p>
        ) : (
          <div className="cards-grid">
            {assignments.map((assignment) => (
              <div key={assignment.id} className="card" style={{ cursor: 'default' }}>
                <h2>{assignment.title}</h2>
                <p className="text-sm text-muted mb-1">
                  Problems: {normalizeProblemCount(assignment.problemCount)}
                </p>
                <p className="text-sm text-muted">
                  Updated: {formatDate(assignment.updatedAt)}
                </p>
                <div className="card-actions">
                  <button
                    className="btn-sm btn-primary"
                    onClick={() => onOpenAssignment(assignment.id)}
                  >
                    Open
                  </button>
                  <button
                    className="btn-sm btn-danger"
                    onClick={() => handleDeleteAssignment(assignment.id, assignment.title)}
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
