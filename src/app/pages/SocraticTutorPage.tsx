import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SendHorizontal, Mic, Image as ImageIcon, Calculator, ChevronUp, X, Plus, MessageSquarePlus, PanelLeft } from 'lucide-react';
import { TutorContextState } from '../components/ContextBar';
import { SocraticChat } from '../components/SocraticChat';
import { registerGlobalAudioStopHandler, setGlobalAudioSourceActive } from '../services/audioControl';
import { getUserSettings, listSubjects } from '../services/storage';
import { createSocraticThread, deleteSocraticThread, getSpeechToken, getSocraticChatHistory, getSocraticThreadMessages, sendSocraticChat } from '../services/studyTools';
import { getSpeechLanguageCode } from '../services/translation';
import * as speechSdk from 'microsoft-cognitiveservices-speech-sdk';

type TutorId = 'vaani' | 'saarthi';

const THREAD_TUTOR_MAP_KEY = 'stepwise_socratic_thread_tutors_v1';
const TUTOR_OPTIONS: Array<{
  id: TutorId;
  name: string;
  avatar: string;
  title: string;
  description: string;
  openingMessage: string;
}> = [
  {
    id: 'vaani',
    name: 'Vaani',
    avatar: '👩',
    title: 'Direct answer tutor',
    description: 'Gives the answer directly and then explains it in a short, clear way.',
    openingMessage: 'I am Vaani. Send me your question and I will give you the answer directly with a quick explanation.',
  },
  {
    id: 'saarthi',
    name: 'Saarthi',
    avatar: '👨',
    title: 'Step-by-step guide',
    description: 'Sticks to the guided Socratic flow and reveals only the steps needed to solve.',
    openingMessage: 'I am Saarthi. Let us work through this carefully, one step at a time.',
  },
];

const tutorMetaById = Object.fromEntries(
  TUTOR_OPTIONS.map((tutor) => [tutor.id, tutor]),
) as Record<TutorId, (typeof TUTOR_OPTIONS)[number]>;

const TUTOR_COPY = {
  en: {
    vaani: {
      title: 'Direct answer tutor',
      description: 'Gives the answer directly and then explains it in a short, clear way.',
      openingMessage: 'I am Vaani. Send me your question and I will give you the answer directly with a quick explanation.',
    },
    saarthi: {
      title: 'Step-by-step guide',
      description: 'Sticks to the guided Socratic flow and reveals only the steps needed to solve.',
      openingMessage: 'I am Saarthi. Let us work through this carefully, one step at a time.',
    },
  },
  hi: {
    vaani: {
      title: 'सीधा उत्तर देने वाली ट्यूटर',
      description: 'सीधे उत्तर देती है और फिर उसे छोटे और स्पष्ट तरीके से समझाती है।',
      openingMessage: 'मैं वाणी हूँ। अपना प्रश्न भेजिए, मैं आपको सीधे उत्तर के साथ संक्षिप्त व्याख्या दूँगी।',
    },
    saarthi: {
      title: 'चरण-दर-चरण मार्गदर्शक',
      description: 'सही उत्तर तक पहुँचने के लिए केवल ज़रूरी चरणों के साथ मार्गदर्शन करता है।',
      openingMessage: 'मैं सार्थी हूँ। चलिए इसे ध्यान से, एक-एक चरण में समझते हैं।',
    },
  },
  te: {
    vaani: {
      title: 'నేరుగా సమాధానం చెప్పే ట్యూటర్',
      description: 'సమాధానాన్ని నేరుగా చెప్పి, తర్వాత చిన్నగా మరియు స్పష్టంగా వివరిస్తుంది.',
      openingMessage: 'నేను వాణి. మీ ప్రశ్నను పంపండి, నేను నేరుగా సమాధానాన్ని చిన్న వివరణతో చెబుతాను.',
    },
    saarthi: {
      title: 'దశలవారీ మార్గదర్శి',
      description: 'సరైన సమాధానానికి చేరుకునేలా అవసరమైన దశలతో మార్గనిర్దేశనం చేస్తాడు.',
      openingMessage: 'నేను సారథి. మనం దీన్ని జాగ్రత్తగా, ఒక్కో దశగా చూద్దాం.',
    },
  },
  ta: {
    vaani: {
      title: 'நேரடி பதில் ஆசிரியர்',
      description: 'பதிலை நேரடியாகக் கூறி, அதை சுருக்கமாகவும் தெளிவாகவும் விளக்குகிறார்.',
      openingMessage: 'நான் வாணி. உங்கள் கேள்வியை அனுப்புங்கள், நான் நேரடி பதிலும் சுருக்கமான விளக்கமும் தருகிறேன்.',
    },
    saarthi: {
      title: 'படிப்படியான வழிகாட்டி',
      description: 'சரியான பதிலை அடைய தேவையான படிகளால் மட்டுமே வழிநடத்துகிறார்.',
      openingMessage: 'நான் சாரதி. இதை நிதானமாக, ஒரு படி ஒரு படியாகப் பார்க்கலாம்.',
    },
  },
  es: {
    vaani: {
      title: 'Tutora de respuesta directa',
      description: 'Da la respuesta directamente y luego la explica de forma breve y clara.',
      openingMessage: 'Soy Vaani. Envíame tu pregunta y te daré la respuesta directa con una explicación breve.',
    },
    saarthi: {
      title: 'Guía paso a paso',
      description: 'Te guía solo con los pasos necesarios para llegar a la respuesta correcta.',
      openingMessage: 'Soy Saarthi. Vamos a resolver esto con cuidado, paso a paso.',
    },
  },
  fr: {
    vaani: {
      title: 'Tutrice à réponse directe',
      description: 'Donne la réponse directement puis l’explique de manière courte et claire.',
      openingMessage: 'Je suis Vaani. Envoie-moi ta question et je te donnerai la réponse directe avec une brève explication.',
    },
    saarthi: {
      title: 'Guide pas à pas',
      description: 'Guide seulement avec les étapes nécessaires pour atteindre la bonne réponse.',
      openingMessage: 'Je suis Saarthi. Avançons prudemment, une étape à la fois.',
    },
  },
  de: {
    vaani: {
      title: 'Tutorin für direkte Antworten',
      description: 'Gibt die Antwort direkt und erklärt sie dann kurz und klar.',
      openingMessage: 'Ich bin Vaani. Schick mir deine Frage und ich gebe dir die direkte Antwort mit einer kurzen Erklärung.',
    },
    saarthi: {
      title: 'Schritt-für-Schritt-Begleiter',
      description: 'Führt nur mit den nötigen Schritten zur richtigen Antwort.',
      openingMessage: 'Ich bin Saarthi. Lass uns das sorgfältig Schritt für Schritt angehen.',
    },
  },
} as const;

