import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SendHorizontal, Mic, Image as ImageIcon, Calculator, ChevronUp, X, Plus, MessageSquarePlus, PanelLeft, Trash2 } from 'lucide-react';
import { TutorContextState } from '../components/ContextBar';
import { SocraticChat } from '../components/SocraticChat';
import { getUserSettings, listSubjects } from '../services/storage';
import { createSocraticThread, deleteSocraticThread, getSpeechToken, getSocraticChatHistory, getSocraticThreadMessages, sendSocraticChat } from '../services/studyTools';
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

interface ChatThread {
  id: string;
  title: string;
  preview: string;
  createdAt: number;
  updatedAt: number;
}

type TutorMode = 'saarthi' | 'vaani';

const TUTOR_MODE_STORAGE_KEY = 'stepwise.tutorMode';
const DEFAULT_TUTOR_MODE: TutorMode = 'saarthi';

const getStoredTutorMode = (): TutorMode => {
  if (typeof window === 'undefined') return DEFAULT_TUTOR_MODE;
  const value = window.localStorage.getItem(TUTOR_MODE_STORAGE_KEY);
  return value === 'vaani' ? 'vaani' : DEFAULT_TUTOR_MODE;
};

const getTutorProfile = (mode: TutorMode) =>
  mode === 'vaani'
    ? {
      title: 'Vaani Tutor',
      subtitle: 'Direct tutor',
      introMessage: 'Tell me what you need. I’ll explain it directly and clearly.',
    }
    : {
      title: 'Saarthi Tutor',
      subtitle: 'Socratic tutor',
      introMessage: 'Want to understand this better? Let’s work through it step by step.',
    };

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

const formatAssistantReply = (reply: string) =>
  String(reply || '')
    .trim()
    // Put numbered points on separate lines for readability.
    .replace(/\s+(?=\d+\.\s)/g, '\n')
    // Normalize dash bullets into separate lines.
    .replace(/\s+-\s+/g, '\n- ')
    .replace(/\n{3,}/g, '\n\n');

