import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Lightbulb, TrendingDown } from 'lucide-react';
import { HeatmapChart, HeatmapDatum } from '../components/HeatmapChart';
import { InsightsAccordion, NotebookInsightData } from '../components/InsightsAccordion';
import { WeakTopicCard } from '../components/WeakTopicCard';
import {
  getAssignmentProblemProgress,
  getErrorSummary,
  getProblemErrors,
  listAssignments,
  listSubjects,
} from '../services/storage';

interface SubjectRecord {
  id: string;
  name: string;
}

interface AssignmentRecord {
  id: string;
  title: string;
  problemCount: number;
}

interface ProblemProgressRecord {
  problemIndex: number;
  mistakeCount?: number;
}

interface ErrorSummaryRecord {
  key?: string;
  count?: number;
}

interface ProblemErrorItemRecord {
  errorType?: string;
  mistakeSummary?: string;
  suggestedFix?: string;
}

interface ProblemErrorAttemptRecord {
  mistakes?: ProblemErrorItemRecord[];
}

interface WeakTopic {
  topic: string;
  notebook: string;
  mistakes: number;
}

const normalizeLabel = (value: unknown) => String(value || '').trim();

const formatErrorTypeTitle = (value: string) =>
  value
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase()) || 'Concept Review';

const buildFixExplanation = (title: string) => {
  const lowered = title.toLowerCase();
  if (lowered.includes('sign')) {
    return 'Track sign changes one operation at a time and verify each transition before simplifying.';
  }
  if (lowered.includes('formula') || lowered.includes('equation')) {
    return 'Write the target formula first, label known values, then substitute in a separate line.';
  }
  if (lowered.includes('step')) {
    return 'Split the solution into smaller steps and check each line before moving forward.';
  }
  if (lowered.includes('arithmetic') || lowered.includes('calculation')) {
    return 'Recalculate intermediate values before the final step to catch arithmetic slips early.';
  }
  return 'Review this pattern with one solved example, then redo the same type without hints.';
};

