import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  BookOpen,
  Brain,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  FileText,
  GitBranch,
  Lightbulb,
  RefreshCcw,
  Sparkles,
  Star,
} from 'lucide-react';
import { getNotebookQuizSession, listNotes, listSubjects, updateNotebookQuizSession } from '../services/storage';
import { generateStudyTool, type StudyToolType } from '../services/studyTools';

interface StudyToolPageProps {
  tool: StudyToolType;
  initialSubjectId?: string;
  onBack: () => void;
}

interface SubjectRecord {
  id: string;
  name: string;
}

interface NoteRecord {
  id: string;
  title: string;
  content: string;
}

interface FlashcardRecord {
  question: string;
  answer: string;
  difficulty: string;
  tag: string;
}

interface QuizRecord {
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  hint: string;
  difficulty: string;
}

interface StudyToolCacheRecord {
  signature: string;
  output: unknown;
  savedAt: number;
}

const STUDY_TOOL_CACHE_PREFIX = 'study-tool-cache-v1';

const buildStudyToolCacheKey = (tool: StudyToolType, subjectId: string) =>
  `${STUDY_TOOL_CACHE_PREFIX}:${tool}:${subjectId}`;

const buildNotesSignature = (notes: NoteRecord[]) =>
  notes
    .map((note) => `${note.id}:${note.title.length}:${note.content.length}`)
    .sort()
    .join('|');