const formatSpeechText = (reply: string) =>
  String(reply || '')
    .replace(/\(Based on your notes\)/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

const formatChatTime = (createdAt?: number) => {
  const value = Number(createdAt);
  if (!Number.isFinite(value) || value <= 0) {
    return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const buildInitialAssistantMessage = (mode: TutorMode): ChatMessage => ({
  id: 'assistant-initial',
  role: 'assistant',
  text: getTutorProfile(mode).introMessage,
  time: formatChatTime(Date.now()),
});


export function SocraticTutorPage({
  initialContext,
}: {
  initialContext?: Partial<TutorContextState>;
}) {
  const [tutorMode, setTutorMode] = useState<TutorMode>(() => getStoredTutorMode());
  const [subjects, setSubjects] = useState<SubjectRecord[]>([]);
  const [context, setContext] = useState<TutorContextState>({
    topic: initialContext?.topic || '',
    concept: '',
    errorType: '',
    source: 'manual',
    assignmentId: initialContext?.assignmentId,
    problemIndex: initialContext?.problemIndex,
  });
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [activeMode, setActiveMode] = useState<'voice' | 'image' | 'equation' | null>(null);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [playingAssistantMessageId, setPlayingAssistantMessageId] = useState<string | null>(null);
  const [attachedImages, setAttachedImages] = useState<AttachedImage[]>([]);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recognizerRef = useRef<speechSdk.SpeechRecognizer | null>(null);
  const synthesizerRef = useRef<speechSdk.SpeechSynthesizer | null>(null);
  const speechPlayerRef = useRef<speechSdk.SpeakerAudioDestination | null>(null);
  const playingAssistantMessageIdRef = useRef<string | null>(null);
  const speechSessionRef = useRef(0);
  const audioChunksRef = useRef<Blob[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const initialTutorModeRef = useRef<TutorMode>(tutorMode);
  const tutorProfile = useMemo(() => getTutorProfile(tutorMode), [tutorMode]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(TUTOR_MODE_STORAGE_KEY, tutorMode);
  }, [tutorMode]);

  useEffect(() => {
    listSubjects().then((rows) => setSubjects(rows as SubjectRecord[])).catch(() => {});
  }, []);

  useEffect(() => {
    let mounted = true;
    getSocraticChatHistory(200)
      .then((payload) => {
        if (!mounted) return;
        const loaded = Array.isArray(payload?.threads)
          ? payload.threads.map((thread) => ({
            id: thread.id,
            title: String(thread.title || 'New chat'),
            preview: String(thread.preview || ''),
            createdAt: Number(thread.createdAt || Date.now()),
            updatedAt: Number(thread.updatedAt || Date.now()),
          }))
          : [];
        setThreads(loaded);
        if (loaded.length > 0) {
          setActiveThreadId((current) => current || loaded[0].id);
          return;
        }
        setMessages((current) => (current.length > 0 ? current : [buildInitialAssistantMessage(initialTutorModeRef.current)]));
      })
      .catch(() => {
        if (!mounted) return;
        setMessages((current) => (current.length > 0 ? current : [buildInitialAssistantMessage(initialTutorModeRef.current)]));
      });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!activeThreadId) return;
    let mounted = true;
    getSocraticThreadMessages(activeThreadId, 200)
      .then((payload) => {
        if (!mounted) return;
        const loaded = Array.isArray(payload?.messages)
          ? payload.messages.map((msg) => ({
            id: msg.id,
            role: msg.role === 'assistant' ? 'assistant' : 'user',
            text: msg.role === 'assistant' ? formatAssistantReply(msg.text) : String(msg.text || ''),
            time: formatChatTime(msg.createdAt),
          }))
          : [];
        setMessages(loaded.length > 0 ? loaded : [buildInitialAssistantMessage(initialTutorModeRef.current)]);
      })
      .catch(() => {
        if (!mounted) return;
        setMessages([buildInitialAssistantMessage(initialTutorModeRef.current)]);
      });

    return () => {
      mounted = false;
    };
  }, [activeThreadId]);

  const notebookOptions = useMemo(() => subjects.map((subject) => subject.name), [subjects]);
  
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const stopAssistantSpeech = useCallback(() => {
    speechSessionRef.current += 1;
    const activeSynthesizer = synthesizerRef.current;
    const activePlayer = speechPlayerRef.current;
    synthesizerRef.current = null;
    speechPlayerRef.current = null;
    if (activeSynthesizer) {
      if (typeof activeSynthesizer.stopSpeakingAsync === 'function') {
        activeSynthesizer.stopSpeakingAsync(
          () => {
            activeSynthesizer.close();
          },
          () => {
            activeSynthesizer.close();
          },
        );
      } else {
        activeSynthesizer.close();
      }
    }
    if (activePlayer) {
      try {
        activePlayer.pause();
      } catch {}
      try {
        const audio = activePlayer.internalAudio;
        if (audio) {
          audio.pause();
          audio.removeAttribute('src');
          audio.srcObject = null;
          audio.load();
        }
      } catch {}
      try {
        activePlayer.close();
      } catch {}
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    playingAssistantMessageIdRef.current = null;
    setPlayingAssistantMessageId(null);
  }, []);

  const speakAssistantReply = useCallback(async (messageId: string, text: string) => {
    const utteranceText = formatSpeechText(text);
    if (!utteranceText) return;

    stopAssistantSpeech();
    const sessionId = speechSessionRef.current + 1;
    speechSessionRef.current = sessionId;
    playingAssistantMessageIdRef.current = messageId;
    setPlayingAssistantMessageId(messageId);
    let azureSpeakAttempted = false;

    try {
      const { token, region } = await getSpeechToken();
      if (speechSessionRef.current !== sessionId) return;
      const speechConfig = speechSdk.SpeechConfig.fromAuthorizationToken(token, region);
      speechConfig.speechSynthesisVoiceName = 'en-US-AriaNeural';
      const player = new speechSdk.SpeakerAudioDestination();
      player.onAudioEnd = () => {
        if (speechPlayerRef.current === player) {
          speechPlayerRef.current = null;
        }
        if (speechSessionRef.current === sessionId) {
          playingAssistantMessageIdRef.current = null;
          setPlayingAssistantMessageId(null);
        }
      };
      speechPlayerRef.current = player;
      const audioConfig = speechSdk.AudioConfig.fromSpeakerOutput(player);
      const synthesizer = new speechSdk.SpeechSynthesizer(speechConfig, audioConfig);
      if (speechSessionRef.current !== sessionId) {
        player.close();
        synthesizer.close();
        return;
      }
      synthesizerRef.current = synthesizer;

      await new Promise<void>((resolve, reject) => {
        azureSpeakAttempted = true;
        synthesizer.speakTextAsync(
          utteranceText,
          () => {
            synthesizer.close();
            if (synthesizerRef.current === synthesizer) {
              synthesizerRef.current = null;
            }
            resolve();
          },
          (error) => {
            synthesizer.close();
            if (synthesizerRef.current === synthesizer) {
              synthesizerRef.current = null;
            }
            if (speechPlayerRef.current === player) {
              player.close();
              speechPlayerRef.current = null;
            }
            reject(error);
          }
        );
      });
      return;
    } catch (error) {
      if (speechSessionRef.current !== sessionId) return;
      // Avoid duplicate playback when Azure already attempted to speak.
      if (azureSpeakAttempted) {
        playingAssistantMessageIdRef.current = null;
        setPlayingAssistantMessageId(null);
        return;
      }
      console.warn('Azure TTS unavailable, falling back to browser speech.', error);
    }

    if (speechSessionRef.current !== sessionId) return;
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      playingAssistantMessageIdRef.current = null;
      setPlayingAssistantMessageId(null);
      return;
    }

    const utterance = new SpeechSynthesisUtterance(utteranceText);
    utterance.lang = 'en-US';
    utterance.onend = () => {
      if (speechSessionRef.current === sessionId) {
        playingAssistantMessageIdRef.current = null;
        setPlayingAssistantMessageId(null);
      }
    };
    utterance.onerror = () => {
      if (speechSessionRef.current === sessionId) {
        playingAssistantMessageIdRef.current = null;
        setPlayingAssistantMessageId(null);
      }
    };
    window.speechSynthesis.speak(utterance);
  }, [stopAssistantSpeech]);

  useEffect(() => () => {
    stopAssistantSpeech();
  }, [stopAssistantSpeech]);

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
      let threadId = activeThreadId;
      if (!threadId) {
        const titleSeed = trimmed || 'New chat';
        const createdThread = await createSocraticThread(titleSeed.slice(0, 120));
        threadId = createdThread.id;
        setThreads((current) => [createdThread, ...current.filter((item) => item.id !== createdThread.id)]);
        setActiveThreadId(createdThread.id);
      }

      const history = messages.map(m => ({ role: m.role, text: m.text }));
      const selectedClassLevel = getUserSettings().classLevel;
      const response = await sendSocraticChat(trimmed, history, {
        threadId,
        classLevel: selectedClassLevel || undefined,
        tutorMode,
        audioBase64,
        images: imagePayloads.length > 0 ? imagePayloads : undefined,
        context: {
          topic: nextContext.topic,
        }
      });

      setMessages((current) => [
        ...current,
        {
          id: `assistant-${Date.now() + 1}`,
          role: 'assistant',
          text: formatAssistantReply(response.reply) + (response.usedNotes ? '\n\n(Based on your notes)' : ''),
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
      if (threadId) {
        const nextTitle = trimmed ? trimmed.slice(0, 120) : 'New chat';
        const nextPreview = formatAssistantReply(response.reply).split('\n')[0] || trimmed || 'New chat';
        setThreads((current) => {
          const existing = current.find((item) => item.id === threadId);
          const updatedThread: ChatThread = {
            id: threadId,
            title: existing && existing.title !== 'New chat' ? existing.title : nextTitle,
            preview: nextPreview,
            createdAt: existing?.createdAt || Date.now(),
            updatedAt: Date.now(),
          };
          return [updatedThread, ...current.filter((item) => item.id !== threadId)];
        });
      }
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
  }, [context, draft, attachedImages, notebookOptions, isLoading, messages, tutorMode]);

  const handleNewChat = useCallback(async () => {
    setDraft('');
    setAttachedImages([]);
    stopAssistantSpeech();
    const thread = await createSocraticThread('New chat');
    setThreads((current) => [thread, ...current.filter((item) => item.id !== thread.id)]);
    setActiveThreadId(thread.id);
    setMessages([buildInitialAssistantMessage(tutorMode)]);
  }, [stopAssistantSpeech, tutorMode]);

  const handleToggleAssistantMessageAudio = useCallback((messageId: string, text: string) => {
    if (playingAssistantMessageIdRef.current === messageId) {
      stopAssistantSpeech();
      return;
    }
    void speakAssistantReply(messageId, text);
  }, [speakAssistantReply, stopAssistantSpeech]);

  const handleDeleteThread = useCallback(async (threadId: string) => {
    try {
      await deleteSocraticThread(threadId);
      const fallbackThreadId = activeThreadId === threadId
        ? (threads.find((item) => item.id !== threadId)?.id || null)
        : activeThreadId;
      setThreads((current) => current.filter((item) => item.id !== threadId));
      if (activeThreadId === threadId) {
        setActiveThreadId(fallbackThreadId);
        if (!fallbackThreadId) {
          setMessages([buildInitialAssistantMessage(tutorMode)]);
        }
      }
    } catch {
      // Keep UI unchanged when delete fails.
    }
  }, [activeThreadId, threads, tutorMode]);

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
          <div className="socratic-topbar-main">
            <button
              type="button"
              className={`socratic-history-toggle ${isHistoryOpen ? 'open' : ''}`}
              onClick={() => setIsHistoryOpen((current) => !current)}
              aria-label={isHistoryOpen ? 'Close chat history' : 'Open chat history'}
            >
              <PanelLeft size={16} />
            </button>
            <div>
              <h1>{tutorProfile.title}</h1>
              <p>{tutorProfile.subtitle}</p>
            </div>
          </div>
        </div>
        <div className="socratic-topbar-controls">
          <div className="socratic-tutor-toggle" role="group" aria-label="Tutor mode">
            <button
              type="button"
              className={`socratic-tutor-toggle-btn ${tutorMode === 'saarthi' ? 'active' : ''}`}
              onClick={() => setTutorMode('saarthi')}
              aria-pressed={tutorMode === 'saarthi'}
            >
              Saarthi
            </button>
            <button
              type="button"
              className={`socratic-tutor-toggle-btn ${tutorMode === 'vaani' ? 'active' : ''}`}
              onClick={() => setTutorMode('vaani')}
              aria-pressed={tutorMode === 'vaani'}
            >
              Vaani
            </button>
          </div>
          <button
            type="button"
            className={`socratic-panel-toggle ${panelOpen ? 'open' : ''}`}
            onClick={() => setPanelOpen((v) => !v)}
          >
            <span>Topic</span>
            <ChevronUp size={13} className="socratic-chevron" />
          </button>
        </div>
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
              onChange={(e) => setContext((c) => ({ ...c, topic: e.target.value }))}
              placeholder="Quadratic Equations"
            />
            <datalist id="socratic-topic-list">
              {notebookOptions.map((o) => <option key={o} value={o} />)}
            </datalist>
          </div>
        </div>
      </div>

      <div className="socratic-body">
        {isHistoryOpen && (
          <button
            type="button"
            className="socratic-history-backdrop"
            onClick={() => setIsHistoryOpen(false)}
            aria-label="Close chat history"
          />
        )}

        <aside className={`socratic-history-rail ${isHistoryOpen ? 'open' : ''}`}>
          <button type="button" className="socratic-new-chat-btn" onClick={() => void handleNewChat()}>
            <MessageSquarePlus size={15} />
            <span>New chat</span>
          </button>

          <div className="socratic-history-list">
            {threads.map((thread) => (
              <div
                key={thread.id}
                className={`socratic-history-item ${activeThreadId === thread.id ? 'active' : ''}`}
              >
                <button
                  type="button"
                  className="socratic-history-item-main"
                  onClick={() => {
                    setActiveThreadId(thread.id);
                    setIsHistoryOpen(false);
                  }}
                >
                  <strong>{thread.title || 'New chat'}</strong>
                  <span>{thread.preview || 'Open conversation'}</span>
                </button>
                <button
                  type="button"
                  className="socratic-history-delete-btn"
                  aria-label={`Delete ${thread.title || 'chat'}`}
                  title="Delete chat"
                  onClick={(event) => {
                    event.stopPropagation();
                    void handleDeleteThread(thread.id);
                  }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </aside>

        <div className="socratic-chat-col">
          <div className="socratic-chat-scroll">
            <SocraticChat
              messages={messages}
              tutorMode={tutorMode}
              playingAssistantMessageId={playingAssistantMessageId}
              onToggleAssistantMessageAudio={handleToggleAssistantMessageAudio}
            />
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