const getTutorCopy = (languageCode: string, tutorId: TutorId) =>
  TUTOR_COPY[String(languageCode || 'en').trim().toLowerCase() as keyof typeof TUTOR_COPY]?.[tutorId] ||
  TUTOR_COPY.en[tutorId];

const UI_COPY = {
  en: {
    yourTutors: 'Your Tutors',
    changeTutor: 'Change Tutor',
    closeChatHistory: 'Close chat history',
    openChatHistory: 'Open chat history',
    topic: 'Topic',
    topicPlaceholder: 'Quadratic Equations',
    newChat: 'New chat',
    openConversation: 'Open conversation',
    deleteChat: 'Delete chat',
    deleteChatFallback: 'chat',
    attachedImageAlt: 'Attached',
    removeImage: 'Remove image',
    addAnotherImage: 'Add another image',
    imageMessagePlaceholder: 'Add a message about these images...',
    textMessagePlaceholder: 'Ask about a step, paste a problem, or describe where you got stuck...',
    voice: 'Voice',
    attachImage: 'Attach image',
    equation: 'Equation',
    voiceInput: '(Voice input)',
    tutorReady: 'is ready to help with',
  },
  hi: {
    yourTutors: 'आपके ट्यूटर',
    changeTutor: 'ट्यूटर बदलें',
    closeChatHistory: 'चैट इतिहास बंद करें',
    openChatHistory: 'चैट इतिहास खोलें',
    topic: 'विषय',
    topicPlaceholder: 'द्विघात समीकरण',
    newChat: 'नई चैट',
    openConversation: 'बातचीत खोलें',
    deleteChat: 'चैट हटाएँ',
    deleteChatFallback: 'चैट',
    attachedImageAlt: 'संलग्न चित्र',
    removeImage: 'चित्र हटाएँ',
    addAnotherImage: 'एक और चित्र जोड़ें',
    imageMessagePlaceholder: 'इन चित्रों के बारे में संदेश जोड़ें...',
    textMessagePlaceholder: 'किसी चरण के बारे में पूछें, प्रश्न चिपकाएँ, या बताएँ कि आप कहाँ अटके...',
    voice: 'आवाज़',
    attachImage: 'चित्र जोड़ें',
    equation: 'समीकरण',
    voiceInput: '(वॉइस इनपुट)',
    tutorReady: 'इसमें मदद करने के लिए तैयार हैं',
  },
  te: {
    yourTutors: 'మీ ట్యూటర్లు',
    changeTutor: 'ట్యూటర్ మార్చండి',
    closeChatHistory: 'చాట్ చరిత్రను మూసివేయండి',
    openChatHistory: 'చాట్ చరిత్రను తెరవండి',
    topic: 'విషయం',
    topicPlaceholder: 'ద్విఘాత సమీకరణాలు',
    newChat: 'కొత్త చాట్',
    openConversation: 'సంభాషణను తెరవండి',
    deleteChat: 'చాట్ తొలగించండి',
    deleteChatFallback: 'చాట్',
    attachedImageAlt: 'జత చేసిన చిత్రం',
    removeImage: 'చిత్రాన్ని తొలగించండి',
    addAnotherImage: 'మరో చిత్రాన్ని జోడించండి',
    imageMessagePlaceholder: 'ఈ చిత్రాల గురించి ఒక సందేశం జోడించండి...',
    textMessagePlaceholder: 'ఒక దశ గురించి అడగండి, సమస్యను పేస్ట్ చేయండి, లేదా మీరు ఎక్కడ ఆగిపోయారో చెప్పండి...',
    voice: 'వాయిస్',
    attachImage: 'చిత్రం జోడించండి',
    equation: 'సమీకరణం',
    voiceInput: '(వాయిస్ ఇన్‌పుట్)',
    tutorReady: 'దీనిలో సహాయం చేయడానికి సిద్ధంగా ఉన్నారు',
  },
  ta: {
    yourTutors: 'உங்கள் டியூட்டர்கள்',
    changeTutor: 'டியூட்டரை மாற்றவும்',
    closeChatHistory: 'அரட்டை வரலாற்றை மூடவும்',
    openChatHistory: 'அரட்டை வரலாற்றை திறக்கவும்',
    topic: 'தலைப்பு',
    topicPlaceholder: 'இரண்டடுக்குச் சமன்பாடுகள்',
    newChat: 'புதிய அரட்டை',
    openConversation: 'உரையாடலை திறக்கவும்',
    deleteChat: 'அரட்டையை நீக்கவும்',
    deleteChatFallback: 'அரட்டை',
    attachedImageAlt: 'இணைக்கப்பட்ட படம்',
    removeImage: 'படத்தை அகற்று',
    addAnotherImage: 'மற்றொரு படத்தைச் சேர்க்கவும்',
    imageMessagePlaceholder: 'இந்த படங்களைப் பற்றி ஒரு செய்தி சேர்க்கவும்...',
    textMessagePlaceholder: 'ஒரு படியைப் பற்றி கேளுங்கள், கேள்வியை ஒட்டுங்கள், அல்லது நீங்கள் எங்கு சிக்கினீர்கள் என்பதைச் சொல்லுங்கள்...',
    voice: 'குரல்',
    attachImage: 'படம் சேர்க்கவும்',
    equation: 'சமன்பாடு',
    voiceInput: '(குரல் உள்ளீடு)',
    tutorReady: 'இதில் உதவ தயாராக இருக்கிறார்',
  },
  es: {
    yourTutors: 'Tus tutores',
    changeTutor: 'Cambiar tutor',
    closeChatHistory: 'Cerrar historial del chat',
    openChatHistory: 'Abrir historial del chat',
    topic: 'Tema',
    topicPlaceholder: 'Ecuaciones cuadráticas',
    newChat: 'Nuevo chat',
    openConversation: 'Abrir conversación',
    deleteChat: 'Eliminar chat',
    deleteChatFallback: 'chat',
    attachedImageAlt: 'Imagen adjunta',
    removeImage: 'Eliminar imagen',
    addAnotherImage: 'Agregar otra imagen',
    imageMessagePlaceholder: 'Agrega un mensaje sobre estas imágenes...',
    textMessagePlaceholder: 'Pregunta sobre un paso, pega un problema o describe dónde te atascaste...',
    voice: 'Voz',
    attachImage: 'Adjuntar imagen',
    equation: 'Ecuación',
    voiceInput: '(Entrada de voz)',
    tutorReady: 'está lista para ayudarte con',
  },
  fr: {
    yourTutors: 'Vos tuteurs',
    changeTutor: 'Changer de tuteur',
    closeChatHistory: 'Fermer l’historique du chat',
    openChatHistory: 'Ouvrir l’historique du chat',
    topic: 'Sujet',
    topicPlaceholder: 'Équations quadratiques',
    newChat: 'Nouveau chat',
    openConversation: 'Ouvrir la conversation',
    deleteChat: 'Supprimer le chat',
    deleteChatFallback: 'chat',
    attachedImageAlt: 'Image jointe',
    removeImage: 'Supprimer l’image',
    addAnotherImage: 'Ajouter une autre image',
    imageMessagePlaceholder: 'Ajoutez un message à propos de ces images...',
    textMessagePlaceholder: 'Posez une question sur une étape, collez un problème ou décrivez où vous êtes bloqué...',
    voice: 'Voix',
    attachImage: 'Joindre une image',
    equation: 'Équation',
    voiceInput: '(Entrée vocale)',
    tutorReady: 'est prêt à vous aider avec',
  },
  de: {
    yourTutors: 'Deine Tutoren',
    changeTutor: 'Tutor wechseln',
    closeChatHistory: 'Chatverlauf schließen',
    openChatHistory: 'Chatverlauf öffnen',
    topic: 'Thema',
    topicPlaceholder: 'Quadratische Gleichungen',
    newChat: 'Neuer Chat',
    openConversation: 'Unterhaltung öffnen',
    deleteChat: 'Chat löschen',
    deleteChatFallback: 'Chat',
    attachedImageAlt: 'Angehängtes Bild',
    removeImage: 'Bild entfernen',
    addAnotherImage: 'Weiteres Bild hinzufügen',
    imageMessagePlaceholder: 'Füge eine Nachricht zu diesen Bildern hinzu...',
    textMessagePlaceholder: 'Frage nach einem Schritt, füge eine Aufgabe ein oder beschreibe, wo du feststeckst...',
    voice: 'Sprache',
    attachImage: 'Bild anhängen',
    equation: 'Gleichung',
    voiceInput: '(Spracheingabe)',
    tutorReady: 'ist bereit, dir zu helfen mit',
  },
} as const;

