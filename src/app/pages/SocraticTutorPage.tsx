import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { SendHorizontal } from 'lucide-react';
import { ContextBar, TutorContextState } from '../components/ContextBar';
import { DiagramRenderer } from '../components/DiagramRenderer';
import { InputModesPanel } from '../components/InputModesPanel';
import { ResponseOptionsPanel } from '../components/ResponseOptionsPanel';
import { SocraticChat } from '../components/SocraticChat';
import { StepAnimator } from '../components/StepAnimator';
import { getErrorSummary, getProblemErrors, listSubjects } from '../services/storage';

interface SubjectRecord {
  id: string;
  name: string;
}

interface ErrorSummaryRecord {
  label?: string;
  topic?: string;
  count?: number;
  mistakes?: number;
}

interface ProblemErrorAttemptRecord {
  summary?: string;
  errorType?: string;
  items?: Array<Record<string, unknown>>;
  mistakes?: Array<Record<string, unknown>>;
}

interface ChatMessage {
  id: string;
  role: 'assistant' | 'user';
  text: string;
  time: string;
}

const extractTopicFromText = (text: string, notebookOptions: string[]) => {
  const lowered = text.toLowerCase();
  const notebookMatch = notebookOptions.find((entry) => lowered.includes(entry.toLowerCase()));
  if (notebookMatch) return notebookMatch;
  if (lowered.includes('quadratic')) return 'Quadratic Equations';
  if (lowered.includes('fraction')) return 'Fractions';
  if (lowered.includes('negative')) return 'Negative Numbers';
  if (lowered.includes('geometry')) return 'Geometry';
  return '';
};

const buildSocraticReply = (
  userText: string,
  context: TutorContextState,
  weakTopic: string,
  recentErrorType: string,
) => {
  const topic = context.topic || weakTopic || 'this topic';
  const concept = context.concept || 'the current step';
  const errorType = context.errorType || recentErrorType;
  const lowered = userText.toLowerCase();

  if (errorType) {
    return `Looks like ${errorType.toLowerCase()} might be involved. Before solving, what changes when you check ${concept.toLowerCase()} inside ${topic.toLowerCase()}?`;
  }

  if (lowered.includes('stuck') || lowered.includes("don't know")) {
    return `Let’s shrink the problem. What definition or rule do you know first for ${topic.toLowerCase()}?`;
  }

  if (lowered.includes('i think') || lowered.includes('maybe')) {
    return `Nice start. What clue in the problem tells you that idea fits ${topic.toLowerCase()} here?`;
  }

  return `For ${topic.toLowerCase()}, what does ${concept.toLowerCase()} represent in this step, and which rule should act on it first?`;
};

