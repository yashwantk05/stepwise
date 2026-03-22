import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Lightbulb, TrendingDown } from 'lucide-react';
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

const buildInsightPrompt = (notebook: string, errors: string[]) => {
  return [
    'INPUT:',
    `Notebook: ${notebook}`,
    `Mistakes: ${errors.join(' | ')}`,
    'OUTPUT:',
    'Cluster similar errors, generate an insight title, list the repeated errors, and return a 1-2 line fix explanation.',
  ].join('\n');
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
  const [insightPromptPreview, setInsightPromptPreview] = useState('');

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
      setInsightPromptPreview(
        notebooks[0] ? buildInsightPrompt(notebooks[0].notebook, notebooks[0].groups.flatMap((group) => group.errors)) : '',
      );
      setStatus(
        heatmap.length > 0
          ? `Mapped weak areas across ${heatmap.length} notebooks.`
          : 'No notebook performance data is available yet.',
      );
    } catch {
      setHeatmapData([]);
      setWeakTopics([]);
      setInsightGroups([]);
      setInsightPromptPreview('');
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

        <section className="weak-panel prompt-panel">
          <div className="weak-panel-heading">
            <div>
              <h2>Backend Prompt Template</h2>
              <p>Prepared logic for future AI clustering and explanation generation</p>
            </div>
          </div>
          <pre className="prompt-preview">
            {insightPromptPreview || 'No insight prompt preview yet. Start solving problems to generate it.'}
          </pre>
        </section>
      </section>
    </div>
  );
}