const getUiCopy = (languageCode: string) =>
  UI_COPY[String(languageCode || 'en').trim().toLowerCase() as keyof typeof UI_COPY] || UI_COPY.en;

const TUTOR_VOICE_BY_LANGUAGE: Record<string, Record<TutorId, string>> = {
  en: { vaani: 'en-US-JennyNeural', saarthi: 'en-US-GuyNeural' },
  es: { vaani: 'es-ES-ElviraNeural', saarthi: 'es-ES-AlvaroNeural' },
  fr: { vaani: 'fr-FR-DeniseNeural', saarthi: 'fr-FR-HenriNeural' },
  de: { vaani: 'de-DE-KatjaNeural', saarthi: 'de-DE-ConradNeural' },
  hi: { vaani: 'hi-IN-SwaraNeural', saarthi: 'hi-IN-MadhurNeural' },
  ta: { vaani: 'ta-IN-PallaviNeural', saarthi: 'ta-IN-ValluvarNeural' },
  te: { vaani: 'te-IN-ShrutiNeural', saarthi: 'te-IN-MohanNeural' },
};

const getTutorVoiceName = (languageCode: string, tutorId: TutorId) =>
  TUTOR_VOICE_BY_LANGUAGE[String(languageCode || '').trim().toLowerCase()]?.[tutorId] ||
  TUTOR_VOICE_BY_LANGUAGE.en[tutorId];

