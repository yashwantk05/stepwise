import React from 'react';
import { ChevronDown } from 'lucide-react';

export interface InsightGroupData {
  id: string;
  title: string;
  errors: string[];
  fix: string;
}

interface InsightGroupProps {
  group: InsightGroupData;
}

export function InsightGroup({ group }: InsightGroupProps) {
  return (
    <details className="learning-group">
      <summary>
        <span>{group.title}</span>
        <ChevronDown size={16} />
      </summary>
      <div className="learning-group-body">
        <ul>
          {group.errors.map((error, index) => (
            <li key={`${group.id}-error-${index}`}>{error}</li>
          ))}
        </ul>
        <p>
          <strong>Fix:</strong> {group.fix}
        </p>
      </div>
    </details>
  );
}
