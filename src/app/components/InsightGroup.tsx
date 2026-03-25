import React from 'react';
import { ChevronDown } from 'lucide-react';

export interface InsightGroupData {
  id: string;
  title: string;
  summary: string;
  count: number;
  uniqueErrors: number;
  uniqueFixes: number;
  errors: string[];
  fixes: string[];
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
        <p className="learning-insight-summary">{group.summary}</p>
        <div className="learning-insight-metrics">
          <span>
            <strong>{group.count}</strong> mistakes
          </span>
          <span>
            <strong>{group.uniqueErrors}</strong> patterns
          </span>
          <span>
            <strong>{group.uniqueFixes}</strong> fixes
          </span>
        </div>
        <div className="learning-insight-section">
          <h4>Common mistakes</h4>
          <ul>
            {group.errors.map((error, index) => (
              <li key={`${group.id}-error-${index}`}>{error}</li>
            ))}
          </ul>
        </div>
        <div className="learning-insight-section">
          <h4>Fixes to try</h4>
          <ul>
            {group.fixes.map((fix, index) => (
              <li key={`${group.id}-fix-${index}`}>{fix}</li>
            ))}
          </ul>
        </div>
      </div>
    </details>
  );
}
