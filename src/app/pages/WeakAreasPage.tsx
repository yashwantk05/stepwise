import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Lightbulb, Target, TrendingDown } from 'lucide-react';
import { HeatmapChart, HeatmapDatum } from '../components/HeatmapChart';
import { InsightsAccordion, NotebookInsightData } from '../components/InsightsAccordion';
import { WeakTopicCard } from '../components/WeakTopicCard';
import { getAssignmentById, listAssignments, listSubjects } from '../services/storage';

interface SubjectRecord {
  id: string;
  name: string;
}

interface AssignmentRecord {
  id: string;
  title: string;
  problemCount: number;
  wrongStepsByProblem?: unknown;
  hintsByProblem?: unknown;
  insightsByProblem?: unknown;
  feedbackByProblem?: unknown;
  aiFeedbackByProblem?: unknown;
  [key: string]: unknown;
}

interface ProblemMistake {
  notebook: string;
  assignmentTitle: string;
  problemIndex: number;
  rawText: string;
  normalizedText: string;
}

interface WeakTopic {
  topic: string;
  notebook: string;
  mistakes: number;
}

interface NotebookProgressPlan {
  subjectId: string;
  notebook: string;
  practiceLabel: string;
  currentAccuracy: number;
  targetAccuracy: number;
  solvedProblems: number;
  totalProblems: number;
  weeks: number;
  resumeAssignmentId: string;
  resumeProblemIndex: number;
}

interface PerformanceSnapshot {
  problemsSolved: number;
  mistakes: number;
  totalQuestions: number;
  timeSpentMinutes: number;
  quizzesAttempted: number;
}

interface ProblemProgressRecord {
  assignmentId: string;
  problemIndex: number;
  attempted: boolean;
  solved: boolean;
  mistakeCount: number;
  totalTimeSeconds: number;
}

interface ProblemErrorSummaryRecord {
  assignmentId: string;
  groupBy: 'topic' | 'concept' | 'errorType';
  label: string;
  count: number;
}

interface NotebookQuizSessionRecord {
  subjectId: string;
  subjectName: string;
  attempted: boolean;
  solved: boolean;
  totalQuestions: number;
  correctCount: number;
  mistakeCount: number;
  totalTimeSeconds: number;
}

const WRONG_STEP_MATCHER =
  /\b(wrong|incorrect|mistake|error|invalid|not correct|don't|do not|avoid|confus|forgot|skip)\b/i;

const TOPIC_KEYWORDS = [
  'fractions',
  'linear equations',
  'equations',
  'negative numbers',
  'word problems',
  'area formulas',
  'perimeter',
  'formula',
  'sign',
  'subtraction',
  'addition',
  'multiplication',
  'division',
  'geometry',
  'algebra',
  'units',
  'simplification',
  'decimals',
];

const CLUSTER_PATTERNS = [
  { key: 'sign errors', title: 'Sign Errors', matcher: /\b(sign|negative|minus|positive)\b/i },
  { key: 'formula confusion', title: 'Formula Confusion', matcher: /\b(formula|area|perimeter|equation)\b/i },
  { key: 'missing steps', title: 'Missing Steps', matcher: /\b(skip|steps?|jumped|intermediate)\b/i },
  { key: 'arithmetic slips', title: 'Arithmetic Slips', matcher: /\b(add|subtract|multiply|divide|calculation|arithmetic)\b/i },
];

const FALLBACK_CLUSTER = { key: 'concept review', title: 'Concept Review' };

const pickProblemBucket = (value: unknown, problemIndex: number) => {
  if (!value) return null;
  if (Array.isArray(value)) return value[problemIndex - 1] ?? null;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return record[problemIndex] ?? record[String(problemIndex)] ?? null;
  }
  return null;
};

const extractEntries = (value: unknown, forcedKind: string | null = null): Array<{ content: string; kind: string | null }> => {
  if (!value) return [];

  if (typeof value === 'string') {
    return [{ content: value, kind: forcedKind }];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry) => extractEntries(entry, forcedKind));
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const hints = record.hints || record.hint || [];
    const wrong = record.wrongSteps || record.wrongStep || record.wrong || record.errors || record.mistakes || [];

    if ((Array.isArray(hints) && hints.length > 0) || (Array.isArray(wrong) && wrong.length > 0)) {
      return [...extractEntries(hints, 'hint'), ...extractEntries(wrong, 'wrong')];
    }

    const textValue =
      record.content || record.text || record.message || record.value || record.description || record.title || '';

    return textValue ? [{ content: String(textValue), kind: forcedKind || String(record.kind || record.type || '') || null }] : [];
  }

  return [];
};

