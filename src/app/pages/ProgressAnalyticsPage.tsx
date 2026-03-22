import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Award,
  BarChart3,
  Clock3,
  Crosshair,
  ShieldCheck,
  TrendingUp,
} from 'lucide-react';
import { AccuracyChart, AccuracyPoint } from '../components/AccuracyChart';
import { ConfidencePoint, ConfidenceRadar } from '../components/ConfidenceRadar';
import { ImprovementChart, ImprovementPoint } from '../components/ImprovementChart';
import { MetricCard } from '../components/MetricCard';
import { ProgressTabOption, Tabs } from '../components/Tabs';
import { TimeChart, TimePoint } from '../components/TimeChart';
import { WeeklySummary } from '../components/WeeklySummary';
import {
  getAssignmentProblemProgress,
  getErrorSummary,
  getNotebookQuizSessions,
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
  attempted?: boolean;
  solved?: boolean;
  mistakeCount?: number;
  totalTimeSeconds?: number;
  addTimeSeconds?: number;
  createdAt?: number | string;
  updatedAt?: number | string;
  lastWorkedAt?: number | string;
  completedAt?: number | string;
  [key: string]: unknown;
}

interface NotebookQuizSessionRecord {
  subjectId: string;
  subjectName?: string;
  attempted?: boolean;
  solved?: boolean;
  totalQuestions?: number;
  correctCount?: number;
  mistakeCount?: number;
  addTimeSeconds?: number;
  totalTimeSeconds?: number;
  updatedAt?: number | string;
}

interface ErrorSummaryRecord {
  label?: string;
  topic?: string;
  count?: number;
  mistakes?: number;
  total?: number;
}

type ProgressTab = ProgressTabOption['id'];

const TABS: ProgressTabOption[] = [
  { id: 'accuracy', label: 'Accuracy Trend' },
  { id: 'time', label: 'Time Spent' },
  { id: 'improvement', label: 'Improvement' },
  { id: 'confidence', label: 'Confidence' },
];

const toTimestamp = (value: unknown) => {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
};

const formatAxisDay = (timestamp: number) =>
  new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

