import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRight, BellRing, CheckCircle2, Flame, Sparkles, TrendingUp } from 'lucide-react';
import { listAssignments, listNotes, listSubjects, getLearningStreakSummary } from '../services/storage';
import { generateDashboardInsights, type NotebookInsightInput } from '../services/dashboard';
import type { StudyToolType } from '../services/studyTools';

interface DashboardPageProps {
  user: any;
  onOpenWhiteboard: () => void;
  onOpenNotes: () => void;
  onOpenStudyTool: (tool: StudyToolType, subjectId?: string) => void;
  onDashboardMetaChange: (meta: { recommendationCount: number; streak: number }) => void;
}

interface NotebookRecord {
  id: string;
  name: string;
}

interface InsightState {
  learningPlan: Array<{ label: string; detail: string; value: string }>;
  recommendations: Array<{ title: string; reason: string; action: string }>;
  mastery: Array<{ topic: string; score: number; status: string; focus: string }>;
  summary: string;
}

const buildFallbackInsights = (notebooks: NotebookInsightInput[]): InsightState => ({
  learningPlan: [
    {
      label: 'Topics to revise',
      detail:
        notebooks.length > 0
          ? `Focus on ${notebooks.slice(0, 3).map((item) => item.notebook).join(', ')}`
          : 'Create your first notebook to unlock an AI learning plan.',
      value: notebooks.length > 0 ? `${Math.min(3, notebooks.length)} topics` : 'Set up',
    },
    {
      label: 'Practice problems',
      detail:
        notebooks.length > 0
          ? 'Work through a short practice set from your active notebooks.'
          : 'Add notes and assignments to start getting practice suggestions.',
      value: notebooks.length > 0 ? `${Math.max(3, notebooks.length * 2)} problems` : '0 problems',
    },
    {
      label: 'AI revision suggested',
      detail:
        notebooks.length > 0
          ? 'Use Flashcards or Revision Sheet to reinforce weak topics.'
          : 'Your AI revision suggestions will appear here once you have data.',
      value: notebooks.length > 0 ? '15 min' : 'Coming soon',
    },
  ],
  recommendations: notebooks.length > 0
    ? notebooks.slice(0, 3).map((item) => ({
        title: `Review ${item.notebook}`,
        reason: item.progressScore >= 70 ? 'You are doing well. Keep the momentum going.' : 'This notebook needs a little more attention.',
        action: 'Open notes',
      }))
    : [
        { title: 'Create your first notebook', reason: 'Add a notebook to start getting recommendations.', action: 'Open whiteboard' },
        { title: 'Add study notes', reason: 'Notes help AI build plans, mastery, and study tools.', action: 'Open notes' },
        { title: 'Start a quiz', reason: 'Quizzes will appear here as soon as notebooks have content.', action: 'Open quizzes' },
      ],
  mastery: notebooks.length > 0
    ? notebooks.map((item) => ({
        topic: item.notebook,
        score: item.progressScore,
        status: progressTone(item.progressScore),
        focus: item.progressScore >= 70 ? 'Strong progress. Keep revising.' : 'Needs more revision and practice.',
      }))
    : [
        { topic: 'Algebra', score: 0, status: 'weak', focus: 'No data yet. Add notebooks and notes to begin tracking mastery.' },
        { topic: 'Geometry', score: 0, status: 'weak', focus: 'No data yet. Add notebooks and notes to begin tracking mastery.' },
      ],
  summary: notebooks.length > 0
    ? 'Fallback dashboard insights are shown while AI recommendations are unavailable.'
    : 'Add notebooks, notes, and assignments to unlock personalized dashboard insights.',
});

const progressTone = (score: number) => {
  if (score >= 80) return 'strong';
  if (score >= 50) return 'medium';
  return 'weak';
};