const readThreadTutorMap = () => {
  if (typeof window === 'undefined') return {} as Record<string, TutorId>;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(THREAD_TUTOR_MAP_KEY) || '{}');
    if (!parsed || typeof parsed !== 'object') return {} as Record<string, TutorId>;
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, TutorId] => entry[1] === 'vaani' || entry[1] === 'saarthi'),
    );
  } catch {
    return {} as Record<string, TutorId>;
  }
};

const writeThreadTutorMap = (map: Record<string, TutorId>) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(THREAD_TUTOR_MAP_KEY, JSON.stringify(map));
};

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
  tutorId?: TutorId;
  images?: { previewUrl: string }[];
}

interface ChatThread {
  id: string;
  title: string;
  preview: string;
  createdAt: number;
  updatedAt: number;
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
    .replace(
      /\((Based on your notes|आपके नोट्स के आधार पर|మీ నోట్స్ ఆధారంగా|உங்கள் குறிப்புகளின் அடிப்படையில்|Basado en tus notas|Basé sur vos notes|Basierend auf deinen Notizen)\)/gi,
      '',
    )
    .replace(/\s+/g, ' ')
    .trim();

const LOCAL_TUTOR_SAFETY_REGEXES = [
  /\b(can|could|should|how)\b[^.?!\n]{0,80}\b(cook|burn|hurt|kill|injure|harm)\b[^.?!\n]{0,80}\b(human|person|body|people)\b/i,
  /\b(cook a human|human in a camp cooker|hurt a person|kill a person)\b/i,
  /\b(kill|murder|shoot|stab|bomb|attack|threaten)\b/i,
];

const shouldShowTutorSafetyReply = (value: string) =>
  LOCAL_TUTOR_SAFETY_REGEXES.some((regex) => regex.test(String(value || '').replace(/\s+/g, ' ').trim()));

const getTutorSafetyReply = (appLanguageCode: string) =>
  appLanguageCode === 'hi'
    ? 'यह अनुरोध पढ़ाई से संबंधित नहीं है और हानिकारक हो सकता है। कृपया ऐसा harmful या irrelevant content न भेजें और केवल study-related questions पूछें।'
    : appLanguageCode === 'te'
      ? 'ఈ అభ్యర్థన చదువుకు సంబంధించినది కాదు మరియు హానికరంగా ఉండవచ్చు. దయచేసి ఇలాంటి harmful లేదా irrelevant content పంపవద్దు. చదువుకు సంబంధించిన ప్రశ్నలు మాత్రమే పంపండి.'
      : appLanguageCode === 'ta'
        ? 'இந்த கோரிக்கை படிப்புடன் தொடர்புடையது அல்ல, மேலும் தீங்கானதாக இருக்கலாம். இப்படிப்பட்ட harmful அல்லது irrelevant content ஐ அனுப்ப வேண்டாம். படிப்புடன் தொடர்புடைய கேள்விகளை மட்டும் அனுப்புங்கள்.'
        : appLanguageCode === 'es'
          ? 'Esa solicitud no es apropiada para el estudio y puede ser dañina. No envíes contenido harmful o irrelevant; envía solo preguntas relacionadas con tus estudios.'
          : appLanguageCode === 'fr'
            ? 'Cette demande n’est pas appropriée pour l’étude et peut être dangereuse. N’envoie pas de contenu harmful ou irrelevant ; envoie seulement des questions liées aux études.'
            : appLanguageCode === 'de'
              ? 'Diese Anfrage ist für das Lernen nicht angemessen und kann schädlich sein. Bitte sende kein harmful oder irrelevant content, sondern nur lernbezogene Fragen.'
              : 'That request is not appropriate for study and may be harmful. Please do not send harmful or irrelevant content. Send only study-related questions.';

const formatChatTime = (createdAt?: number) => {
  const value = Number(createdAt);
  if (!Number.isFinite(value) || value <= 0) {
    return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const createInitialAssistantMessage = (tutorId: TutorId, languageCode = 'en'): ChatMessage => ({
  id: `assistant-initial-${tutorId}`,
  role: 'assistant',
  tutorId,
  text: getTutorCopy(languageCode, tutorId).openingMessage,
  time: formatChatTime(Date.now()),
});

export function SocraticTutorPage({
  initialContext,
}: {
  initialContext?: Partial<TutorContextState>;
}) {
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
  const [selectedTutorId, setSelectedTutorId] = useState<TutorId>('saarthi');
  const [threadTutorMap, setThreadTutorMap] = useState<Record<string, TutorId>>(() => readThreadTutorMap());
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
  const selectedTutor = tutorMetaById[selectedTutorId];
  const currentSettings = getUserSettings();
  const speechLanguageCode = getSpeechLanguageCode(currentSettings);
  const appLanguageCode = String(currentSettings.appLanguage || 'en').trim().toLowerCase();
  const selectedTutorCopy = getTutorCopy(appLanguageCode, selectedTutorId);
  const uiCopy = getUiCopy(appLanguageCode);

  const updateThreadTutor = useCallback((threadId: string, tutorId: TutorId) => {
    setThreadTutorMap((current) => {
      const next = { ...current, [threadId]: tutorId };
      writeThreadTutorMap(next);
      return next;
    });
  }, []);

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
            title: String(thread.title || uiCopy.newChat),
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
        setMessages((current) => (current.length > 0 ? current : [createInitialAssistantMessage('saarthi', appLanguageCode)]));
      })
      .catch(() => {
        if (!mounted) return;
        setMessages((current) => (current.length > 0 ? current : [createInitialAssistantMessage('saarthi', appLanguageCode)]));
      });

    return () => {
      mounted = false;
    };
  }, [appLanguageCode]);

  useEffect(() => {
    if (!activeThreadId) return;
    setSelectedTutorId(threadTutorMap[activeThreadId] || 'saarthi');
  }, [activeThreadId, threadTutorMap]);

  useEffect(() => {
    if (!activeThreadId) return;
    let mounted = true;
    const tutorId = threadTutorMap[activeThreadId] || selectedTutorId;
    getSocraticThreadMessages(activeThreadId, 200)
      .then((payload) => {
        if (!mounted) return;
        const loaded = Array.isArray(payload?.messages)
          ? payload.messages.map((msg) => ({
            id: msg.id,
            role: msg.role === 'assistant' ? 'assistant' : 'user',
            text: msg.role === 'assistant' ? formatAssistantReply(msg.text) : String(msg.text || ''),
            time: formatChatTime(msg.createdAt),
            tutorId:
              msg.role === 'assistant'
                ? msg.tutorId === 'vaani' || msg.tutorId === 'saarthi'
                  ? msg.tutorId
                  : tutorId
                : undefined,
          }))
          : [];
        setMessages(loaded.length > 0 ? loaded : [createInitialAssistantMessage(tutorId, appLanguageCode)]);
      })
      .catch(() => {
        if (!mounted) return;
        setMessages([createInitialAssistantMessage(tutorId, appLanguageCode)]);
      });

    return () => {
      mounted = false;
    };
  }, [activeThreadId, appLanguageCode, selectedTutorId, threadTutorMap]);

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
    setGlobalAudioSourceActive('socratic', false);
  }, []);

  const speakAssistantReply = useCallback(async (messageId: string, text: string) => {
    const utteranceText = formatSpeechText(text);
    if (!utteranceText) return;

    stopAssistantSpeech();
    const sessionId = speechSessionRef.current + 1;
    speechSessionRef.current = sessionId;
    playingAssistantMessageIdRef.current = messageId;
    setPlayingAssistantMessageId(messageId);
    setGlobalAudioSourceActive('socratic', true);
    let azureSpeakAttempted = false;

    try {
      const { token, region } = await getSpeechToken();
      if (speechSessionRef.current !== sessionId) return;
      const speechConfig = speechSdk.SpeechConfig.fromAuthorizationToken(token, region);
      speechConfig.speechSynthesisLanguage = speechLanguageCode;
      speechConfig.speechSynthesisVoiceName = getTutorVoiceName(appLanguageCode, selectedTutorId);
      const player = new speechSdk.SpeakerAudioDestination();
      player.onAudioEnd = () => {
        if (speechPlayerRef.current === player) {
          speechPlayerRef.current = null;
        }
        if (speechSessionRef.current === sessionId) {
          playingAssistantMessageIdRef.current = null;
          setPlayingAssistantMessageId(null);
          setGlobalAudioSourceActive('socratic', false);
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
        setGlobalAudioSourceActive('socratic', false);
        return;
      }
      console.warn('Azure TTS unavailable, falling back to browser speech.', error);
    }

    if (speechSessionRef.current !== sessionId) return;
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      playingAssistantMessageIdRef.current = null;
      setPlayingAssistantMessageId(null);
      setGlobalAudioSourceActive('socratic', false);
      return;
    }

    const utterance = new SpeechSynthesisUtterance(utteranceText);
    utterance.lang = speechLanguageCode;
    utterance.onend = () => {
      if (speechSessionRef.current === sessionId) {
        playingAssistantMessageIdRef.current = null;
        setPlayingAssistantMessageId(null);
        setGlobalAudioSourceActive('socratic', false);
      }
    };
    utterance.onerror = () => {
      if (speechSessionRef.current === sessionId) {
        playingAssistantMessageIdRef.current = null;
        setPlayingAssistantMessageId(null);
        setGlobalAudioSourceActive('socratic', false);
      }
    };
    window.speechSynthesis.speak(utterance);
  }, [appLanguageCode, selectedTutorId, speechLanguageCode, stopAssistantSpeech]);

  useEffect(() => registerGlobalAudioStopHandler(stopAssistantSpeech), [stopAssistantSpeech]);

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
        text: trimmed || (hasImages ? '' : uiCopy.voiceInput),
        time,
        images: currentImages.map(img => ({ previewUrl: img.previewUrl })),
      },
    ]);
    
    setIsLoading(true);

    try {
      let threadId = activeThreadId;
      if (!threadId) {
        const titleSeed = trimmed || uiCopy.newChat;
        const createdThread = await createSocraticThread(titleSeed.slice(0, 120));
        threadId = createdThread.id;
        updateThreadTutor(createdThread.id, selectedTutorId);
        setThreads((current) => [createdThread, ...current.filter((item) => item.id !== createdThread.id)]);
        setActiveThreadId(createdThread.id);
      }

      const history = messages.map(m => ({ role: m.role, text: m.text }));
      const selectedClassLevel = getUserSettings().classLevel;
      const response = await sendSocraticChat(trimmed, history, {
        threadId,
        classLevel: selectedClassLevel || undefined,
        tutorMode: selectedTutorId,
        audioBase64,
        images: imagePayloads.length > 0 ? imagePayloads : undefined,
        context: {
          topic: nextContext.topic,
          tutorId: selectedTutorId,
        }
      });

      setMessages((current) => [
        ...current,
        {
          id: `assistant-${Date.now() + 1}`,
          role: 'assistant',
          tutorId: selectedTutorId,
          text:
            formatAssistantReply(response.reply) +
            (response.usedNotes
              ? appLanguageCode === 'hi'
                ? '\n\n(आपके नोट्स के आधार पर)'
                : appLanguageCode === 'te'
                  ? '\n\n(మీ నోట్స్ ఆధారంగా)'
                  : appLanguageCode === 'ta'
                    ? '\n\n(உங்கள் குறிப்புகளின் அடிப்படையில்)'
                    : appLanguageCode === 'es'
                      ? '\n\n(Basado en tus notas)'
                      : appLanguageCode === 'fr'
                        ? '\n\n(Basé sur vos notes)'
                        : appLanguageCode === 'de'
                          ? '\n\n(Basierend auf deinen Notizen)'
                          : '\n\n(Based on your notes)'
              : ''),
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
      if (threadId) {
        const nextTitle = trimmed ? trimmed.slice(0, 120) : uiCopy.newChat;
        const nextPreview = formatAssistantReply(response.reply).split('\n')[0] || trimmed || uiCopy.newChat;
        setThreads((current) => {
          const existing = current.find((item) => item.id === threadId);
          const updatedThread: ChatThread = {
            id: threadId,
            title: existing && existing.title !== uiCopy.newChat ? existing.title : nextTitle,
            preview: nextPreview,
            createdAt: existing?.createdAt || Date.now(),
            updatedAt: Date.now(),
          };
          return [updatedThread, ...current.filter((item) => item.id !== threadId)];
        });
      }
    } catch (err) {
      const fallbackText = shouldShowTutorSafetyReply(trimmed)
        ? getTutorSafetyReply(appLanguageCode)
        : 'Oops, something went wrong. Let me think about that again.';
      setMessages((current) => [
        ...current,
        {
          id: `assistant-${Date.now() + 1}`,
          role: 'assistant',
          text: fallbackText,
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  }, [activeThreadId, appLanguageCode, attachedImages, context, draft, isLoading, messages, notebookOptions, selectedTutorId, uiCopy.newChat, uiCopy.voiceInput, updateThreadTutor]);

  const handleNewChat = useCallback(async () => {
    setDraft('');
    setAttachedImages([]);
    stopAssistantSpeech();
    const thread = await createSocraticThread(uiCopy.newChat);
    updateThreadTutor(thread.id, selectedTutorId);
    setThreads((current) => [thread, ...current.filter((item) => item.id !== thread.id)]);
    setActiveThreadId(thread.id);
    setMessages([createInitialAssistantMessage(selectedTutorId, appLanguageCode)]);
  }, [appLanguageCode, selectedTutorId, stopAssistantSpeech, uiCopy.newChat, updateThreadTutor]);

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
      setThreadTutorMap((current) => {
        const next = { ...current };
        delete next[threadId];
        writeThreadTutorMap(next);
        return next;
      });
      if (activeThreadId === threadId) {
        setActiveThreadId(fallbackThreadId);
        if (!fallbackThreadId) {
          setMessages([createInitialAssistantMessage(selectedTutorId, appLanguageCode)]);
        }
      }
    } catch {
      // Keep UI unchanged when delete fails.
    }
  }, [activeThreadId, appLanguageCode, selectedTutorId, threads]);

  const confirmAndDeleteThread = useCallback((threadId: string) => {
    const threadTitle = threads.find((item) => item.id === threadId)?.title || uiCopy.deleteChatFallback;
    if (typeof window !== 'undefined') {
      const shouldDelete = window.confirm(`${uiCopy.deleteChat}: ${threadTitle}?`);
      if (!shouldDelete) return;
    }
    void handleDeleteThread(threadId);
  }, [handleDeleteThread, threads, uiCopy.deleteChat, uiCopy.deleteChatFallback]);

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
      speechConfig.speechRecognitionLanguage = speechLanguageCode;
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
              aria-label={isHistoryOpen ? uiCopy.closeChatHistory : uiCopy.openChatHistory}
            >
              <PanelLeft size={16} />
            </button>
            <div>
              <h1 className="page-hero-title">{uiCopy.yourTutors}</h1>
              <p className="page-hero-subtitle">{selectedTutor.name} {uiCopy.tutorReady} {selectedTutorCopy.title.toLowerCase()}.</p>
            </div>
          </div>
        </div>
        <button
          type="button"
          className={`socratic-panel-toggle ${panelOpen ? 'open' : ''}`}
          onClick={() => setPanelOpen((v) => !v)}
        >
          <span>{uiCopy.changeTutor}</span>
          <ChevronUp size={13} className="socratic-chevron" />
        </button>
      </header>

      {/* Collapsible context + options panel */}
      <div className={`socratic-context-panel ${panelOpen ? 'open' : ''}`}>
        <div className="socratic-context-grid">
          <div className="socratic-ctx-box socratic-tutor-box">
            <span className="socratic-ctx-label">{uiCopy.yourTutors}</span>
            <div className="socratic-tutor-grid">
              {TUTOR_OPTIONS.map((tutor) => (
                <button
                  key={tutor.id}
                  type="button"
                  className={`socratic-tutor-card ${selectedTutorId === tutor.id ? 'active' : ''}`}
              onClick={() => {
                setSelectedTutorId(tutor.id);
                if (activeThreadId) {
                  updateThreadTutor(activeThreadId, tutor.id);
                } else {
                  setMessages([createInitialAssistantMessage(tutor.id, appLanguageCode)]);
                }
              }}
                >
                  <span className={`socratic-tutor-avatar socratic-tutor-avatar-${tutor.id}`} aria-hidden="true">
                    {tutor.avatar}
                  </span>
                  <span className="socratic-tutor-copy">
                    <strong>{tutor.name}</strong>
                    <span>{getTutorCopy(appLanguageCode, tutor.id).title}</span>
                    <small>{getTutorCopy(appLanguageCode, tutor.id).description}</small>
                  </span>
                </button>
              ))}
            </div>
          </div>
          <div className="socratic-ctx-box">
            <span className="socratic-ctx-label">{uiCopy.topic}</span>
            <input
              type="text"
              value={context.topic}
              list="socratic-topic-list"
              onChange={(e) => setContext((c) => ({ ...c, topic: e.target.value }))}
              placeholder={uiCopy.topicPlaceholder}
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
            aria-label={uiCopy.closeChatHistory}
          />
        )}

        <aside className={`socratic-history-rail ${isHistoryOpen ? 'open' : ''}`}>
          <button type="button" className="socratic-new-chat-btn" onClick={() => void handleNewChat()}>
            <MessageSquarePlus size={15} />
            <span>{uiCopy.newChat}</span>
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
                  <strong>{thread.title || uiCopy.newChat}</strong>
                  <span>{thread.preview || uiCopy.openConversation}</span>
                </button>
                <button
                  type="button"
                  className="socratic-history-delete-btn"
                  aria-label={`${uiCopy.deleteChat} ${thread.title || uiCopy.deleteChatFallback}`}
                  title={uiCopy.deleteChat}
                  onClick={(event) => {
                    event.stopPropagation();
                    confirmAndDeleteThread(thread.id);
                  }}
                >
                 <svg
                    className="socratic-history-delete-icon"
                    viewBox="0 0 24 24"
                    width="15"
                    height="15"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                    focusable="false"
                  >
                    <path d="M3 6h18" />
                    <path d="M8 6V4h8v2" />
                    <path d="M6 6l1 14h10l1-14" />
                    <path d="M10 10v7" />
                    <path d="M14 10v7" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        </aside>

        <div className="socratic-chat-col">
          <div className="socratic-chat-scroll">
            <SocraticChat
              messages={messages}
              tutorMode={selectedTutorId}
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
                      <img src={img.previewUrl} alt={uiCopy.attachedImageAlt} />
                      <button
                        type="button"
                        className="socratic-image-remove"
                        onClick={() => removeAttachedImage(img.id)}
                        title={uiCopy.removeImage}
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
                      title={uiCopy.addAnotherImage}
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
                  placeholder={attachedImages.length > 0 ? uiCopy.imageMessagePlaceholder : uiCopy.textMessagePlaceholder}
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
                    title={uiCopy.voice}
                  >
                    <Mic size={15} />
                  </button>
                  <button
                    type="button"
                    className={`socratic-mode-icon ${attachedImages.length > 0 ? 'active' : ''}`}
                    onClick={() => toggleMode('image')}
                    title={uiCopy.attachImage}
                  >
                    <ImageIcon size={15} />
                  </button>
                  <button
                    type="button"
                    className={`socratic-mode-icon ${activeMode === 'equation' ? 'active' : ''}`}
                    onClick={() => toggleMode('equation')}
                    title={uiCopy.equation}
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
