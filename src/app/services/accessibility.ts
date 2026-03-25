import type { UserSettings } from "./storage";

let activeUtterance: SpeechSynthesisUtterance | null = null;
let playbackSessionId = 0;
let isAccessibilitySpeechActive = false;
let speechCancelSweepTimer: number | null = null;
const speechStateListeners = new Set<(active: boolean) => void>();

const DEFAULT_FONT_STACK =
  '"Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const DYSLEXIA_FONT_STACK =
  '"OpenDyslexic", "Atkinson Hyperlegible", "Segoe UI", Arial, sans-serif';

const mapFontScale = (value: number) => 0.92 + (value / 100) * 0.24;
const mapSpeechRate = (value: number) => 0.7 + (value / 100) * 0.9;
const mapUiScale = (enabled: boolean) => (enabled ? 1.08 : 1);
const mapTextZoom = (value: number) => 0.94 + (value / 100) * 0.32;

const emitSpeechState = (active: boolean) => {
  isAccessibilitySpeechActive = active;
  speechStateListeners.forEach((listener) => {
    try {
      listener(active);
    } catch {
      // Ignore listener errors so audio state updates still propagate.
    }
  });
};

export const applyAccessibilitySettings = (settings: UserSettings) => {
  const root = document.documentElement;
  const body = document.body;

  root.dataset.colorTheme = settings.colorTheme;
  body.classList.toggle("accessibility-high-contrast", settings.highContrastMode);
  body.classList.toggle("accessibility-large-ui", settings.largeUiMode);
  body.classList.toggle("accessibility-dyslexia-font", settings.dyslexiaFriendlyFont);
  body.classList.toggle("accessibility-reduced-motion", settings.reduceMotion);
  body.classList.toggle("accessibility-focus-highlight", settings.focusHighlight);
  body.style.setProperty("--app-font-scale", mapFontScale(settings.fontScale).toFixed(2));
  body.style.setProperty("--app-ui-scale", mapUiScale(settings.largeUiMode).toFixed(2));
  body.style.setProperty("--app-text-zoom", mapTextZoom(settings.fontScale).toFixed(2));
  body.style.setProperty(
    "--app-font-family",
    settings.dyslexiaFriendlyFont ? DYSLEXIA_FONT_STACK : DEFAULT_FONT_STACK,
  );
};

export const playAccessibilityCue = (tone: "confirm" | "reset" = "confirm") => {
  if (typeof window === "undefined") return;

  const AudioContextCtor = window.AudioContext || (window as typeof window & {
    webkitAudioContext?: typeof AudioContext;
  }).webkitAudioContext;

  if (!AudioContextCtor) return;

  try {
    const audioContext = new AudioContextCtor();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();

    oscillator.type = "sine";
    oscillator.frequency.value = tone === "reset" ? 360 : 660;
    gain.gain.setValueAtTime(0.0001, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.08, audioContext.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.2);

    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start();
    oscillator.stop(audioContext.currentTime + 0.22);

    oscillator.onended = () => {
      void audioContext.close().catch(() => {});
    };
  } catch {
    // Ignore audio cue failures on unsupported browsers.
  }
};

export const subscribeAccessibilitySpeechState = (listener: (active: boolean) => void) => {
  speechStateListeners.add(listener);
  listener(isAccessibilitySpeechActive);
  return () => {
    speechStateListeners.delete(listener);
  };
};

export const stopAccessibilitySpeech = () => {
  playbackSessionId += 1;
  clearSpeechCancelSweep();

  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
    scheduleSpeechCancelSweep(playbackSessionId);
  }

  activeUtterance = null;

  emitSpeechState(false);
};

export const extractPageSpeechText = () => {
  const container =
    document.querySelector("main") ||
    document.querySelector(".app-main") ||
    document.body;

  const text = (container?.textContent || "")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) return "";
  return text.slice(0, 2200);
};

export const speakWithAzure = async (text: string, settings: UserSettings) => {
  const content = text.replace(/\s+/g, " ").trim();
  if (!content) return;

  stopAccessibilitySpeech();
  const sessionId = playbackSessionId;
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    emitSpeechState(false);
    return;
  }

  await speakWithBrowserSpeech(content, settings, sessionId);
};

async function speakWithBrowserSpeech(text: string, settings: UserSettings, sessionId: number) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;

  await waitForSpeechQueueToClear(sessionId);
  if (sessionId !== playbackSessionId) return;

  const utterance = new SpeechSynthesisUtterance(text);
  activeUtterance = utterance;
  emitSpeechState(true);
  utterance.rate = mapSpeechRate(settings.speechRate);
  utterance.lang = "en-US";
  utterance.onend = () => {
    if (sessionId !== playbackSessionId) return;
    if (activeUtterance === utterance) {
      activeUtterance = null;
    }
    emitSpeechState(false);
  };
  utterance.onerror = () => {
    if (sessionId !== playbackSessionId) return;
    if (activeUtterance === utterance) {
      activeUtterance = null;
    }
    emitSpeechState(false);
  };
  window.speechSynthesis.speak(utterance);
}

function clearSpeechCancelSweep() {
  if (speechCancelSweepTimer !== null && typeof window !== "undefined") {
    window.clearTimeout(speechCancelSweepTimer);
  }
  speechCancelSweepTimer = null;
}

function scheduleSpeechCancelSweep(sessionId: number, attemptsLeft = 6) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  if (sessionId !== playbackSessionId || attemptsLeft <= 0) {
    clearSpeechCancelSweep();
    return;
  }

  speechCancelSweepTimer = window.setTimeout(() => {
    if (sessionId !== playbackSessionId) {
      clearSpeechCancelSweep();
      return;
    }

    window.speechSynthesis.cancel();
    scheduleSpeechCancelSweep(sessionId, attemptsLeft - 1);
  }, 80);
}

async function waitForSpeechQueueToClear(sessionId: number) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;

  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (sessionId !== playbackSessionId) return;
    if (!window.speechSynthesis.speaking && !window.speechSynthesis.pending) return;
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, 30);
    });
  }
}
