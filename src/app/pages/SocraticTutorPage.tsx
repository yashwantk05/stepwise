// REMOVE lines 1–8, REPLACE WITH:
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SendHorizontal, Mic, Image, Calculator, ChevronUp } from 'lucide-react';
import { TutorContextState } from '../components/ContextBar';
import { SocraticChat } from '../components/SocraticChat';
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
  const [activeMode, setActiveMode] = useState<'voice' | 'image' | 'equation' | null>(null);
  const [activeOption, setActiveOption] = useState<'voice' | 'diagram' | 'steps'>('diagram');
  const [panelOpen, setPanelOpen] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

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
  
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const toggleMode = (mode: 'voice' | 'image' | 'equation') => {
    setActiveMode((current) => (current === mode ? null : mode));
  };

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



  return (
    <div className="socratic-page-v2">

      {/* Top bar */}
      <header className="socratic-topbar">
        <div className="socratic-topbar-title">
          <h1>Socratic Tutor</h1>
          <p>Learn by thinking, guided step by step</p>
        </div>
        <button
          type="button"
          className={`socratic-panel-toggle ${panelOpen ? 'open' : ''}`}
          onClick={() => setPanelOpen((v) => !v)}
        >
          <span>Context &amp; Options</span>
          <ChevronUp size={13} className="socratic-chevron" />
        </button>
      </header>

      {/* Collapsible context + options panel */}
      <div className={`socratic-context-panel ${panelOpen ? 'open' : ''}`}>
        <div className="socratic-context-grid">
          <div className="socratic-ctx-box">
            <span className="socratic-ctx-label">Topic</span>
            <input
              type="text"
              value={context.topic}
              list="socratic-topic-list"
              onChange={(e) => setContext((c) => ({ ...c, topic: e.target.value, source: 'manual' }))}
              placeholder="Quadratic Equations"
            />
            <datalist id="socratic-topic-list">
              {notebookOptions.map((o) => <option key={o} value={o} />)}
            </datalist>
          </div>

          <div className="socratic-ctx-box">
            <span className="socratic-ctx-label">Concept</span>
            <input
              type="text"
              value={context.concept}
              onChange={(e) => setContext((c) => ({ ...c, concept: e.target.value, source: 'manual' }))}
              placeholder="Factoring"
            />
          </div>

          <div className="socratic-ctx-box">
            <span className="socratic-ctx-label">Focus / Error type</span>
            <input
              type="text"
              value={context.errorType}
              onChange={(e) => setContext((c) => ({ ...c, errorType: e.target.value, source: 'manual' }))}
              placeholder="Sign Errors"
            />
          </div>

          <div className="socratic-ctx-box">
            <span className="socratic-ctx-label">Response format</span>
            <div className="socratic-ctx-pills">
              {(['diagram', 'steps', 'voice'] as const).map((opt) => (
                <button
                  key={opt}
                  type="button"
                  className={`socratic-ctx-pill ${activeOption === opt ? 'active' : ''}`}
                  onClick={() => setActiveOption(opt)}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>

          <div className="socratic-ctx-box">
            <span className="socratic-ctx-label">Weak area</span>
            <span className="socratic-ctx-value">{weakTopic || 'None detected yet'}</span>
          </div>

          <div className="socratic-ctx-box">
            <span className="socratic-ctx-label">Source</span>
            <span className="socratic-ctx-value">{context.source}</span>
          </div>
        </div>
      </div>

      {/* Chat column */}
      <div className="socratic-body">
        <div className="socratic-chat-col">
          <div className="socratic-chat-scroll">
            <SocraticChat messages={messages} />
            <div ref={chatEndRef} />
          </div>

          {/* Pinned input bar */}
          <div className="socratic-input-wrap">
            <div className="socratic-input-box">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask about a step, paste a problem, or describe where you got stuck…"
                rows={1}
                className="socratic-input-textarea"
              />
              <div className="socratic-input-row">
                <div className="socratic-mode-icons">
                  <button
                    type="button"
                    className={`socratic-mode-icon ${activeMode === 'voice' ? 'active' : ''}`}
                    onClick={() => toggleMode('voice')}
                    title="Voice"
                  >
                    <Mic size={15} />
                  </button>
                  <button
                    type="button"
                    className={`socratic-mode-icon ${activeMode === 'image' ? 'active' : ''}`}
                    onClick={() => toggleMode('image')}
                    title="Image"
                  >
                    <Image size={15} />
                  </button>
                  <button
                    type="button"
                    className={`socratic-mode-icon ${activeMode === 'equation' ? 'active' : ''}`}
                    onClick={() => toggleMode('equation')}
                    title="Equation"
                  >
                    <Calculator size={15} />
                  </button>
                </div>
                <button
                  type="button"
                  className="socratic-send-btn"
                  onClick={handleSend}
                  disabled={!draft.trim()}
                >
                  <SendHorizontal size={15} />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}