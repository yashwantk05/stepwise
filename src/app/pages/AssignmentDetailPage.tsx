import React, { useState, useEffect, useCallback } from 'react';
import { getAssignmentById, getSubjectById, addProblemToAssignment, deleteLastProblemFromAssignment } from '../services/storage';

const MIN_PROBLEM_COUNT = 1;
const MAX_PROBLEM_COUNT = 60;

const normalizeProblemCount = (value: number) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return MIN_PROBLEM_COUNT;
  return Math.min(MAX_PROBLEM_COUNT, Math.max(MIN_PROBLEM_COUNT, parsed));
};

const buildProblemIndexes = (problemCount: number) =>
  Array.from({ length: normalizeProblemCount(problemCount) }, (_value, index) => index + 1);

interface AssignmentDetailPageProps {
  subjectId: string;
  assignmentId: string;
  onBack: () => void;
  onOpenProblem: (problemIndex: number) => void;
}

export function AssignmentDetailPage({ subjectId, assignmentId, onBack, onOpenProblem }: AssignmentDetailPageProps) {
  const [subject, setSubject] = useState<any>(null);
  const [assignment, setAssignment] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      const [subjectData, assignmentData] = await Promise.all([
        getSubjectById(subjectId),
        getAssignmentById(assignmentId)
      ]);
      setSubject(subjectData);
      setAssignment(assignmentData);
    } catch {
      alert('Assignment not found');
      onBack();
    }
  }, [subjectId, assignmentId, onBack]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleAddProblem = async () => {
    if (!assignment) return;
    setLoading(true);
    try {
      const updated = await addProblemToAssignment(assignment.id);
      setAssignment(updated);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteLastProblem = async () => {
    if (!assignment) return;
    const shouldDelete = window.confirm(
      `Delete Problem ${assignment.problemCount}? This removes its saved whiteboard and image.`
    );
    if (!shouldDelete) return;

    setLoading(true);
    try {
      const result = await deleteLastProblemFromAssignment(assignment.id);
      setAssignment(result.assignment);
    } finally {
      setLoading(false);
    }
  };

  if (!assignment || !subject) {
    return (
      <div className="app-content">
        <p>Loading...</p>
      </div>
    );
  }

  const problemIndexes = buildProblemIndexes(assignment.problemCount);

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
          Back to {subject.name}
        </button>
        <h1>📝 {assignment.title}</h1>
        <p>{subject.name} • {normalizeProblemCount(assignment.problemCount)} problems</p>
      </div>

      <div className="form-section mb-3">
        <h2>Manage Problems</h2>
        <div className="form-row">
          <button
            type="button"
            className="btn-primary"
            onClick={handleAddProblem}
            disabled={loading || normalizeProblemCount(assignment.problemCount) >= MAX_PROBLEM_COUNT}
          >
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M10 5v10M5 10h10" strokeLinecap="round" />
            </svg>
            Add Problem
          </button>
          <button
            type="button"
            className="btn-danger"
            onClick={handleDeleteLastProblem}
            disabled={loading || normalizeProblemCount(assignment.problemCount) <= MIN_PROBLEM_COUNT}
          >
            Delete Last Problem
          </button>
        </div>
        <p className="form-help">
          Warning: Deleting a problem permanently removes its saved whiteboard and image.
        </p>
      </div>

      <div>
        <h2 className="mb-2" style={{ fontSize: '20px', fontWeight: 600 }}>
          🎯 Problems
        </h2>
        <div className="cards-grid">
          {problemIndexes.map((problemIndex) => (
            <div
              key={problemIndex}
              className="card"
              onClick={() => onOpenProblem(problemIndex)}
              style={{ cursor: 'pointer' }}
            >
              <h2 style={{ fontSize: '18px' }}>Problem {problemIndex}</h2>
              <p className="text-muted text-sm">Click to open whiteboard</p>
              <div className="card-actions">
                <button
                  className="btn-sm btn-primary"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenProblem(problemIndex);
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M15 3v4M15 7h4M5 7H3a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-2" />
                    <path d="M6 12l9-9M11 3h4v4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  Open Whiteboard
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
