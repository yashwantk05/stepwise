import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Lightbulb, TrendingUp } from 'lucide-react';
import { HeatmapChart, HeatmapDatum } from '../components/HeatmapChart';
import { InsightsAccordion, NotebookInsightData } from '../components/InsightsAccordion';
import { WeakTopicCard } from '../components/WeakTopicCard';
import {
  getAssignmentProblemProgress,
  getErrorSummary,
  getNotebookQuizSessions,
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
  label?: string;
  topic?: string;
  concept?: string;
  errorType?: string;
  count?: number;
  mistakes?: number;
  total?: number;
}

interface ProblemErrorItemRecord {
  errorType?: string;
  mistakeSummary?: string;
  whyWrong?: string;
  suggestedFix?: string;
  topics?: string[];
  concepts?: string[];
}

interface ProblemErrorAttemptRecord {
  mistakes?: ProblemErrorItemRecord[];
}

interface NotebookQuizSessionRecord {
  subjectId: string;
  totalQuestions?: number;
  correctCount?: number;
  mistakeCount?: number;
}

interface WeakTopic {
  topic: string;
  notebook: string;
  mistakes: number;
}

const normalizeLabel = (value: unknown) => String(value || '').trim();
const parseSummaryKey = (row: ErrorSummaryRecord) =>
  normalizeLabel(row.key || row.label || row.topic || row.concept || row.errorType);
const parseSummaryCount = (row: ErrorSummaryRecord) =>
  Math.max(0, Number(row.count ?? row.mistakes ?? row.total ?? 0));

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

const buildFallbackMistakes = (title: string) => {
  const lowered = title.toLowerCase();
  if (lowered.includes('sign')) {
    return [
      'Dropped a negative sign when distributing across parentheses.',
      'Swapped signs while moving terms across the equals sign.',
      'Combined unlike terms with the wrong sign after simplification.',
    ];
  }
  if (lowered.includes('formula') || lowered.includes('equation')) {
    return [
      'Plugged values into the formula without isolating the target variable.',
      'Used the correct formula but substituted the wrong value/units.',
      'Skipped the final simplification after substitution.',
    ];
  }
  if (lowered.includes('step')) {
    return [
      'Skipped an intermediate step that changed the structure of the expression.',
      'Combined steps too early and lost a term in the transition.',
      'Moved to the next step without re-checking the previous line.',
    ];
  }
  if (lowered.includes('arithmetic') || lowered.includes('calculation')) {
    return [
      'Miscalculated a product or division in the middle of the solution.',
      'Copied an intermediate value incorrectly into the next line.',
      'Rounded too early, which changed the final answer.',
    ];
  }
  if (lowered.includes('concept')) {
    return [
      'Chose the wrong method for this concept even though the goal was clear.',
      'Applied a rule that does not match the problem conditions.',
      'Stopped after a partial result instead of completing the full requirement.',
    ];
  }
  return [
    'Misidentified the key concept needed to solve the problem.',
    'Missed a condition or constraint stated in the prompt.',
    'Stopped after partial progress instead of reaching the final form.',
  ];
};