export function WeakAreasPage() {
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('Loading learning diagnostics...');
  const [heatmapData, setHeatmapData] = useState<HeatmapDatum[]>([]);
  const [weakTopics, setWeakTopics] = useState<WeakTopic[]>([]);
  const [insightGroups, setInsightGroups] = useState<NotebookInsightData[]>([]);

  const loadWeakAreas = useCallback(async () => {
    setLoading(true);
    setStatus('Loading learning diagnostics...');

    try {
      const subjects = (await listSubjects()) as SubjectRecord[];
      const assignmentLists = await Promise.all(
        subjects.map(async (subject) => ({
          subject,
          assignments: (await listAssignments(subject.id)) as AssignmentRecord[],
        })),
      );

      const notebookStats = await Promise.all(
        assignmentLists.map(async ({ subject, assignments }) => {
          let totalQuestions = 0;
          let totalMistakes = 0;

          const topicCounts = new Map<string, number>();
          const errorTypeCounts = new Map<string, number>();
          const groupedInsights = new Map<string, { title: string; errors: Set<string>; fixes: Set<string> }>();

          for (const assignment of assignments) {
            totalQuestions += Math.max(0, Number(assignment.problemCount) || 0);

            const [progressRows, topicRows, errorTypeRows] = await Promise.all([
              getAssignmentProblemProgress(assignment.id) as Promise<ProblemProgressRecord[]>,
              getErrorSummary('topic', { assignmentId: assignment.id, limit: 30 }) as Promise<ErrorSummaryRecord[]>,
              getErrorSummary('errorType', { assignmentId: assignment.id, limit: 20 }) as Promise<ErrorSummaryRecord[]>,
            ]);

            progressRows.forEach((row) => {
              totalMistakes += Math.max(0, Number(row.mistakeCount || 0));
            });

            topicRows.forEach((row) => {
              const topic = normalizeLabel(row.key);
              const count = Math.max(0, Number(row.count || 0));
              if (!topic || count <= 0) return;
              topicCounts.set(topic, (topicCounts.get(topic) || 0) + count);
            });

            errorTypeRows.forEach((row) => {
              const rawType = normalizeLabel(row.key);
              const normalizedKey = rawType.toLowerCase() || 'concept review';
              const count = Math.max(0, Number(row.count || 0));
              if (count <= 0) return;

              errorTypeCounts.set(normalizedKey, (errorTypeCounts.get(normalizedKey) || 0) + count);
              if (!groupedInsights.has(normalizedKey)) {
                groupedInsights.set(normalizedKey, {
                  title: formatErrorTypeTitle(rawType || normalizedKey),
                  errors: new Set<string>(),
                  fixes: new Set<string>(),
                });
              }
            });

            const problemIndexesWithMistakes = progressRows
              .filter((row) => Number(row.mistakeCount || 0) > 0)
              .map((row) => Number(row.problemIndex))
              .filter((value) => Number.isInteger(value) && value > 0)
              .slice(0, 6);

            const attemptsByProblem = await Promise.all(
              problemIndexesWithMistakes.map((problemIndex) =>
                getProblemErrors(assignment.id, problemIndex)
                  .then((attempts) => attempts as ProblemErrorAttemptRecord[])
                  .catch(() => [] as ProblemErrorAttemptRecord[]),
              ),
            );

            attemptsByProblem.flat().forEach((attempt) => {
              (attempt.mistakes || []).forEach((item) => {
                const rawType = normalizeLabel(item.errorType) || 'concept review';
                const normalizedKey = rawType.toLowerCase();
                if (!groupedInsights.has(normalizedKey)) {
                  groupedInsights.set(normalizedKey, {
                    title: formatErrorTypeTitle(rawType),
                    errors: new Set<string>(),
                    fixes: new Set<string>(),
                  });
                }

                const bucket = groupedInsights.get(normalizedKey);
                if (!bucket) return;

                const summary = normalizeLabel(item.mistakeSummary);
                const fix = normalizeLabel(item.suggestedFix);
                if (summary) bucket.errors.add(summary);
                if (fix) bucket.fixes.add(fix);
              });
            });
          }

          const groups = Array.from(groupedInsights.entries())
            .sort(
              (left, right) =>
                (errorTypeCounts.get(right[0]) || 0) - (errorTypeCounts.get(left[0]) || 0),
            )
            .map(([key, value]) => ({
              id: `${subject.id}-${key}`,
              title: value.title,
              errors:
                value.errors.size > 0
                  ? Array.from(value.errors).slice(0, 4)
                  : [`${errorTypeCounts.get(key) || 0} mistakes detected in this category.`],
              fix:
                value.fixes.size > 0
                  ? Array.from(value.fixes).slice(0, 2).join(' ')
                  : buildFixExplanation(value.title),
            }))
            .filter((group) => group.errors.length > 0);

          return {
            notebook: subject.name,
            score: totalQuestions > 0 ? Math.min(1, totalMistakes / totalQuestions) : 0,
            totalMistakes,
            topicCounts,
            groups,
          };
        }),
      );

      const heatmap = notebookStats
        .filter((entry) => entry.totalMistakes > 0)
        .map((entry) => ({ notebook: entry.notebook, score: Number(entry.score.toFixed(2)) }))
        .sort((left, right) => right.score - left.score);

      const topTopics = notebookStats
        .flatMap((entry) =>
          Array.from(entry.topicCounts.entries()).map(([topic, mistakes]) => ({
            notebook: entry.notebook,
            topic,
            mistakes,
          })),
        )
        .sort((left, right) => right.mistakes - left.mistakes)
        .slice(0, 3);

      const notebooks = notebookStats
        .filter((entry) => entry.groups.length > 0)
        .map((entry) => ({ notebook: entry.notebook, groups: entry.groups }));

      const notebooksWithSignal = notebookStats.filter(
        (entry) => entry.totalMistakes > 0 || entry.groups.length > 0,
      ).length;

      setHeatmapData(heatmap);
      setWeakTopics(topTopics);
      setInsightGroups(notebooks);
      setStatus(
        notebooksWithSignal > 0
          ? `Built from ${notebooksWithSignal} notebooks using stored problem progress and error analysis.`
          : 'No error-analysis data yet. Solve whiteboard problems to build your improvement zones.',
      );
    } catch {
      setHeatmapData([]);
      setWeakTopics([]);
      setInsightGroups([]);
      setStatus('Unable to load weak-area diagnostics right now.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadWeakAreas();
  }, [loadWeakAreas]);

  const notebookCount = useMemo(() => heatmapData.length, [heatmapData]);

  return (
    <div className="app-content">
      <section className="weak-areas-page">
        <header className="weak-header">
          <div>
            <span className="weak-kicker">Performance Diagnostics</span>
            <h1>Improvement Zones</h1>
            <p>Diagnostics to identify and improve weak concepts</p>
          </div>
          <div className="weak-status-card">
            <TrendingDown size={18} />
            <div>
              <strong>{notebookCount}</strong>
              <span>{status}</span>
            </div>
          </div>
        </header>

        <section className="weak-panel">
          <div className="weak-panel-heading">
            <div>
              <h2>
                <AlertTriangle size={18} />
                Mistake Heatmap
              </h2>
              <p>Topics where you make the most mistakes</p>
            </div>
          </div>

          {loading ? <div className="weak-loading">Analyzing your notebook history...</div> : <HeatmapChart data={heatmapData} />}

          <div className="weak-topic-grid">
            {weakTopics.length > 0 ? (
              weakTopics.map((topic) => (
                <WeakTopicCard
                  key={`${topic.notebook}-${topic.topic}`}
                  topic={topic.topic}
                  notebook={topic.notebook}
                  mistakes={topic.mistakes}
                />
              ))
            ) : (
              <div className="weak-empty-cards">Top weak topics will appear here once mistake data is available.</div>
            )}
          </div>
        </section>

        <section className="weak-panel learning-panel">
          <div className="weak-panel-heading">
            <div>
              <h2>
                <Lightbulb size={18} />
                Learning Insights
              </h2>
              <p>Patterns detected in your learning behavior</p>
            </div>
          </div>

          <InsightsAccordion notebooks={insightGroups} />
        </section>
      </section>
    </div>
  );
}
