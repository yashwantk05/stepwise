import React from 'react';
import { NotebookItem } from './NotebookItem';

interface NotebookRecord {
  id: string;
  name: string;
  createdAt: number;
  assignments: AssignmentRecord[];
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

interface NotebookListProps {
  notebooks: NotebookRecord[];
  expandedNotebook: string | null;
  expandedAssignment: string | null;
  loadingAssignments: Record<string, boolean>;
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

export function NotebookList(props: NotebookListProps) {
  return (
    <div className="notebook-list">
      {props.notebooks.map((notebook) => (
        <NotebookItem
          key={notebook.id}
          notebook={notebook}
          expanded={props.expandedNotebook === notebook.id}
          expandedAssignment={props.expandedAssignment}
          loadingAssignments={Boolean(props.loadingAssignments[notebook.id])}
          loadingProblems={props.loadingProblems}
          problemsByAssignment={props.problemsByAssignment}
          onToggleNotebook={props.onToggleNotebook}
          onAssignmentClick={props.onAssignmentClick}
          onProblemClick={props.onProblemClick}
          onOpenNotebook={props.onOpenNotebook}
          onDeleteNotebook={props.onDeleteNotebook}
          onAddQuestion={props.onAddQuestion}
          formatDate={props.formatDate}
        />
      ))}
    </div>
  );
}
