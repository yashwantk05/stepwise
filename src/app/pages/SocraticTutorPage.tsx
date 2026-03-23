// REMOVE lines 1–8, REPLACE WITH:
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SendHorizontal, Mic, Image as ImageIcon, Calculator, ChevronUp, X, Plus } from 'lucide-react';
import { TutorContextState } from '../components/ContextBar';
import { SocraticChat } from '../components/SocraticChat';
import { getErrorSummary, getProblemErrors, getUserSettings, listSubjects } from '../services/storage';
import { sendSocraticChat, getSpeechToken } from '../services/studyTools';
import * as speechSdk from 'microsoft-cognitiveservices-speech-sdk';

// Extend window for mathlive
declare global {
  interface Window {
    mathVirtualKeyboard: any;
  }
}

const MathInput = ({ draft, setDraft, onEnter }: { draft: string; setDraft: (v: string) => void; onEnter: () => void }) => {
  const mfeRef = useRef<any>(null);

  useEffect(() => {
    import('mathlive').then(() => {
      if (mfeRef.current) {
        mfeRef.current.focus();
        if (window.mathVirtualKeyboard) {
          window.mathVirtualKeyboard.show();
        }
      }
    });

    return () => {
      if (window.mathVirtualKeyboard) {
        window.mathVirtualKeyboard.hide();
      }
    };
  }, []);

  useEffect(() => {
    const node = mfeRef.current;
    if (!node) return;
    const handleInput = (ev: Event) => {
      setDraft((ev.target as any).value);
    };
    node.addEventListener('input', handleInput);
    return () => node.removeEventListener('input', handleInput);
  }, [setDraft]);

  useEffect(() => {
    if (mfeRef.current && mfeRef.current.value !== draft) {
      mfeRef.current.value = draft;
    }
  }, [draft]);

  useEffect(() => {
    const node = mfeRef.current;
    if (!node) return;
    const handleKeydown = (ev: KeyboardEvent) => {
      if (ev.key === 'Enter' && !ev.shiftKey) {
        ev.preventDefault();
        onEnter();
      }
    };
    node.addEventListener('keydown', handleKeydown);
    return () => node.removeEventListener('keydown', handleKeydown);
  }, [onEnter]);

  return React.createElement('math-field', {
    ref: mfeRef,
    style: {
      width: '100%',
      minHeight: '40px',
      fontSize: '1rem',
      border: 'none',
      outline: 'none',
      background: 'transparent',
      padding: '8px 0',
      fontFamily: 'inherit',
      display: 'block'
    }
  });
};

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

interface AttachedImage {
  id: string;
  file: File;
  previewUrl: string;
  base64: string;
  mimeType: string;
}