export function DashboardPage({
  user,
  onOpenWhiteboard,
  onOpenNotes,
  onOpenStudyTool,
  onDashboardMetaChange,
}: DashboardPageProps) {
  const [notebooks, setNotebooks] = useState<NotebookRecord[]>([]);
  const [insights, setInsights] = useState<InsightState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [streak, setStreak] = useState(0);

  useEffect(() => {
    const summary = getLearningStreakSummary();
    setStreak(summary.streak);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadDashboard = async () => {
      setLoading(true);
      setError('');

      try {
        const notebookData = (await listSubjects()) as NotebookRecord[];
        if (cancelled) return;
        setNotebooks(notebookData);

        const progressData = await Promise.all(
          notebookData.map(async (notebook) => {
            const [notes, assignments] = await Promise.all([
              listNotes(notebook.id),
              listAssignments(notebook.id),
            ]);

            const typedNotes = notes as Array<{ updatedAt?: number; title?: string; content?: string }>;
            const typedAssignments = assignments as Array<{ problemCount?: number; updatedAt?: number }>;
            const totalProblems = typedAssignments.reduce((sum, assignment) => sum + Number(assignment.problemCount || 0), 0);
            const latestActivity = Math.max(
              0,
              ...typedNotes.map((note) => Number(note.updatedAt || 0)),
              ...typedAssignments.map((assignment) => Number(assignment.updatedAt || 0)),
            );
            const progressScore = Math.min(
              100,
              typedNotes.length * 18 + typedAssignments.length * 12 + totalProblems * 4,
            );

            return {
              notebook: notebook.name,
              noteCount: typedNotes.length,
              assignmentCount: typedAssignments.length,
              totalProblems,
              recentActivity: latestActivity ? new Date(latestActivity).toLocaleDateString() : 'No recent activity',
              progressScore,
            } satisfies NotebookInsightInput;
          }),
        );

        if (cancelled) return;

        if (progressData.length === 0) {
          setInsights(buildFallbackInsights([]));
          onDashboardMetaChange({ recommendationCount: 0, streak: getLearningStreakSummary().streak });
          return;
        }

        const insightData = (await generateDashboardInsights(user?.name || 'Student', progressData)) as InsightState;
        if (cancelled) return;

        setInsights(insightData);
        const updatedStreak = getLearningStreakSummary().streak;
        setStreak(updatedStreak);
        onDashboardMetaChange({
          recommendationCount: insightData.recommendations?.length || 0,
          streak: updatedStreak,
        });
      } catch (loadError) {
        if (cancelled) return;
        const notebookData = (await listSubjects().catch(() => [])) as NotebookRecord[];
        const fallbackProgress = notebookData.map((notebook) => ({
          notebook: notebook.name,
          noteCount: 0,
          assignmentCount: 0,
          totalProblems: 0,
          recentActivity: 'No recent activity',
          progressScore: 0,
        })) satisfies NotebookInsightInput[];
        const fallbackInsights = buildFallbackInsights(fallbackProgress);
        setInsights(fallbackInsights);
        setError(loadError instanceof Error ? loadError.message : 'AI insights are temporarily unavailable.');
        onDashboardMetaChange({
          recommendationCount: fallbackInsights.recommendations.length,
          streak: getLearningStreakSummary().streak,
        });
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadDashboard();
    return () => {
      cancelled = true;
    };
  }, [onDashboardMetaChange, user?.name]);

  const firstNotebookId = notebooks[0]?.id;
  const mastery = useMemo(() => insights?.mastery || [], [insights]);

  return (
    <div className="app-content">
      <section className="dashboard-shell">
        <div className="dashboard-hero">
          <h1>Welcome back, {user?.name?.split(' ')[0] || 'Student'}!</h1>
          <p>Let&apos;s continue your math journey today</p>
        </div>

        {loading ? <div className="dashboard-empty">Building your AI dashboard...</div> : null}

        {!loading && (
          <>
            <div className="dashboard-top-grid">
              <div className="dashboard-card learning-plan-card">
                <div className="dashboard-card-title">
                  <CheckCircle2 size={18} />
                  <span>Today&apos;s Learning Plan</span>
                </div>
                <div className="dashboard-plan-list">
                  {(insights?.learningPlan || []).map((item) => (
                    <div key={item.label} className="dashboard-plan-item">
                      <div>
                        <strong>{item.label}</strong>
                        <p>{item.detail}</p>
                      </div>
                      <span>{item.value}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="dashboard-card streak-card">
                <div className="dashboard-card-title">
                  <Flame size={18} />
                  <span>Learning Streak</span>
                </div>
                <div className="dashboard-streak-body">
                  <strong>{streak}</strong>
                  <span>Day Streak</span>
                  <p>Keep it up! Study today to maintain your streak.</p>
                </div>
              </div>
            </div>

            <div className="dashboard-card mastery-card">
              <div className="dashboard-card-title">
                <TrendingUp size={18} />
                <span>Topic Mastery Overview</span>
              </div>

              <div className="mastery-bar-chart">
                {mastery.map((item) => (
                  <div key={item.topic} className="mastery-bar-column">
                    <div className="mastery-bar-track">
                      <div
                        className={`mastery-bar mastery-${progressTone(item.score)}`}
                        style={{ height: `${Math.max(12, item.score)}%` }}
                      />
                    </div>
                    <span>{item.topic}</span>
                  </div>
                ))}
              </div>

              <div className="mastery-progress-grid">
                {mastery.map((item) => (
                  <div key={`${item.topic}-progress`} className="mastery-progress-item">
                    <div className="mastery-progress-head">
                      <strong>{item.topic}</strong>
                      <span>{item.score}%</span>
                    </div>
                    <div className="mastery-progress-bar">
                      <div className={`mastery-progress-fill mastery-${progressTone(item.score)}`} style={{ width: `${item.score}%` }} />
                    </div>
                    <p>{item.focus}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="dashboard-bottom-grid">
              <div className="dashboard-card">
                <div className="dashboard-card-title">
                  <BellRing size={18} />
                  <span>AI Recommendations</span>
                </div>
                <div className="dashboard-recommendations">
                  {(insights?.recommendations || []).map((item) => (
                    <button key={item.title} type="button" className="recommendation-item" onClick={onOpenNotes}>
                      <div>
                        <strong>{item.title}</strong>
                        <p>{item.reason}</p>
                      </div>
                      <ArrowRight size={16} />
                    </button>
                  ))}
                </div>
              </div>

              <div className="dashboard-card quick-actions-card">
                <div className="dashboard-card-title">
                  <Sparkles size={18} />
                  <span>Quick Actions</span>
                </div>
                <div className="quick-actions-list">
                  <button type="button" className="quick-action primary" onClick={onOpenWhiteboard}>
                    Resume last problem
                  </button>
                  <button type="button" className="quick-action" onClick={() => onOpenStudyTool('quiz', firstNotebookId)}>
                    Start revision
                  </button>
                  <button type="button" className="quick-action" onClick={onOpenWhiteboard}>
                    Open whiteboard
                  </button>
                  <button type="button" className="quick-action" onClick={onOpenNotes}>
                    Ask AI tutor
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
