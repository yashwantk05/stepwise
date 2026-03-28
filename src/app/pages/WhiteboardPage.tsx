import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { listSubjects, createSubject, deleteSubject, listAssignments, listAssignmentProblems, addProblemToAssignment } from '../services/storage';
import { NotebookList } from '../components/NotebookList';

const formatDate = (time: number) => new Date(time).toLocaleDateString();

interface WhiteboardPageProps {
  onOpenSubject: (subjectId: string) => void;
  onOpenAssignment: (subjectId: string, assignmentId: string) => void;
  onOpenProblem: (subjectId: string, assignmentId: string, problemIndex: number) => void;
}

interface SubjectRecord {
  id: string;
  name: string;
  createdAt: number;
}

interface AssignmentRecord {
  id: string;
  title: string;
  problemCount: number;
  updatedAt?: number;
}

interface ProblemRecord {
  problemIndex: number;
  title: string;
}

export function WhiteboardPage({ onOpenSubject, onOpenAssignment, onOpenProblem }: WhiteboardPageProps) {
  const [subjects, setSubjects] = useState<SubjectRecord[]>([]);
  const [subjectName, setSubjectName] = useState('');
  const [loading, setLoading] = useState(false);
  const [expandedNotebook, setExpandedNotebook] = useState<string | null>(null);
  const [expandedAssignment, setExpandedAssignment] = useState<string | null>(null);
  const [assignmentsBySubject, setAssignmentsBySubject] = useState<Record<string, AssignmentRecord[]>>({});
  const [problemsByAssignment, setProblemsByAssignment] = useState<Record<string, ProblemRecord[]>>({});
  const [loadingAssignments, setLoadingAssignments] = useState<Record<string, boolean>>({});
  const [loadingProblems, setLoadingProblems] = useState<Record<string, boolean>>({});

  const loadSubjects = useCallback(async () => {
    const data = (await listSubjects()) as SubjectRecord[];
    setSubjects(data);
  }, []);

  const loadAssignmentsForNotebook = useCallback(async (subjectId: string) => {
    setLoadingAssignments((previous) => ({ ...previous, [subjectId]: true }));
    try {
      const data = (await listAssignments(subjectId)) as AssignmentRecord[];
      setAssignmentsBySubject((previous) => ({ ...previous, [subjectId]: data }));
    } finally {
      setLoadingAssignments((previous) => ({ ...previous, [subjectId]: false }));
    }
  }, []);

  const loadProblemsForAssignment = useCallback(async (assignmentId: string) => {
    setLoadingProblems((previous) => ({ ...previous, [assignmentId]: true }));
    try {
      const data = (await listAssignmentProblems(assignmentId)) as ProblemRecord[];
      setProblemsByAssignment((previous) => ({ ...previous, [assignmentId]: data }));
    } finally {
      setLoadingProblems((previous) => ({ ...previous, [assignmentId]: false }));
    }
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
      setAssignmentsBySubject((previous) => {
        const next = { ...previous };
        delete next[subjectId];
        return next;
      });
      await loadSubjects();
    } finally {
      setLoading(false);
    }
  };

  const handleToggleNotebook = async (subjectId: string) => {
    if (expandedNotebook === subjectId) {
      setExpandedNotebook(null);
      setExpandedAssignment(null);
      return;
    }

    setExpandedNotebook(subjectId);
    setExpandedAssignment(null);
    if (!assignmentsBySubject[subjectId]) {
      await loadAssignmentsForNotebook(subjectId);
    }
  };

  const handleAssignmentInteraction = async (subjectId: string, assignmentId: string) => {
    const isExpanded = expandedAssignment === assignmentId;

    if (!isExpanded) {
      setExpandedAssignment(assignmentId);
      if (!problemsByAssignment[assignmentId]) {
        await loadProblemsForAssignment(assignmentId);
      }
      return;
    }

    onOpenAssignment(subjectId, assignmentId);
  };

  const handleAddQuestion = async (subjectId: string, assignmentId: string) => {
    setLoadingProblems((previous) => ({ ...previous, [assignmentId]: true }));
    try {
      await addProblemToAssignment(assignmentId);
      await Promise.all([
        loadAssignmentsForNotebook(subjectId),
        loadProblemsForAssignment(assignmentId),
      ]);
      setExpandedNotebook(subjectId);
      setExpandedAssignment(assignmentId);
    } finally {
      setLoadingProblems((previous) => ({ ...previous, [assignmentId]: false }));
    }
  };

  const notebookItems = useMemo(
    () =>
      subjects.map((subject) => ({
        ...subject,
        assignments: assignmentsBySubject[subject.id] || [],
      })),
    [assignmentsBySubject, subjects],
  );

  return (
    <div className="app-content">
      <div className="welcome-section">
        <p className="eyebrow">AI Whiteboard</p>
        <h1>My Notebooks</h1>
        <p>Browse notebooks, expand assignments, and jump straight into any problem whiteboard.</p>
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

      <div className="whiteboard-hierarchy-section">
        <div className="whiteboard-hierarchy-header">
          <div>
            <h2>Notebook Explorer</h2>
            <p>First click expands. Click an expanded assignment again to open the full assignment page.</p>
          </div>
        </div>

        {notebookItems.length === 0 ? (
          <p className="text-muted">No notebooks yet. Create your first notebook above to get started.</p>
        ) : (
          <NotebookList
            notebooks={notebookItems}
            expandedNotebook={expandedNotebook}
            expandedAssignment={expandedAssignment}
            loadingAssignments={loadingAssignments}
            loadingProblems={loadingProblems}
            problemsByAssignment={problemsByAssignment}
            onToggleNotebook={handleToggleNotebook}
            onAssignmentClick={handleAssignmentInteraction}
            onProblemClick={onOpenProblem}
            onOpenNotebook={onOpenSubject}
            onDeleteNotebook={handleDeleteSubject}
            onAddQuestion={handleAddQuestion}
            formatDate={formatDate}
          />
        )}
      </div>
    </div>
  );
}