export function ProgressAnalyticsPage() {
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<ProgressTab>('accuracy');
  const [status, setStatus] = useState('Loading progress analytics...');
  const [subjects, setSubjects] = useState<SubjectRecord[]>([]);
  const [subjectAssignments, setSubjectAssignments] = useState<Record<string, AssignmentRecord[]>>({});
  const [progressByAssignment, setProgressByAssignment] = useState<Record<string, ProblemProgressRecord[]>>({});
  const [quizSessions, setQuizSessions] = useState<NotebookQuizSessionRecord[]>([]);
  const [topicSummary, setTopicSummary] = useState<ErrorSummaryRecord[]>([]);

  const loadAnalytics = useCallback(async () => {
    setLoading(true);
    setStatus('Loading progress analytics...');

    try {
      const subjectRows = (await listSubjects()) as SubjectRecord[];
      const assignmentRows = await Promise.all(
        subjectRows.map(async (subject) => ({
          subjectId: subject.id,
          assignments: (await listAssignments(subject.id)) as AssignmentRecord[],
        })),
      );

      const progressEntries = await Promise.all(
        assignmentRows.flatMap(({ assignments }) =>
          assignments.map(async (assignment) => ({
            assignmentId: assignment.id,
            rows: (await getAssignmentProblemProgress(assignment.id)) as ProblemProgressRecord[],
          })),
        ),
      );

      const [quizRows, topicRows] = await Promise.all([
        getNotebookQuizSessions() as Promise<NotebookQuizSessionRecord[]>,
        getErrorSummary('topic') as Promise<ErrorSummaryRecord[]>,
      ]);

      setSubjects(subjectRows);
      setSubjectAssignments(
        assignmentRows.reduce<Record<string, AssignmentRecord[]>>((accumulator, entry) => {
          accumulator[entry.subjectId] = entry.assignments;
          return accumulator;
        }, {}),
      );
      setProgressByAssignment(
        progressEntries.reduce<Record<string, ProblemProgressRecord[]>>((accumulator, entry) => {
          accumulator[entry.assignmentId] = entry.rows;
          return accumulator;
        }, {}),
      );
      setQuizSessions(quizRows);
      setTopicSummary(topicRows);
      setStatus('Progress analytics ready.');
    } catch {
      setStatus('Unable to load progress analytics right now.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAnalytics();
  }, [loadAnalytics]);

  const flattenedProgress = useMemo(
    () =>
      Object.entries(progressByAssignment).flatMap(([assignmentId, rows]) =>
        rows.map((row) => ({ assignmentId, ...row })),
      ),
    [progressByAssignment],
  );

  const totalQuestions = useMemo(
    () => quizSessions.reduce((sum, session) => sum + Number(session.totalQuestions || 0), 0),
    [quizSessions],
  );
  const totalCorrect = useMemo(
    () => quizSessions.reduce((sum, session) => sum + Number(session.correctCount || 0), 0),
    [quizSessions],
  );
  const totalHoursThisMonth = useMemo(
    () =>
      quizSessions.reduce(
        (sum, session) => sum + Number(session.addTimeSeconds || session.totalTimeSeconds || 0),
        0,
      ) / 3600,
    [quizSessions],
  );
  const topicsMastered = useMemo(
    () =>
      quizSessions.filter((session) => {
        const total = Number(session.totalQuestions || 0);
        const correct = Number(session.correctCount || 0);
        return total > 0 && (correct / total) * 100 > 70;
      }).length,
    [quizSessions],
  );
  const totalXpEarned = useMemo(() => totalCorrect * 10, [totalCorrect]);

  const accuracyCardValue = totalQuestions > 0 ? Math.round((totalCorrect / totalQuestions) * 100) : 0;
  const weeklyTimeHours = useMemo(
    () => totalHoursThisMonth / Math.max(1, new Date().getDate()),
    [totalHoursThisMonth],
  );

  const accuracyTrendData = useMemo<AccuracyPoint[]>(() => {
    const grouped = flattenedProgress.reduce<Record<string, { attempted: number; solved: number }>>(
      (accumulator, row) => {
        const timestamp =
          toTimestamp(row.updatedAt) ??
          toTimestamp(row.lastWorkedAt) ??
          toTimestamp(row.completedAt) ??
          toTimestamp(row.createdAt) ??
          Date.now();
        const key = formatAxisDay(timestamp);
        if (!accumulator[key]) {
          accumulator[key] = { attempted: 0, solved: 0 };
        }
        if (row.attempted) accumulator[key].attempted += 1;
        if (row.solved) accumulator[key].solved += 1;
        return accumulator;
      },
      {},
    );

    return Object.entries(grouped).map(([label, value]) => ({
      label,
      accuracy: value.attempted > 0 ? Math.round((value.solved / value.attempted) * 100) : 0,
    }));
  }, [flattenedProgress]);

  const weeklySummary = useMemo(() => {
    const recent = flattenedProgress.filter((row) => {
      const timestamp =
        toTimestamp(row.updatedAt) ??
        toTimestamp(row.lastWorkedAt) ??
        toTimestamp(row.completedAt) ??
        toTimestamp(row.createdAt) ??
        Date.now();
      return timestamp >= Date.now() - (7 * 24 * 60 * 60 * 1000);
    });

    const solved = recent.filter((row) => row.solved).length;
    const attemptedDays = new Set(
      recent.map((row) =>
        new Date(
          toTimestamp(row.updatedAt) ??
            toTimestamp(row.lastWorkedAt) ??
            toTimestamp(row.completedAt) ??
            toTimestamp(row.createdAt) ??
            Date.now(),
        ).toDateString(),
      ),
    );

    return {
      problemsSolved: solved,
      studySessions: attemptedDays.size,
      streakDays: attemptedDays.size,
      solvedDelta: Math.max(0, solved - Math.max(0, solved - 12)),
      averageSessionsPerDay: (attemptedDays.size / 7).toFixed(1),
    };
  }, [flattenedProgress]);

  const timeSpentData = useMemo<TimePoint[]>(
    () =>
      quizSessions.map((session) => ({
        subject: session.subjectName || 'Untitled',
        hours: Number(session.addTimeSeconds || session.totalTimeSeconds || 0) / 3600,
      })),
    [quizSessions],
  );

  const improvementData = useMemo<ImprovementPoint[]>(() => {
    return subjects.map((subject) => {
      const assignments = subjectAssignments[subject.id] || [];
      const rows = assignments.flatMap((assignment) => progressByAssignment[assignment.id] || []);
      const midpoint = Math.max(1, Math.ceil(rows.length / 2));
      const firstHalf = rows.slice(0, midpoint);
      const secondHalf = rows.slice(midpoint);
      const toAccuracy = (items: ProblemProgressRecord[]) => {
        const attempted = items.filter((row) => row.attempted).length;
        const solved = items.filter((row) => row.solved).length;
        return attempted > 0 ? Math.round((solved / attempted) * 100) : 0;
      };

      return {
        subject: subject.name,
        before: toAccuracy(firstHalf),
        after: toAccuracy(secondHalf.length > 0 ? secondHalf : firstHalf),
      };
    });
  }, [progressByAssignment, subjectAssignments, subjects]);

  const confidenceData = useMemo<ConfidencePoint[]>(() => {
    return subjects.map((subject) => {
      const assignments = subjectAssignments[subject.id] || [];
      const rows = assignments.flatMap((assignment) => progressByAssignment[assignment.id] || []);
      const attempted = rows.filter((row) => row.attempted).length;
      const solved = rows.filter((row) => row.solved).length;
      const mistakes = rows.reduce((sum, row) => sum + Number(row.mistakeCount || 0), 0);
      const accuracy = attempted > 0 ? (solved / attempted) * 100 : 0;
      const mistakeDensity = attempted > 0 ? (mistakes / attempted) * 100 : 0;

      return {
        subject: subject.name,
        confidence: Math.max(0, Math.min(100, Math.round(accuracy - (mistakeDensity * 0.6)))),
      };
    });
  }, [progressByAssignment, subjectAssignments, subjects]);

  const topicsNeedingFocus = useMemo(
    () => topicSummary.filter((row) => Number(row.count || row.mistakes || row.total || 0) > 0).length,
    [topicSummary],
  );

  return (
    <div className="app-content">
      <section className="progress-analytics-page">
        <header className="progress-header">
          <div>
            <h1>Progress Analytics</h1>
            <p>Track your learning journey and improvements</p>
          </div>
        </header>

        <section className="progress-metric-grid">
          <MetricCard
            icon={<TrendingUp size={30} />}
            value={`${accuracyCardValue}%`}
            label="Current Accuracy"
            badge={`+${Math.max(0, Math.round(weeklySummary.solvedDelta / Math.max(1, totalQuestions) * 100))}% this week`}
            variant="blue"
          />
          <MetricCard
            icon={<Clock3 size={30} />}
            value={`${Math.round(totalHoursThisMonth)}`}
            label="Hours This Month"
            badge={`${weeklyTimeHours.toFixed(1)} hrs/day avg`}
            variant="purple"
          />
          <MetricCard
            icon={<Crosshair size={30} />}
            value={`${topicsMastered}/${Math.max(1, quizSessions.length)}`}
            label="Topics Mastered"
            badge={`${totalQuestions > 0 ? ((topicsMastered / Math.max(1, quizSessions.length)) * 100).toFixed(1) : '0'}% complete`}
            variant="green"
          />
          <MetricCard
            icon={<Award size={30} />}
            value={totalXpEarned.toLocaleString()}
            label="Total XP Earned"
            badge={`Level ${Math.max(1, Math.floor(totalXpEarned / 300) + 1)}`}
            variant="orange"
          />
        </section>

        <Tabs tabs={TABS} activeTab={activeTab} onChange={setActiveTab} />

        <section className="progress-chart-panel">
          {loading ? (
            <div className="weak-loading">Loading charts from backend analytics...</div>
          ) : (
            <>
              {activeTab === 'accuracy' && (
                <>
                  <div className="progress-panel-heading">
                    <div>
                      <h2>
                        <TrendingUp size={18} />
                        Accuracy Over Time
                      </h2>
                      <p>Your performance is improving steadily</p>
                    </div>
                  </div>
                  <AccuracyChart data={accuracyTrendData} />
                </>
              )}

              {activeTab === 'time' && (
                <>
                  <div className="progress-panel-heading">
                    <div>
                      <h2>
                        <Clock3 size={18} />
                        Time Spent by Subject
                      </h2>
                      <p>Total study time breakdown</p>
                    </div>
                  </div>
                  <TimeChart data={timeSpentData} />
                </>
              )}

              {activeTab === 'improvement' && (
                <>
                  <div className="progress-panel-heading">
                    <div>
                      <h2>
                        <BarChart3 size={18} />
                        Before vs After Improvement
                      </h2>
                      <p>Compare your progress across topics</p>
                    </div>
                  </div>
                  <ImprovementChart data={improvementData} />
                </>
              )}

              {activeTab === 'confidence' && (
                <>
                  <div className="progress-panel-heading">
                    <div>
                      <h2>
                        <ShieldCheck size={18} />
                        Confidence Score by Subject
                      </h2>
                      <p>How confident you feel in each area</p>
                    </div>
                  </div>
                  <ConfidenceRadar data={confidenceData} />
                </>
              )}
            </>
          )}
        </section>

        <WeeklySummary
          problemsSolved={weeklySummary.problemsSolved}
          studySessions={weeklySummary.studySessions}
          streakDays={weeklySummary.streakDays}
          solvedDelta={weeklySummary.solvedDelta}
          averageSessionsPerDay={weeklySummary.averageSessionsPerDay}
        />

        <div className="progress-inline-note">
          {status} Topics needing focus right now: {topicsNeedingFocus}.
        </div>
      </section>
    </div>
  );
}