const normalizeMistakeText = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const summarizeTopic = (text: string) => {
  const normalized = normalizeMistakeText(text);
  const keyword = TOPIC_KEYWORDS.find((entry) => normalized.includes(entry));
  if (keyword) {
    return keyword
      .split(' ')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }

  const words = normalized.split(' ').filter(Boolean);
  const shortPhrase = words.slice(0, 3).join(' ');
  return shortPhrase
    ? shortPhrase.replace(/\b\w/g, (character) => character.toUpperCase())
    : 'General Review';
};

const groupMistake = (text: string) => {
  const normalized = normalizeMistakeText(text);
  const cluster = CLUSTER_PATTERNS.find((pattern) => pattern.matcher.test(normalized));
  return cluster || FALLBACK_CLUSTER;
};

const buildFixExplanation = (title: string, errors: string[]) => {
  const combined = errors.join(' ').toLowerCase();
  if (title === 'Sign Errors') {
    return 'Always track sign changes one step at a time and reread each operation before simplifying.';
  }
  if (title === 'Formula Confusion') {
    return 'Write the target formula first, label each value, and then substitute so similar formulas do not blend together.';
  }
  if (title === 'Missing Steps') {
    return 'Slow the solution down by writing each transformation on its own line before moving to the next step.';
  }
  if (combined.includes('fraction')) {
    return 'Reduce the fraction workflow into separate numerator and denominator checks before combining them.';
  }
  return 'Rebuild the method in smaller checkpoints so you can verify accuracy before the final answer.';
};

// Temporary placeholders until the database-backed analytics tables are available.
const DUMMY_PROGRESS_DATA: NotebookProgressPlan[] = [
  {
    subjectId: 'subject-algebra',
    notebook: 'Fractions',
    practiceLabel: 'Do 5 problems daily',
    currentAccuracy: 45,
    targetAccuracy: 80,
    solvedProblems: 18,
    totalProblems: 40,
    weeks: 2,
    resumeAssignmentId: 'assignment-fractions-1',
    resumeProblemIndex: 19,
  },
  {
    subjectId: 'subject-general',
    notebook: 'Word Problems',
    practiceLabel: 'Practice 3 problems daily',
    currentAccuracy: 52,
    targetAccuracy: 75,
    solvedProblems: 21,
    totalProblems: 39,
    weeks: 3,
    resumeAssignmentId: 'assignment-word-problems-1',
    resumeProblemIndex: 22,
  },
  {
    subjectId: 'subject-algebra',
    notebook: 'Negative Numbers',
    practiceLabel: 'Do 4 problems daily',
    currentAccuracy: 60,
    targetAccuracy: 85,
    solvedProblems: 24,
    totalProblems: 40,
    weeks: 2,
    resumeAssignmentId: 'assignment-negative-numbers-1',
    resumeProblemIndex: 25,
  },
];

const DUMMY_PERFORMANCE_SNAPSHOT: PerformanceSnapshot = {
  problemsSolved: 63,
  mistakes: 21,
  totalQuestions: 94,
  timeSpentMinutes: 540,
  quizzesAttempted: 7,
};

// These dummy records mirror the planned backend contracts:
// GET /api/assignments/:id/problems/progress
// GET /api/assignments/:id/errors/summary?groupBy=topic
// GET /api/notebooks/quiz-sessions
const DUMMY_PROBLEM_PROGRESS: Record<string, ProblemProgressRecord[]> = {
  'assignment-fractions-1': Array.from({ length: 40 }, (_, index) => ({
    assignmentId: 'assignment-fractions-1',
    problemIndex: index + 1,
    attempted: index < 24,
    solved: index < 18,
    mistakeCount: index < 18 ? (index % 3 === 0 ? 1 : 0) : 0,
    totalTimeSeconds: index < 24 ? 420 + index * 18 : 0,
  })),
  'assignment-word-problems-1': Array.from({ length: 39 }, (_, index) => ({
    assignmentId: 'assignment-word-problems-1',
    problemIndex: index + 1,
    attempted: index < 27,
    solved: index < 21,
    mistakeCount: index < 21 ? (index % 2 === 0 ? 1 : 0) : 0,
    totalTimeSeconds: index < 27 ? 480 + index * 15 : 0,
  })),
  'assignment-negative-numbers-1': Array.from({ length: 40 }, (_, index) => ({
    assignmentId: 'assignment-negative-numbers-1',
    problemIndex: index + 1,
    attempted: index < 30,
    solved: index < 24,
    mistakeCount: index < 24 ? (index % 4 === 0 ? 1 : 0) : 0,
    totalTimeSeconds: index < 30 ? 390 + index * 14 : 0,
  })),
};

