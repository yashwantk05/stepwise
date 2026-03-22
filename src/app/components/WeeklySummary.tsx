import React from 'react';
import { CalendarDays, Flame } from 'lucide-react';

interface WeeklySummaryProps {
  problemsSolved: number;
  studySessions: number;
  streakDays: number;
  solvedDelta: number;
  averageSessionsPerDay: string;
}

export function WeeklySummary({
  problemsSolved,
  studySessions,
  streakDays,
  solvedDelta,
  averageSessionsPerDay,
}: WeeklySummaryProps) {
  return (
    <section className="progress-weekly-summary">
      <div className="progress-panel-heading">
        <div>
          <h2>
            <CalendarDays size={18} />
            This Week&apos;s Summary
          </h2>
        </div>
      </div>

      <div className="progress-weekly-grid">
        <article className="progress-weekly-card">
          <span>Problems Solved</span>
          <strong>{problemsSolved}</strong>
          <label>{`${solvedDelta >= 0 ? '+' : ''}${solvedDelta} from last week`}</label>
        </article>
        <article className="progress-weekly-card">
          <span>Study Sessions</span>
          <strong>{studySessions}</strong>
          <label>{averageSessionsPerDay} per day avg</label>
        </article>
        <article className="progress-weekly-card">
          <span>Streak Days</span>
          <strong>
            {streakDays} <Flame size={16} />
          </strong>
          <label>Personal best!</label>
        </article>
      </div>
    </section>
  );
}