export function SocraticTutorPage({
  initialContext,
}: {
  initialContext?: Partial<TutorContextState>;
}) {
  const [subjects, setSubjects] = useState<SubjectRecord[]>([]);
  const [topErrors, setTopErrors] = useState<ErrorSummaryRecord[]>([]);
  const [problemErrors, setProblemErrors] = useState<ProblemErrorAttemptRecord[]>([]);
  const [context, setContext] = useState<TutorContextState>({
    topic: initialContext?.topic || '',
    concept: initialContext?.concept || '',
    errorType: initialContext?.errorType || '',
    source: initialContext?.source || 'manual',
    assignmentId: initialContext?.assignmentId,
    problemIndex: initialContext?.problemIndex,
  });
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'assistant-initial',
      role: 'assistant',
      text: "Want to understand this better? Let’s work through it step by step.",
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    },
  ]);
  const [draft, setDraft] = useState('');
  const [activeMode, setActiveMode] = useState<'text' | 'voice' | 'image' | 'equation'>('text');
  const [activeOption, setActiveOption] = useState<'voice' | 'diagram' | 'steps'>('diagram');

  useEffect(() => {
    listSubjects().then((rows) => setSubjects(rows as SubjectRecord[])).catch(() => {});
    getErrorSummary('topic').then((rows) => setTopErrors(rows as ErrorSummaryRecord[])).catch(() => {});
  }, []);

  useEffect(() => {
    if (!context.assignmentId || !context.problemIndex) return;
    getProblemErrors(context.assignmentId, context.problemIndex)
      .then((rows) => setProblemErrors(rows as ProblemErrorAttemptRecord[]))
      .catch(() => setProblemErrors([]));
  }, [context.assignmentId, context.problemIndex]);

  const notebookOptions = useMemo(() => subjects.map((subject) => subject.name), [subjects]);
  const weakTopic = useMemo(
    () =>
      [...topErrors]
        .sort((a, b) => Number(b.count || b.mistakes || 0) - Number(a.count || a.mistakes || 0))[0]
        ?.topic ||
      [...topErrors]
        .sort((a, b) => Number(b.count || b.mistakes || 0) - Number(a.count || a.mistakes || 0))[0]
        ?.label ||
      '',
    [topErrors],
  );
  const recentErrorType = useMemo(
    () => problemErrors[0]?.errorType || (problemErrors[0]?.items?.[0]?.type as string) || '',
    [problemErrors],
  );

  useEffect(() => {
    if (!context.topic && weakTopic) {
      setContext((current) => ({ ...current, topic: weakTopic, source: 'weak-areas' }));
    }
  }, [context.topic, weakTopic]);

  const handleSend = useCallback(() => {
    const trimmed = draft.trim();
    if (!trimmed) return;

    const autoTopic = context.topic || extractTopicFromText(trimmed, notebookOptions);
    const nextContext = {
      ...context,
      topic: autoTopic || context.topic,
      source: context.topic ? context.source : autoTopic ? 'auto' as const : context.source,
    };
    setContext(nextContext);

    setMessages((current) => [
      ...current,
      {
        id: `user-${Date.now()}`,
        role: 'user',
        text: trimmed,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      },
      {
        id: `assistant-${Date.now() + 1}`,
        role: 'assistant',
        text: buildSocraticReply(trimmed, nextContext, weakTopic, recentErrorType),
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      },
    ]);
    setDraft('');
  }, [context, draft, notebookOptions, recentErrorType, weakTopic]);

  const tutorSteps = useMemo(
    () => [
      `Identify the topic: ${context.topic || weakTopic || 'Choose a topic'}`,
      `Name the concept: ${context.concept || 'Break the problem into one smaller concept'}`,
      `Watch for the pattern: ${context.errorType || recentErrorType || 'No recent error pattern yet'}`,
      'Apply one rule to one small part before solving the whole problem.',
    ],
    [context.concept, context.errorType, context.topic, recentErrorType, weakTopic],
  );

  return (
    <div className="app-content">
      <section className="socratic-page">
        <header className="progress-header">
          <div>
            <h1>Socratic Tutor</h1>
            <p>Learn by thinking, guided step by step</p>
          </div>
        </header>

        <ContextBar
          context={context}
          notebookOptions={notebookOptions}
          onChange={(updates) => setContext((current) => ({ ...current, ...updates }))}
        />

        <div className="socratic-layout">
          <div className="socratic-main">
            <SocraticChat messages={messages} />

            <section className="socratic-compose">
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Ask about a step, paste a problem, or describe where you got stuck..."
                rows={4}
              />
              <button type="button" className="improvement-plan-button" onClick={handleSend}>
                <SendHorizontal size={16} />
                Send
              </button>
            </section>
          </div>

          <aside className="socratic-side">
            <InputModesPanel activeMode={activeMode} onSelect={setActiveMode} />
            <ResponseOptionsPanel activeOption={activeOption} onSelect={setActiveOption} />

            {activeOption === 'diagram' && (
              <DiagramRenderer topic={context.topic || weakTopic} concept={context.concept} />
            )}
            {activeOption === 'steps' && <StepAnimator steps={tutorSteps} />}
            {activeOption === 'voice' && (
              <section className="socratic-visual-card">
                <h3>Voice Explanation</h3>
                <p className="subtle">
                  Keep the explanation short, ask one question at a time, and wait for the learner to respond.
                </p>
              </section>
            )}

            <section className="socratic-visual-card">
              <h3>Personalization Signals</h3>
              <div className="socratic-signal-list">
                <div>
                  <strong>Weak Areas</strong>
                  <span>{weakTopic || 'No weak topic detected yet'}</span>
                </div>
                <div>
                  <strong>Problem Error Pattern</strong>
                  <span>{recentErrorType || 'No problem-level error loaded'}</span>
                </div>
                <div>
                  <strong>Current Source</strong>
                  <span>{context.source}</span>
                </div>
              </div>
            </section>
          </aside>
        </div>
      </section>
    </div>
  );
}
