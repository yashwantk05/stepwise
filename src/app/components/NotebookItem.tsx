import React from 'react';
import { ChevronDown, ChevronRight, FolderOpen, Trash2 } from 'lucide-react';
import { AssignmentDropdown } from './AssignmentDropdown';

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

interface NotebookRecord {
  id: string;
  name: string;
  createdAt: number;
  assignments: AssignmentRecord[];
}

interface NotebookItemProps {
  notebook: NotebookRecord;
  expanded: boolean;
  expandedAssignment: string | null;
  loadingAssignments: boolean;
  loadingProblems: Record<string, boolean>;
  problemsByAssignment: Record<string, ProblemRecord[]>;
  onToggleNotebook: (subjectId: string) => void | Promise<void>;
  onAssignmentClick: (subjectId: string, assignmentId: string) => void | Promise<void>;
  onProblemClick: (subjectId: string, assignmentId: string, problemIndex: number) => void;
  onOpenNotebook: (subjectId: string) => void;
  onDeleteNotebook: (subjectId: string, name: string) => void;
  onAddQuestion: (subjectId: string, assignmentId: string) => void | Promise<void>;
  formatDate: (time: number) => string;
}

export function NotebookItem({
  notebook,
  expanded,
  expandedAssignment,
  loadingAssignments,
  loadingProblems,
  problemsByAssignment,
  onToggleNotebook,
  onAssignmentClick,
  onProblemClick,
  onOpenNotebook,
  onDeleteNotebook,
  onAddQuestion,
  formatDate,
}: NotebookItemProps) {
  return (
    <section className={`notebook-item ${expanded ? 'expanded' : ''}`}>
      <div className="notebook-item-header">
        <button type="button" className="notebook-toggle" onClick={() => void onToggleNotebook(notebook.id)}>
          <span className="notebook-chevron">
            {expanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
          </span>
          <span className="notebook-icon">📘</span>
          <span className="notebook-copy">
            <strong>{notebook.name}</strong>
            <span>Created: {formatDate(notebook.createdAt)}</span>
          </span>
        </button>

        <div className="notebook-actions">
          <button type="button" className="btn-sm btn-secondary" onClick={() => onOpenNotebook(notebook.id)}>
            <FolderOpen size={14} />
            Open Page
          </button>
          <button type="button" className="btn-sm btn-danger" onClick={() => onDeleteNotebook(notebook.id, notebook.name)}>
            <Trash2 size={14} />
            Delete
          </button>
        </div>
      </div>

      <div className={`notebook-item-body ${expanded ? 'open' : ''}`}>
        {expanded ? (
          loadingAssignments ? (
            <p className="text-muted hierarchy-loading">Loading assignments...</p>
          ) : notebook.assignments.length === 0 ? (
            <p className="text-muted hierarchy-loading">No assignments yet. Open the notebook page to create one.</p>
          ) : (
            notebook.assignments.map((assignment) => (
              <AssignmentDropdown
                key={assignment.id}
                subjectId={notebook.id}
                assignment={assignment}
                expanded={expandedAssignment === assignment.id}
                loadingProblems={Boolean(loadingProblems[assignment.id])}
                problems={problemsByAssignment[assignment.id] || []}
                onClick={onAssignmentClick}
                onProblemClick={onProblemClick}
                onAddQuestion={onAddQuestion}
              />
            ))
          )
        ) : null}
      </div>
    </section>
  );
}
