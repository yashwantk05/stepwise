import React from 'react';

interface ProblemRecord {
  problemIndex: number;
  title: string;
}

interface ProblemListProps {
  subjectId: string;
  assignmentId: string;
  problems: ProblemRecord[];
  onProblemClick: (subjectId: string, assignmentId: string, problemIndex: number) => void;
}

export function ProblemList({ subjectId, assignmentId, problems, onProblemClick }: ProblemListProps) {
  if (problems.length === 0) {
    return <p className="text-muted hierarchy-loading">No problems yet. Add one below this assignment.</p>;
  }

  return (
    <div className="problem-list">
      {problems.map((problem) => (
        <button
          key={problem.problemIndex}
          type="button"
          className="problem-list-item"
          onClick={() => onProblemClick(subjectId, assignmentId, problem.problemIndex)}
        >
          <span className="problem-bullet">└──</span>
          <span className="problem-copy">
            <strong>{problem.title || `Problem ${problem.problemIndex}`}</strong>
            <span>Open whiteboard</span>
          </span>
        </button>
      ))}
    </div>
  );
}
