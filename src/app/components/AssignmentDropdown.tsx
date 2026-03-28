import React from 'react';
import { ChevronDown, ChevronRight, Plus } from 'lucide-react';
import { ProblemList } from './ProblemList';
import { AddQuestionButton } from './AddQuestionButton';

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

interface AssignmentDropdownProps {
  subjectId: string;
  assignment: AssignmentRecord;
  expanded: boolean;
  loadingProblems: boolean;
  problems: ProblemRecord[];
  onClick: (subjectId: string, assignmentId: string) => void | Promise<void>;
  onProblemClick: (subjectId: string, assignmentId: string, problemIndex: number) => void;
  onAddQuestion: (subjectId: string, assignmentId: string) => void | Promise<void>;
}

export function AssignmentDropdown({
  subjectId,
  assignment,
  expanded,
  loadingProblems,
  problems,
  onClick,
  onProblemClick,
  onAddQuestion,
}: AssignmentDropdownProps) {
  return (
    <div className={`assignment-dropdown ${expanded ? 'expanded' : ''}`}>
      <button type="button" className="assignment-dropdown-trigger" onClick={() => void onClick(subjectId, assignment.id)}>
        <span className="assignment-chevron">
          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </span>
        <span className="assignment-copy">
          <strong>{assignment.title}</strong>
          <span>{assignment.problemCount} problems</span>
        </span>
        <span className="assignment-hint">Click again to open page</span>
      </button>

      <div className={`assignment-dropdown-body ${expanded ? 'open' : ''}`}>
        {expanded ? (
          <>
            <div className="assignment-inline-actions">
              <AddQuestionButton onClick={() => void onAddQuestion(subjectId, assignment.id)} />
            </div>

            {loadingProblems ? (
              <p className="text-muted hierarchy-loading">Loading problems...</p>
            ) : (
              <ProblemList
                subjectId={subjectId}
                assignmentId={assignment.id}
                problems={problems}
                onProblemClick={onProblemClick}
              />
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