const buildInsightSummary = (title: string, count: number, uniqueErrors: number) => {
  const pluralizedCount = count === 1 ? 'mistake' : 'mistakes';
  const pluralizedPatterns = uniqueErrors === 1 ? 'pattern' : 'patterns';
  if (count === 0) {
    return `We have limited signal for ${title} so far. Keep solving to surface clearer patterns.`;
  }
  return `Observed ${count} ${pluralizedCount} in ${title} with ${uniqueErrors} ${pluralizedPatterns}. Use the examples below to compare against your recent attempts.`;
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
      const quizSessions = (await getNotebookQuizSessions()) as NotebookQuizSessionRecord[];
      const quizSessionsBySubject = quizSessions.reduce<Record<string, NotebookQuizSessionRecord[]>>(
        (accumulator, session) => {
          const subjectId = normalizeLabel(session.subjectId);
          if (!subjectId) return accumulator;
          if (!accumulator[subjectId]) accumulator[subjectId] = [];
          accumulator[subjectId].push(session);
          return accumulator;
        },
        {},
      );

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

          const subjectQuizSessions = quizSessionsBySubject[subject.id] || [];
          subjectQuizSessions.forEach((session) => {
            const sessionQuestions = Math.max(0, Number(session.totalQuestions || 0));
            const explicitMistakes = Number(session.mistakeCount);
            const derivedMistakes = sessionQuestions - Math.max(0, Number(session.correctCount || 0));
            const sessionMistakes = Number.isFinite(explicitMistakes)
              ? Math.max(0, explicitMistakes)
              : Math.max(0, derivedMistakes);

            totalQuestions += sessionQuestions;
            totalMistakes += sessionMistakes;
          });

          const topicCounts = new Map<string, number>();
          const errorTypeCounts = new Map<string, number>();
          const groupedInsights = new Map<
            string,
            {
              title: string;
              errors: Set<string>;
              fixes: Set<string>;
              topicMentions: Map<string, number>;
            }
          >();

          for (const assignment of assignments) {
            totalQuestions += Math.max(0, Number(assignment.problemCount) || 0);

            const [progressRows, topicRows, errorTypeRows] = await Promise.all([
              getAssignmentProblemProgress(assignment.id) as Promise<ProblemProgressRecord[]>,
              getErrorSummary('topic', { assignmentId: assignment.id, limit: 30 }) as Promise<ErrorSummaryRecord[]>,
              getErrorSummary('errorType', { assignmentId: assignment.id, limit: 20 }) as Promise<ErrorSummaryRecord[]>,
            ]);

            const assignmentMistakesFromProgress = progressRows.reduce(
              (sum, row) => sum + Math.max(0, Number(row.mistakeCount || 0)),
              0,
            );
            let assignmentMistakesFromErrorSummary = 0;

            topicRows.forEach((row) => {
              const topic = parseSummaryKey(row);
              const count = parseSummaryCount(row);
              if (!topic || count <= 0) return;
              topicCounts.set(topic, (topicCounts.get(topic) || 0) + count);
            });

            errorTypeRows.forEach((row) => {
              const rawType = parseSummaryKey(row);
              const normalizedKey = rawType.toLowerCase() || 'concept review';
              const count = parseSummaryCount(row);
              if (count <= 0) return;
              assignmentMistakesFromErrorSummary += count;

              errorTypeCounts.set(normalizedKey, (errorTypeCounts.get(normalizedKey) || 0) + count);
              if (!groupedInsights.has(normalizedKey)) {
                groupedInsights.set(normalizedKey, {
                  title: formatErrorTypeTitle(rawType || normalizedKey),
                  errors: new Set<string>(),
                  fixes: new Set<string>(),
                  topicMentions: new Map<string, number>(),
                });
              }
            });
            totalMistakes += Math.max(
              assignmentMistakesFromProgress,
              assignmentMistakesFromErrorSummary,
            );

            const problemIndexesWithMistakes = progressRows
              .filter((row) => Number(row.mistakeCount || 0) > 0)
              .map((row) => Number(row.problemIndex))
              .filter((value) => Number.isInteger(value) && value >= 0)
              .slice(0, 12);

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
                    topicMentions: new Map<string, number>(),
                  });
                }

                const bucket = groupedInsights.get(normalizedKey);
                if (!bucket) return;

                const summary = normalizeLabel(item.mistakeSummary);
                const whyWrong = normalizeLabel(item.whyWrong);
                const fix = normalizeLabel(item.suggestedFix);
                if (summary || whyWrong) {
                  const combined = summary && whyWrong ? `${summary} — ${whyWrong}` : summary || whyWrong;
                  if (combined) bucket.errors.add(combined);
                } else if (rawType) {
                  bucket.errors.add(`Error type: ${formatErrorTypeTitle(rawType)}`);
                }
                if (fix) bucket.fixes.add(fix);
                const contextTopics = [...(item.topics || []), ...(item.concepts || [])]
                  .map((value) => normalizeLabel(value))
                  .filter(Boolean);
                contextTopics.forEach((topic) => {
                  bucket.topicMentions.set(topic, (bucket.topicMentions.get(topic) || 0) + 1);
                });
              });
            });
          }

          const groups = Array.from(groupedInsights.entries())
            .sort(
              (left, right) =>
                (errorTypeCounts.get(right[0]) || 0) - (errorTypeCounts.get(left[0]) || 0),
            )
            .map(([key, value]) => {
              const resolvedCount = Math.max(errorTypeCounts.get(key) || 0, value.errors.size);
              const topTopic = Array.from(value.topicMentions.entries())
                .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0];
              return {
                id: `${subject.id}-${key}`,
                title: value.title,
                topic: topTopic,
                summary: buildInsightSummary(value.title, resolvedCount, value.errors.size),
                count: resolvedCount,
                uniqueErrors: value.errors.size,
                uniqueFixes: value.fixes.size,
                errors:
                  value.errors.size > 0
                    ? Array.from(value.errors).slice(0, 6)
                    : buildFallbackMistakes(value.title),
                fixes:
                  value.fixes.size > 0
                    ? Array.from(value.fixes).slice(0, 3)
                    : [buildFixExplanation(value.title)],
              };
            })
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
        .map((entry) => ({ notebook: entry.notebook, score: entry.score }))
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
          ? `Built from ${notebooksWithSignal} notebooks using problem progress, quiz sessions, and error analysis.`
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
            <h1 className="page-hero-title">Improvement Zones</h1>
            <p className="page-hero-subtitle">Diagnostics to identify and improve weak concepts</p>
          </div>
          <div className="weak-status-card">
            <TrendingUp size={18} />
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