const DUMMY_ERROR_SUMMARY_BY_TOPIC: Record<string, ProblemErrorSummaryRecord[]> = {
  'assignment-fractions-1': [
    { assignmentId: 'assignment-fractions-1', groupBy: 'topic', label: 'Fractions', count: 12 },
    { assignmentId: 'assignment-fractions-1', groupBy: 'topic', label: 'Equivalent Fractions', count: 5 },
  ],
  'assignment-word-problems-1': [
    { assignmentId: 'assignment-word-problems-1', groupBy: 'topic', label: 'Word Problems', count: 9 },
    { assignmentId: 'assignment-word-problems-1', groupBy: 'topic', label: 'Units', count: 4 },
  ],
  'assignment-negative-numbers-1': [
    { assignmentId: 'assignment-negative-numbers-1', groupBy: 'topic', label: 'Negative Numbers', count: 7 },
    { assignmentId: 'assignment-negative-numbers-1', groupBy: 'topic', label: 'Sign Errors', count: 6 },
  ],
};

const DUMMY_NOTEBOOK_QUIZ_SESSIONS: NotebookQuizSessionRecord[] = [
  {
    subjectId: 'subject-algebra',
    subjectName: 'Fractions',
    attempted: true,
    solved: true,
    totalQuestions: 8,
    correctCount: 5,
    mistakeCount: 3,
    totalTimeSeconds: 720,
  },
  {
    subjectId: 'subject-general',
    subjectName: 'Word Problems',
    attempted: true,
    solved: false,
    totalQuestions: 6,
    correctCount: 4,
    mistakeCount: 2,
    totalTimeSeconds: 540,
  },
  {
    subjectId: 'subject-algebra',
    subjectName: 'Negative Numbers',
    attempted: true,
    solved: true,
    totalQuestions: 5,
    correctCount: 4,
    mistakeCount: 1,
    totalTimeSeconds: 420,
  },
];

const buildDummyPlanFromContracts = (plan: NotebookProgressPlan) => {
  const progressRows = DUMMY_PROBLEM_PROGRESS[plan.resumeAssignmentId] || [];
  const topicRows = DUMMY_ERROR_SUMMARY_BY_TOPIC[plan.resumeAssignmentId] || [];
  const quizSession = DUMMY_NOTEBOOK_QUIZ_SESSIONS.find((entry) => entry.subjectId === plan.subjectId);

  const attemptedCount = progressRows.filter((row) => row.attempted).length;
  const solvedCount = progressRows.filter((row) => row.solved).length;
  const mistakeCount = progressRows.reduce((sum, row) => sum + row.mistakeCount, 0);
  const totalTimeSeconds = progressRows.reduce((sum, row) => sum + row.totalTimeSeconds, 0);
  const topTopic = [...topicRows].sort((left, right) => right.count - left.count)[0]?.label || plan.notebook;
  const quizAccuracy =
    quizSession && quizSession.totalQuestions > 0
      ? (quizSession.correctCount / quizSession.totalQuestions) * 100
      : plan.currentAccuracy;
  const currentAccuracy =
    attemptedCount > 0 ? Math.round(((solvedCount - mistakeCount * 0.35) / attemptedCount) * 100) : 0;

  return {
    ...plan,
    totalProblems: progressRows.length || plan.totalProblems,
    solvedProblems: solvedCount || plan.solvedProblems,
    currentAccuracy: Math.max(0, Math.min(100, Math.round((currentAccuracy * 0.75) + (quizAccuracy * 0.25)))),
    practiceLabel: `Focus on ${topTopic}`,
    totalTimeSeconds,
    totalMistakes: mistakeCount,
    quizzesAttempted: quizSession?.attempted ? 1 : 0,
  };
};

