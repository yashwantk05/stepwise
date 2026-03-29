import React from 'react';
import { BookMarked, ChevronDown, Lightbulb } from 'lucide-react';
import { InsightGroup, InsightGroupData } from './InsightGroup';

export interface NotebookInsightData {
  notebook: string;
  groups: InsightGroupData[];
}

interface InsightsAccordionProps {
  notebooks: NotebookInsightData[];
}

export function InsightsAccordion({ notebooks }: InsightsAccordionProps) {
  if (notebooks.length === 0) {
    return (
      <div className="learning-empty-state">
        <Lightbulb size={18} />
        <p>No learning insights yet. As you solve more questions, patterns will appear here.</p>
      </div>
    );
  }

  return (
    <div className="learning-accordion">
      {notebooks.map((notebook) => (
        <details key={notebook.notebook} className="learning-notebook" open>
          <summary>
            <span className="learning-summary-copy">
              <BookMarked size={16} />
              <span data-no-translate="true">{notebook.notebook}</span>
            </span>
            <ChevronDown size={18} />
          </summary>
          <div className="learning-notebook-body">
            {notebook.groups.map((group) => (
              <InsightGroup key={group.id} group={group} />
            ))}
          </div>
        </details>
      ))}
    </div>
  );
}