interface ChatMessage {
  id: string;
  role: 'assistant' | 'user';
  text: string;
  time: string;
  images?: { previewUrl: string }[];
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
  const [isLoading, setIsLoading] = useState(false);
  const [attachedImages, setAttachedImages] = useState<AttachedImage[]>([]);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recognizerRef = useRef<speechSdk.SpeechRecognizer | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const [isRecording, setIsRecording] = useState(false);

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
    if (mode === 'image') {
      imageInputRef.current?.click();
      return;
    }
    setActiveMode((current) => (current === mode ? null : mode));
  };

  const fileToAttachedImage = (file: File): Promise<AttachedImage> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        resolve({
          id: `img-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          file,
          previewUrl: dataUrl,
          base64: dataUrl.split(',')[1],
          mimeType: file.type || 'image/png',
        });
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const allowed = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
    const valid = files.filter(f => allowed.includes(f.type));
    if (!valid.length) return;
    const newImages = await Promise.all(valid.map(fileToAttachedImage));
    setAttachedImages(prev => [...prev, ...newImages].slice(0, 5));
    // Reset file input so same file can be re-selected
    if (imageInputRef.current) imageInputRef.current.value = '';
  };

  const removeAttachedImage = (id: string) => {
    setAttachedImages(prev => prev.filter(img => img.id !== id));
  };

  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData?.items || []);
    const imageItems = items.filter(item => item.type.startsWith('image/'));
    if (!imageItems.length) return;
    e.preventDefault();
    const files = imageItems.map(item => item.getAsFile()).filter(Boolean) as File[];
    const newImages = await Promise.all(files.map(fileToAttachedImage));
    setAttachedImages(prev => [...prev, ...newImages].slice(0, 5));
  };

  const handleSend = useCallback(async (audioBase64?: string) => {
    const trimmed = draft.trim();
    const hasImages = attachedImages.length > 0;
    if ((!trimmed && !audioBase64 && !hasImages) || isLoading) return;

    const autoTopic = context.topic || extractTopicFromText(trimmed, notebookOptions);
    const nextContext = {
      ...context,
      topic: autoTopic || context.topic,
      source: context.topic ? context.source : autoTopic ? 'auto' as const : context.source,
    };
    setContext(nextContext);

    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    // Capture current images for the message before clearing
    const currentImages = [...attachedImages];
    const imagePayloads = currentImages.map(img => ({
      base64: img.base64,
      mimeType: img.mimeType,
    }));

    setDraft('');
    setAttachedImages([]);
    setMessages((current) => [
      ...current,
      {
        id: `user-${Date.now()}`,
        role: 'user',
        text: trimmed || (hasImages ? '' : '(Voice input)'),
        time,
        images: currentImages.map(img => ({ previewUrl: img.previewUrl })),
      },
    ]);
    
    setIsLoading(true);

    try {
      const history = messages.map(m => ({ role: m.role, text: m.text }));
      const selectedClassLevel = getUserSettings().classLevel;
      const response = await sendSocraticChat(trimmed, history, {
        classLevel: selectedClassLevel || undefined,
        audioBase64,
        images: imagePayloads.length > 0 ? imagePayloads : undefined,
        context: {
          topic: nextContext.topic || weakTopic,
          concept: nextContext.concept,
          errorType: nextContext.errorType || recentErrorType,
        }
      });

      setMessages((current) => [
        ...current,
        {
          id: `assistant-${Date.now() + 1}`,
          role: 'assistant',
          text: response.reply + (response.usedNotes ? '\n\n*(Based on your notes)*' : ''),
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
    } catch (err) {
      setMessages((current) => [
        ...current,
        {
          id: `assistant-${Date.now() + 1}`,
          role: 'assistant',
          text: 'Oops, something went wrong. Let me think about that again.',
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  }, [context, draft, attachedImages, notebookOptions, recentErrorType, weakTopic, isLoading, messages]);

  const stopRecording = useCallback(() => {
    setIsRecording(false);
    setActiveMode(null);
    if (recognizerRef.current) {
      recognizerRef.current.stopContinuousRecognitionAsync();
      recognizerRef.current.close();
      recognizerRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach(t => t.stop());
    }
  }, []);

  const handleToggleVoice = async () => {
    if (isRecording) {
      stopRecording();
      return;
    }
    
    setActiveMode('voice');
    setIsRecording(true);
    setDraft('');
    
    try {
      // 1. Capture Raw Audio for GPT-4o
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];
      
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = () => {
          const base64data = (reader.result as string).split(',')[1];
          void handleSend(base64data);
        };
      };

      mediaRecorder.start();

      // 2. Transcribe for visual feedback using Azure Speech
      const { token, region } = await getSpeechToken();
      const speechConfig = speechSdk.SpeechConfig.fromAuthorizationToken(token, region);
      speechConfig.speechRecognitionLanguage = 'en-US';
      const audioConfig = speechSdk.AudioConfig.fromDefaultMicrophoneInput();
      const recognizer = new speechSdk.SpeechRecognizer(speechConfig, audioConfig);
      recognizerRef.current = recognizer;
      
      let finalTranscript = '';
      
      recognizer.recognizing = (_, e) => {
        if (e.result.reason === speechSdk.ResultReason.RecognizingSpeech) {
          setDraft(finalTranscript + ' ' + e.result.text);
        }
      };

      recognizer.recognized = (_, e) => {
        if (e.result.reason === speechSdk.ResultReason.RecognizedSpeech) {
          finalTranscript += ' ' + e.result.text;
          setDraft(finalTranscript.trim());
        }
      };

      recognizer.startContinuousRecognitionAsync();
    } catch (err) {
      console.error("Audio recording failed", err);
      setIsRecording(false);
      setActiveMode(null);
    }
  };



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
              {/* Image preview strip */}
              {attachedImages.length > 0 && (
                <div className="socratic-image-previews">
                  {attachedImages.map(img => (
                    <div key={img.id} className="socratic-image-thumb">
                      <img src={img.previewUrl} alt="Attached" />
                      <button
                        type="button"
                        className="socratic-image-remove"
                        onClick={() => removeAttachedImage(img.id)}
                        title="Remove image"
                      >
                        <X size={10} />
                      </button>
                    </div>
                  ))}
                  {attachedImages.length < 5 && (
                    <button
                      type="button"
                      className="socratic-image-add-more"
                      onClick={() => imageInputRef.current?.click()}
                      title="Add another image"
                    >
                      <Plus size={14} />
                    </button>
                  )}
                </div>
              )}
              {activeMode === 'equation' ? (
                <MathInput draft={draft} setDraft={setDraft} onEnter={() => handleSend()} />
              ) : (
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onPaste={handlePaste}
                  placeholder={attachedImages.length > 0 ? 'Add a message about these images…' : 'Ask about a step, paste a problem, or describe where you got stuck…'}
                  rows={1}
                  className="socratic-input-textarea"
                />
              )}
              {/* Hidden file input */}
              <input
                ref={imageInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                multiple
                onChange={handleImageSelect}
                style={{ display: 'none' }}
              />
              <div className="socratic-input-row">
                <div className="socratic-mode-icons">
                  <button
                    type="button"
                    className={`socratic-mode-icon ${activeMode === 'voice' || isRecording ? 'active' : ''}`}
                    onClick={handleToggleVoice}
                    title="Voice"
                  >
                    <Mic size={15} />
                  </button>
                  <button
                    type="button"
                    className={`socratic-mode-icon ${attachedImages.length > 0 ? 'active' : ''}`}
                    onClick={() => toggleMode('image')}
                    title="Attach image"
                  >
                    <ImageIcon size={15} />
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
                  onClick={() => handleSend()}
                  disabled={!draft.trim() && attachedImages.length === 0}
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