const parseMistakesFromAssignment = (assignment: AssignmentRecord, notebook: string): ProblemMistake[] => {
  const problemCount = Number(assignment.problemCount) || 0;
  const mistakes: ProblemMistake[] = [];

  for (let problemIndex = 1; problemIndex <= problemCount; problemIndex += 1) {
    const candidates = [
      pickProblemBucket(assignment.wrongStepsByProblem, problemIndex),
      pickProblemBucket(assignment.feedbackByProblem, problemIndex),
      pickProblemBucket(assignment.aiFeedbackByProblem, problemIndex),
      pickProblemBucket(assignment.insightsByProblem, problemIndex),
      assignment.feedback,
      assignment.insights,
    ];

    candidates
      .flatMap((candidate) => extractEntries(candidate))
      .filter((entry) => WRONG_STEP_MATCHER.test(entry.content) || String(entry.kind).toLowerCase().includes('wrong'))
      .forEach((entry) => {
        const rawText = String(entry.content || '').trim();
        if (!rawText) return;
        mistakes.push({
          notebook,
          assignmentTitle: assignment.title,
          problemIndex,
          rawText,
          normalizedText: normalizeMistakeText(rawText),
        });
      });
  }

  return mistakes;
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
        subjects.map(async (subject) => {
          const assignments = (await listAssignments(subject.id)) as AssignmentRecord[];
          const detailedAssignments = await Promise.all(
            assignments.map((assignment) => getAssignmentById(assignment.id) as Promise<AssignmentRecord>),
          );
          return { subject, assignments: detailedAssignments };
        }),
      );

      const notebookStats = assignmentLists.map(({ subject, assignments }) => {
        const totalQuestions = assignments.reduce(
          (sum, assignment) => sum + (Number(assignment.problemCount) || 0),
          0,
        );

        const mistakes = assignments.flatMap((assignment) => parseMistakesFromAssignment(assignment, subject.name));

        return {
          notebook: subject.name,
          score: totalQuestions > 0 ? Math.min(1, mistakes.length / totalQuestions) : 0,
          totalQuestions,
          mistakes,
        };
      });

      const heatmap = notebookStats
        .map(({ notebook, score }) => ({ notebook, score: Number(score.toFixed(2)) }))
        .sort((left, right) => right.score - left.score);

      const topTopics = notebookStats
        .flatMap(({ notebook, mistakes }) =>
          mistakes.map((mistake) => ({
            notebook,
            topic: summarizeTopic(mistake.rawText),
            rawText: mistake.rawText,
          })),
        )
        .reduce<Record<string, WeakTopic>>((accumulator, mistake) => {
          const key = `${mistake.notebook}::${mistake.topic}`;
          const current = accumulator[key];
          accumulator[key] = current
            ? { ...current, mistakes: current.mistakes + 1 }
            : { notebook: mistake.notebook, topic: mistake.topic, mistakes: 1 };
          return accumulator;
        }, {});

      const topWeakTopics = Object.values(topTopics)
        .sort((left, right) => right.mistakes - left.mistakes)
        .slice(0, 3);

      const notebooks = notebookStats
        .map(({ notebook, mistakes }) => {
          const grouped = mistakes.reduce<Record<string, { title: string; errors: string[] }>>((accumulator, mistake) => {
            const cluster = groupMistake(mistake.rawText);
            if (!accumulator[cluster.key]) {
              accumulator[cluster.key] = { title: cluster.title, errors: [] };
            }

            if (!accumulator[cluster.key].errors.includes(mistake.rawText)) {
              accumulator[cluster.key].errors.push(mistake.rawText);
            }
            return accumulator;
          }, {});

          const groups = Object.entries(grouped)
            .map(([key, group]) => ({
              id: `${notebook}-${key}`,
              title: group.title,
              errors: group.errors.slice(0, 4),
              fix: buildFixExplanation(group.title, group.errors),
            }))
            .filter((group) => group.errors.length > 0);

          return { notebook, groups };
        })
        .filter((entry) => entry.groups.length > 0);

      setHeatmapData(heatmap);
      setWeakTopics(topWeakTopics);
      setInsightGroups(notebooks);
      setStatus(
        heatmap.length > 0
          ? `Mapped weak areas across ${heatmap.length} notebooks.`
          : 'No notebook performance data is available yet.',
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
  const improvementPlans = useMemo(
    () => DUMMY_PROGRESS_DATA.map(buildDummyPlanFromContracts),
    [],
  );

  const overviewMetrics = useMemo(() => {
    const derivedProblemsSolved = improvementPlans.reduce((sum, plan) => sum + plan.solvedProblems, 0);
    const derivedMistakes = improvementPlans.reduce(
      (sum, plan) => sum + ('totalMistakes' in plan ? Number(plan.totalMistakes) : 0),
      0,
    );
    const derivedTotalQuestions = improvementPlans.reduce((sum, plan) => sum + plan.totalProblems, 0);
    const derivedTimeSpentMinutes = Math.round(
      improvementPlans.reduce(
        (sum, plan) => sum + ('totalTimeSeconds' in plan ? Number(plan.totalTimeSeconds) : 0),
        0,
      ) / 60,
    );
    const derivedQuizzesAttempted = improvementPlans.reduce(
      (sum, plan) => sum + ('quizzesAttempted' in plan ? Number(plan.quizzesAttempted) : 0),
      0,
    );
    const {
      problemsSolved = derivedProblemsSolved,
      mistakes = derivedMistakes,
      totalQuestions = derivedTotalQuestions,
      timeSpentMinutes = derivedTimeSpentMinutes,
      quizzesAttempted = derivedQuizzesAttempted,
    } = DUMMY_PERFORMANCE_SNAPSHOT;
    const overallAccuracy =
      totalQuestions > 0 ? Math.round(((totalQuestions - mistakes) / totalQuestions) * 100) : 0;
    const topicsNeedingFocus = improvementPlans.filter(
      (plan) => plan.currentAccuracy < plan.targetAccuracy,
    ).length;
    const improvementThisWeek = Math.round(
      (problemsSolved * 0.35) +
        (quizzesAttempted * 1.5) +
        Math.max(0, 18 - mistakes) +
        Math.min(10, timeSpentMinutes / 90),
    );

    return {
      overallAccuracy,
      topicsNeedingFocus,
      improvementThisWeek,
    };
  }, [improvementPlans]);

  const handleResumePractice = useCallback((plan: NotebookProgressPlan) => {
    window.alert(
      `Temporary redirect placeholder:\nResume ${plan.notebook} at assignment "${plan.resumeAssignmentId}", problem ${plan.resumeProblemIndex}. This will later use problem_progress to route to the exact whiteboard checkpoint.`,
    );
  }, []);

  return (
    <div className="app-content">
      <section className="weak-areas-page">
        <header className="weak-header">
          <div>
            <span className="weak-kicker">Performance Diagnostics</span>
            <h1>Weak Areas Detection</h1>
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

        <section className="weak-panel improvement-plan-panel">
          <div className="weak-panel-heading">
            <div>
              <h2>
                <Target size={18} />
                Personalized Improvement Plan
              </h2>
              <p>Notebook-level practice recommendations based on solved progress and accuracy trends</p>
            </div>
          </div>

          <div className="improvement-plan-list">
            {improvementPlans.map((plan) => {
              const progressRatio = plan.totalProblems > 0 ? (plan.solvedProblems / plan.totalProblems) * 100 : 0;

              return (
                <article key={plan.notebook} className="improvement-plan-card">
                  <div className="improvement-plan-top">
                    <div>
                      <h3>{plan.notebook}</h3>
                      <p>{plan.practiceLabel}</p>
                    </div>
                    <span className="improvement-plan-chip">{plan.weeks} weeks</span>
                  </div>

                  <div className="improvement-plan-progress-copy">
                    <span>
                      Solved {plan.solvedProblems} of {plan.totalProblems} problems
                    </span>
                    <span>Current: {plan.currentAccuracy}%</span>
                  </div>

                  <div className="improvement-plan-track">
                    <div
                      className="improvement-plan-fill"
                      style={{ width: `${Math.min(100, progressRatio)}%` }}
                    />
                    <div
                      className="improvement-plan-target"
                      style={{ left: `${plan.targetAccuracy}%` }}
                    />
                  </div>

                  <div className="improvement-plan-scale">
                    <span>Weak</span>
                    <span>Target: {plan.targetAccuracy}%</span>
                    <span>Strong</span>
                  </div>

                  <button
                    type="button"
                    className="improvement-plan-button"
                    onClick={() => handleResumePractice(plan)}
                  >
                    <CheckCircle2 size={16} />
                    Start Practice Plan
                  </button>
                </article>
              );
            })}
          </div>
        </section>

        <section className="weak-metric-grid">
          <article className="weak-metric-card">
            <strong>{overviewMetrics.overallAccuracy}%</strong>
            <span>Overall Accuracy</span>
            <label>Needs Improvement</label>
          </article>

          <article className="weak-metric-card">
            <strong>{overviewMetrics.topicsNeedingFocus}</strong>
            <span>Topics Needing Focus</span>
            <label>Action Required</label>
          </article>

          <article className="weak-metric-card weak-metric-card-positive">
            <strong>+{overviewMetrics.improvementThisWeek}%</strong>
            <span>Overall Improvement</span>
            <label>Good Progress</label>
          </article>
        </section>
      </section>
    </div>
  );
}