const readStudyToolCache = (tool: StudyToolType, subjectId: string): StudyToolCacheRecord | null => {
  if (!subjectId) return null;
  try {
    const raw = localStorage.getItem(buildStudyToolCacheKey(tool, subjectId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StudyToolCacheRecord;
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
};

const writeStudyToolCache = (
  tool: StudyToolType,
  subjectId: string,
  cache: StudyToolCacheRecord,
) => {
  if (!subjectId) return;
  try {
    localStorage.setItem(buildStudyToolCacheKey(tool, subjectId), JSON.stringify(cache));
  } catch {
    // Ignore cache write failures (quota/private mode) and continue.
  }
};

const toolConfig: Record<StudyToolType, { title: string; subtitle: string; icon: React.ReactNode }> = {
  flashcards: {
    title: 'Flashcards',
    subtitle: 'AI-powered spaced repetition learning',
    icon: <BookOpen size={18} />,
  },
  quiz: {
    title: 'Quiz',
    subtitle: 'Timed practice with instant feedback',
    icon: <CheckCircle2 size={18} />,
  },
  'revision-sheet': {
    title: 'Revision Sheet',
    subtitle: 'Focused summary for quick exam prep',
    icon: <FileText size={18} />,
  },
  'mind-map': {
    title: 'Mind Map',
    subtitle: 'Visual connections generated from your notes',
    icon: <GitBranch size={18} />,
  },
};

export function StudyToolPage({ tool, initialSubjectId, onBack }: StudyToolPageProps) {
  const [subjects, setSubjects] = useState<SubjectRecord[]>([]);
  const [selectedSubjectId, setSelectedSubjectId] = useState(initialSubjectId || '');
  const [subjectNotes, setSubjectNotes] = useState<NoteRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [output, setOutput] = useState<any>(null);

  const [currentCardIndex, setCurrentCardIndex] = useState(0);
  const [isCardFlipped, setIsCardFlipped] = useState(false);
  const [flashcardRatings, setFlashcardRatings] = useState<Record<number, 'know' | 'later' | 'difficult'>>({});
  const [selectedFlashcardRating, setSelectedFlashcardRating] = useState<'know' | 'later' | 'difficult' | null>(null);

  const [quizIndex, setQuizIndex] = useState(0);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [submittedAnswers, setSubmittedAnswers] = useState<Record<number, number>>({});
  const [showHint, setShowHint] = useState(false);
  const [timeLeft, setTimeLeft] = useState(10 * 60);
  const [quizStarted, setQuizStarted] = useState(false);
  const [quizFinished, setQuizFinished] = useState(false);
  const [isSavingQuizSession, setIsSavingQuizSession] = useState(false);
  const [quizSessionError, setQuizSessionError] = useState('');
  const [existingQuizSession, setExistingQuizSession] = useState<any>(null);

  const config = toolConfig[tool];

  useEffect(() => {
    void listSubjects().then((data) => {
      const typed = data as SubjectRecord[];
      setSubjects(typed);
      if (typed.length > 0) {
        setSelectedSubjectId((current) =>
          current && typed.some((subject) => subject.id === current) ? current : typed[0].id,
        );
      }
    });
  }, []);

  useEffect(() => {
    if (!selectedSubjectId) {
      setSubjectNotes([]);
      setOutput(null);
      return;
    }

    void listNotes(selectedSubjectId).then((data) => {
      setSubjectNotes((data as NoteRecord[]).filter((note) => note.content?.trim()));
    });
  }, [selectedSubjectId]);

  useEffect(() => {
    if (tool !== 'quiz' || !output?.questions?.length || !quizStarted || quizFinished) return;
    if (timeLeft <= 0) return;

    const timer = window.setTimeout(() => {
      setTimeLeft((current) => current - 1);
    }, 1000);

    return () => window.clearTimeout(timer);
  }, [tool, output, quizStarted, quizFinished, timeLeft]);

  const selectedSubject = useMemo(
    () => subjects.find((subject) => subject.id === selectedSubjectId) || null,
    [subjects, selectedSubjectId],
  );

  const generate = async () => {
    if (!selectedSubject || subjectNotes.length === 0) {
      setError('Add notes for this notebook before generating AI study material.');
      return;
    }

    setLoading(true);
    setError('');
    setOutput(null);
    setCurrentCardIndex(0);
    setIsCardFlipped(false);
    setFlashcardRatings({});
    setSelectedFlashcardRating(null);
    setQuizIndex(0);
    setSelectedOption(null);
    setSubmittedAnswers({});
    setShowHint(false);
    setTimeLeft(10 * 60);
    setQuizStarted(false);
    setQuizFinished(false);
    setQuizSessionError('');

    try {
      const response = await generateStudyTool(
        tool,
        selectedSubject.name,
        subjectNotes.map((note) => ({
          title: note.title,
          content: note.content,
        })),
      );
      setOutput(response.output);
      writeStudyToolCache(tool, selectedSubject.id, {
        signature: buildNotesSignature(subjectNotes),
        output: response.output,
        savedAt: Date.now(),
      });
    } catch (generationError) {
      setError(generationError instanceof Error ? generationError.message : 'Unable to generate study material.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!selectedSubjectId) return;
    if (subjectNotes.length === 0) {
      setOutput(null);
      return;
    }
    const signature = buildNotesSignature(subjectNotes);
    const cached = readStudyToolCache(tool, selectedSubjectId);
    if (cached?.signature === signature && cached.output) {
      setOutput(cached.output);
      setError('');
      return;
    }
    setOutput(null);
  }, [selectedSubjectId, subjectNotes, tool]);

  useEffect(() => {
    if (tool !== 'quiz' || !selectedSubjectId) {
      setExistingQuizSession(null);
      return;
    }

    void getNotebookQuizSession(selectedSubjectId)
      .then((record) => setExistingQuizSession(record))
      .catch(() => setExistingQuizSession(null));
  }, [selectedSubjectId, tool]);

  useEffect(() => {
    if (tool !== 'quiz') return;
    setQuizStarted(false);
    setQuizFinished(false);
    setQuizSessionError('');
    setQuizIndex(0);
    setSelectedOption(null);
    setSubmittedAnswers({});
    setShowHint(false);
    setTimeLeft(10 * 60);
  }, [selectedSubjectId, tool]);

  const flashcards = (output?.cards || []) as FlashcardRecord[];
  const quizQuestions = (output?.questions || []) as QuizRecord[];
  const currentCard = flashcards[currentCardIndex];
  const currentQuestion = quizQuestions[quizIndex];

  const knowCount = Object.values(flashcardRatings).filter((value) => value === 'know').length;
  const laterCount = Object.values(flashcardRatings).filter((value) => value === 'later').length;
  const difficultCount = Object.values(flashcardRatings).filter((value) => value === 'difficult').length;
  const answeredCount = Object.keys(submittedAnswers).length;
  const correctCount = quizQuestions.reduce((count, question, index) => {
    if (submittedAnswers[index] === question.correctIndex) return count + 1;
    return count;
  }, 0);

  const submitQuizAnswer = () => {
    if (selectedOption == null || !currentQuestion) return;
    setSubmittedAnswers((current) => ({ ...current, [quizIndex]: selectedOption }));
  };

  const startQuiz = async () => {
    if (!selectedSubjectId || !selectedSubject || quizQuestions.length === 0) return;
    setQuizStarted(true);
    setQuizFinished(false);
    setQuizSessionError('');
    setQuizIndex(0);
    setSelectedOption(null);
    setSubmittedAnswers({});
    setShowHint(false);
    setTimeLeft(10 * 60);

    try {
      setIsSavingQuizSession(true);
      const record = await updateNotebookQuizSession(selectedSubjectId, {
        subjectName: selectedSubject.name,
        attempted: true,
        addTimeSeconds: 0,
      });
      setExistingQuizSession(record);
    } catch {
      setQuizSessionError('Could not sync quiz start right now. You can continue, then finish to retry sync.');
    } finally {
      setIsSavingQuizSession(false);
    }
  };

  const finishQuiz = async () => {
    if (!selectedSubjectId || !selectedSubject || quizQuestions.length === 0 || quizFinished) return;
    const elapsedSeconds = Math.max(0, 10 * 60 - timeLeft);
    const totalQuestions = quizQuestions.length;
    const totalCorrectAnswers = correctCount;
    const totalMistakes = Math.max(0, totalQuestions - totalCorrectAnswers);
    const solved = answeredCount >= totalQuestions;
    setQuizFinished(true);
    setQuizSessionError('');

    try {
      setIsSavingQuizSession(true);
      const record = await updateNotebookQuizSession(selectedSubjectId, {
        subjectName: selectedSubject.name,
        attempted: true,
        solved,
        totalQuestions,
        correctCount: totalCorrectAnswers,
        mistakeCount: totalMistakes,
        addTimeSeconds: elapsedSeconds,
      });
      setExistingQuizSession(record);
    } catch {
      setQuizSessionError('Quiz finished locally, but syncing this quiz session failed.');
    } finally {
      setIsSavingQuizSession(false);
    }
  };

  const submitFlashcardRating = () => {
    if (selectedFlashcardRating == null) return;
    setFlashcardRatings((current) => ({ ...current, [currentCardIndex]: selectedFlashcardRating }));
    const nextIndex = Math.min(flashcards.length - 1, currentCardIndex + 1);
    setCurrentCardIndex(nextIndex);
    setIsCardFlipped(false);
    setSelectedFlashcardRating(nextIndex === currentCardIndex ? selectedFlashcardRating : null);
  };

  const renderFlashcards = () => {
    if (!currentCard) return null;

    return (
      <div className="study-tool-stack">
        <div className="study-tool-card study-progress-card">
          <div className="study-progress-meta">
            <span>Progress</span>
            <strong>
              {currentCardIndex + 1} / {flashcards.length}
            </strong>
          </div>
          <div className="study-progress-bar">
            <div style={{ width: `${((currentCardIndex + 1) / Math.max(flashcards.length, 1)) * 100}%` }} />
          </div>
          <div className="study-score-grid">
            <div>
              <strong className="score-good">{knowCount}</strong>
              <span>I Know</span>
            </div>
            <div>
              <strong className="score-warn">{laterCount}</strong>
              <span>Review Later</span>
            </div>
            <div>
              <strong className="score-bad">{difficultCount}</strong>
              <span>Difficult</span>
            </div>
          </div>
        </div>

        <button
          type="button"
          className="study-tool-card flashcard-stage"
          onClick={() => setIsCardFlipped((current) => !current)}
        >
          <div className="flashcard-stage-meta">
            <span className={`difficulty-pill difficulty-${currentCard.difficulty || 'medium'}`}>
              {currentCard.difficulty || 'medium'}
            </span>
            <span className="tag-pill">{currentCard.tag || selectedSubject?.name}</span>
          </div>
          <div className="flashcard-stage-body">
            <h3>{isCardFlipped ? currentCard.answer : currentCard.question}</h3>
            <p>Click to flip</p>
          </div>
        </button>

        <div className="study-tool-actions">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              setCurrentCardIndex((current) => Math.max(0, current - 1));
              setIsCardFlipped(false);
              setSelectedFlashcardRating(flashcardRatings[Math.max(0, currentCardIndex - 1)] ?? null);
            }}
            disabled={currentCardIndex === 0}
          >
            <ChevronLeft size={16} />
            Previous
          </button>
          <button type="button" className="btn-secondary" onClick={() => setIsCardFlipped((current) => !current)}>
            <RefreshCcw size={16} />
            Flip Card
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              setCurrentCardIndex((current) => Math.min(flashcards.length - 1, current + 1));
              setIsCardFlipped(false);
              const nextIndex = Math.min(flashcards.length - 1, currentCardIndex + 1);
              setSelectedFlashcardRating(flashcardRatings[nextIndex] ?? null);
            }}
            disabled={currentCardIndex >= flashcards.length - 1}
          >
            Next
            <ChevronRight size={16} />
          </button>
        </div>

        <div className="study-tool-actions">
          <button type="button" className={`btn-secondary ${selectedFlashcardRating === 'know' ? 'active' : ''}`} onClick={() => setSelectedFlashcardRating('know')}>
            I Know This
          </button>
          <button type="button" className={`btn-secondary ${selectedFlashcardRating === 'later' ? 'active' : ''}`} onClick={() => setSelectedFlashcardRating('later')}>
            Review Later
          </button>
          <button type="button" className={`btn-secondary ${selectedFlashcardRating === 'difficult' ? 'active' : ''}`} onClick={() => setSelectedFlashcardRating('difficult')}>
            Difficult
          </button>
          <button type="button" className="btn-primary" onClick={submitFlashcardRating} disabled={selectedFlashcardRating == null}>
            Submit
          </button>
        </div>
      </div>
    );
  };

  const renderQuiz = () => {
    if (!currentQuestion) return null;

    if (!quizStarted) {
      return (
        <div className="study-tool-stack">
          <div className="study-tool-card study-sheet-intro">
            <h3>Ready to begin?</h3>
            <p>
              This quiz has {quizQuestions.length} questions and a 10-minute timer. Click start when you are ready.
            </p>
            {existingQuizSession?.attempted ? (
              <p>
                Last saved result: {Number(existingQuizSession.correctCount || 0)}/
                {Number(existingQuizSession.totalQuestions || 0)} correct, {Math.round(Number(existingQuizSession.totalTimeSeconds || 0) / 60)} min total.
              </p>
            ) : null}
            <div className="study-tool-actions">
              <button type="button" className="btn-primary" onClick={() => void startQuiz()} disabled={isSavingQuizSession}>
                Start Quiz
              </button>
            </div>
            {quizSessionError ? <div className="study-inline-panel">{quizSessionError}</div> : null}
          </div>
        </div>
      );
    }

    if (quizFinished) {
      return (
        <div className="study-tool-stack">
          <div className="study-tool-card study-sheet-intro">
            <h3>Quiz Finished</h3>
            <p>
              You answered {correctCount} out of {quizQuestions.length} correctly.
            </p>
            <div className="study-tool-actions">
              <button type="button" className="btn-secondary" onClick={() => void startQuiz()} disabled={isSavingQuizSession}>
                Restart Quiz
              </button>
            </div>
            {quizSessionError ? <div className="study-inline-panel">{quizSessionError}</div> : null}
          </div>
        </div>
      );
    }

    const submittedAnswer = submittedAnswers[quizIndex];
    const isSubmitted = submittedAnswer != null;

    return (
      <div className="study-tool-stack">
        <div className="study-metric-grid">
          <div className="study-tool-card metric-card">
            <Lightbulb size={20} />
            <strong>{Math.floor(timeLeft / 60)}:{String(timeLeft % 60).padStart(2, '0')}</strong>
            <span>Time Left</span>
          </div>
          <div className="study-tool-card metric-card">
            <Sparkles size={20} />
            <strong>{correctCount * 100}</strong>
            <span>Experience Points</span>
          </div>
          <div className="study-tool-card metric-card">
            <CheckCircle2 size={20} />
            <strong>{correctCount}/{answeredCount}</strong>
            <span>Score</span>
          </div>
          <div className="study-tool-card metric-card">
            <Star size={20} />
            <strong>{selectedSubject?.name || 'Notebook'}</strong>
            <span>Current Notebook</span>
          </div>
        </div>

        <div className="study-tool-card study-progress-card">
          <div className="study-progress-meta">
            <span>Question Progress</span>
            <strong>
              {quizIndex + 1} / {quizQuestions.length}
            </strong>
          </div>
          <div className="study-progress-bar">
            <div style={{ width: `${((quizIndex + 1) / Math.max(quizQuestions.length, 1)) * 100}%` }} />
          </div>
        </div>

        <div className="study-tool-card quiz-stage">
          <div className="quiz-stage-header">
            <h3>Question {quizIndex + 1}</h3>
            <span className="tag-pill">{selectedSubject?.name}</span>
          </div>
          <div className="quiz-stage-body">
            <h2>{currentQuestion.question}</h2>
            <div className="quiz-options">
              {currentQuestion.options.map((option, index) => {
                const isCorrect = isSubmitted && index === currentQuestion.correctIndex;
                const isWrong = isSubmitted && selectedOption === index && index !== currentQuestion.correctIndex;

                return (
                  <button
                    key={option}
                    type="button"
                    className={`quiz-option ${selectedOption === index ? 'selected' : ''} ${isCorrect ? 'correct' : ''} ${isWrong ? 'wrong' : ''}`}
                    onClick={() => setSelectedOption(index)}
                    disabled={isSubmitted}
                  >
                    <span>{String.fromCharCode(65 + index)}</span>
                    {option}
                  </button>
                );
              })}
            </div>

            <div className="study-tool-actions">
              <button type="button" className="btn-secondary" onClick={() => setShowHint((current) => !current)}>
                <Lightbulb size={16} />
                {showHint ? 'Hide Hint' : 'Show Hint'}
              </button>
              <button type="button" className="btn-primary" onClick={submitQuizAnswer} disabled={selectedOption == null || isSubmitted}>
                Submit Answer
              </button>
            </div>

            {showHint && currentQuestion.hint ? <div className="study-inline-panel"><strong>Hint:</strong> {currentQuestion.hint}</div> : null}
            {isSubmitted ? (
              <div className="study-inline-panel">
                <strong>{submittedAnswer === currentQuestion.correctIndex ? 'Correct' : 'Try again next time'}:</strong> {currentQuestion.explanation}
              </div>
            ) : null}
          </div>
        </div>

        <div className="study-tool-actions">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              setQuizIndex((current) => Math.max(0, current - 1));
              setSelectedOption(submittedAnswers[Math.max(0, quizIndex - 1)] ?? null);
              setShowHint(false);
            }}
            disabled={quizIndex === 0}
          >
            <ChevronLeft size={16} />
            Previous
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              const nextIndex = Math.min(quizQuestions.length - 1, quizIndex + 1);
              setQuizIndex(nextIndex);
              setSelectedOption(submittedAnswers[nextIndex] ?? null);
              setShowHint(false);
            }}
            disabled={quizIndex >= quizQuestions.length - 1}
          >
            Next
            <ChevronRight size={16} />
          </button>
          <button type="button" className="btn-primary" onClick={() => void finishQuiz()} disabled={isSavingQuizSession}>
            Finish Quiz
          </button>
        </div>
        {quizSessionError ? <div className="study-inline-panel">{quizSessionError}</div> : null}
      </div>
    );
  };

  const renderRevisionSheet = () => {
    if (!output) return null;

    return (
      <div className="study-tool-stack">
        <div className="study-tool-card study-sheet-intro">
          <h3>{output.title || `${selectedSubject?.name} Revision Sheet`}</h3>
          <p>{output.summary}</p>
        </div>
        <div className="study-sheet-grid">
          <div className="study-tool-card">
            <h4>Key Points</h4>
            <ul>{(output.keyPoints || []).map((item: string) => <li key={item}>{item}</li>)}</ul>
          </div>
          <div className="study-tool-card">
            <h4>Formulas</h4>
            <ul>{(output.formulas || []).map((item: string) => <li key={item}>{item}</li>)}</ul>
          </div>
          <div className="study-tool-card">
            <h4>Common Mistakes</h4>
            <ul>{(output.commonMistakes || []).map((item: string) => <li key={item}>{item}</li>)}</ul>
          </div>
          <div className="study-tool-card">
            <h4>Quick Checks</h4>
            <ul>{(output.quickChecks || []).map((item: string) => <li key={item}>{item}</li>)}</ul>
          </div>
        </div>
        <div className="study-tool-card">
          <h4>Exam Tips</h4>
          <ul>{(output.examTips || []).map((item: string) => <li key={item}>{item}</li>)}</ul>
        </div>
      </div>
    );
  };

  const renderMindMap = () => {
    if (!output) return null;

    return (
      <div className="study-tool-stack">
        <div className="mind-map-center">
          <Brain size={22} />
          <strong>{output.centralTopic || selectedSubject?.name}</strong>
        </div>
        <div className="mind-map-grid">
          {(output.branches || []).map((branch: { title: string; points: string[] }) => (
            <div key={branch.title} className="study-tool-card mind-map-branch">
              <h4>{branch.title}</h4>
              <ul>{branch.points.map((point) => <li key={point}>{point}</li>)}</ul>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderBody = () => {
    if (loading) {
      return <div className="study-tool-empty">Generating {config.title.toLowerCase()} from your notes...</div>;
    }

    if (error) {
      return <div className="study-tool-empty">{error}</div>;
    }

    if (!selectedSubjectId) {
      return <div className="study-tool-empty">Create a notebook first to use this feature.</div>;
    }

    if (subjectNotes.length === 0) {
      return <div className="study-tool-empty">This notebook has no notes yet. Add notes first, then generate.</div>;
    }

    if (!output) {
      return <div className="study-tool-empty">Pick a notebook and generate AI study material.</div>;
    }

    if (tool === 'flashcards') return renderFlashcards();
    if (tool === 'quiz') return renderQuiz();
    if (tool === 'revision-sheet') return renderRevisionSheet();
    return renderMindMap();
  };

  return (
    <div className="app-content">
      <section className="study-tool-shell">
        <div className="study-tool-header-row">
          <button type="button" className="btn-secondary" onClick={onBack}>
            <ArrowLeft size={16} />
            Back to My Notes
          </button>
          <div className="study-tool-title">
            <h1>{config.title}</h1>
            <p>{config.subtitle}</p>
          </div>
          <div className="study-tool-header-icon">{config.icon}</div>
        </div>

        <div className="study-tool-toolbar">
          <div className="study-tool-subject-picker">
            <label className="form-label" htmlFor="study-tool-subject">
              Notebook
            </label>
            <select
              id="study-tool-subject"
              value={selectedSubjectId}
              onChange={(e) => setSelectedSubjectId(e.target.value)}
            >
              {subjects.map((subject) => (
                <option key={subject.id} value={subject.id}>
                  {subject.name}
                </option>
              ))}
            </select>
          </div>

          <button type="button" className="btn-primary" onClick={() => void generate()} disabled={loading || !selectedSubjectId}>
            <Sparkles size={16} />
            Generate with AI
          </button>
        </div>

        {renderBody()}
      </section>
    </div>
  );
}
