import type { UserSettings } from "./storage";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "/api";
const normalizeFlag = (value: unknown) => String(value || "").trim().toLowerCase();
const TRANSLATABLE_ATTRIBUTES = ["placeholder", "title", "aria-label"] as const;
const TEXT_BATCH_SIZE = 25;

interface LanguageOption {
  code: string;
  label: string;
  azureCode: string;
  speechCode: string;
}

export const LANGUAGE_OPTIONS: LanguageOption[] = [
  { code: "en", label: "English", azureCode: "en", speechCode: "en-US" },
  { code: "es", label: "Spanish", azureCode: "es", speechCode: "es-ES" },
  { code: "fr", label: "French", azureCode: "fr", speechCode: "fr-FR" },
  { code: "de", label: "German", azureCode: "de", speechCode: "de-DE" },
  { code: "hi", label: "Hindi", azureCode: "hi", speechCode: "hi-IN" },
  { code: "te", label: "Telugu", azureCode: "te", speechCode: "te-IN" },
  { code: "ta", label: "Tamil", azureCode: "ta", speechCode: "ta-IN" },
];

const languageByCode = new Map(LANGUAGE_OPTIONS.map((language) => [language.code, language]));
const textOriginals = new WeakMap<Text, string>();
const attributeOriginals = new WeakMap<Element, Map<string, string>>();
const translationCache = new Map<string, Map<string, string>>();

let latestRunId = 0;
let currentObservedLanguage = "en";
let mutationObserver: MutationObserver | null = null;
let translationFlushTimer = 0;
let isApplyingObservedTranslation = false;
const pendingRoots = new Set<ParentNode>();

const canUseDevBypass = () => {
  const bypassFlag = normalizeFlag(import.meta.env.VITE_DEV_AUTH_BYPASS);
  return bypassFlag === "true" || bypassFlag === "1" || bypassFlag === "yes";
};

const buildDevHeaders = () => {
  if (!canUseDevBypass()) return {};

  return {
    "x-stepwise-user-id": String(import.meta.env.VITE_DEV_USER_ID || "local-dev-user"),
    "x-stepwise-user-name": String(import.meta.env.VITE_DEV_USER_NAME || "Local Developer"),
    "x-stepwise-user-email": String(
      import.meta.env.VITE_DEV_USER_EMAIL || "local-dev@stepwise.local",
    ),
    "x-stepwise-user-provider": "local-dev",
  };
};

const getLanguageOption = (languageCode: string) =>
  languageByCode.get(String(languageCode || "").trim().toLowerCase()) || LANGUAGE_OPTIONS[0];

const getCacheForLanguage = (languageCode: string) => {
  const normalized = getLanguageOption(languageCode).code;
  let cache = translationCache.get(normalized);
  if (!cache) {
    cache = new Map<string, string>();
    translationCache.set(normalized, cache);
  }
  return cache;
};

const shouldSkipElement = (element: Element | null) => {
  if (!element) return true;
  if (element instanceof HTMLElement) {
    if (element.dataset.noTranslate === "true") return true;
    if (element.closest('[data-no-translate="true"]')) return true;
  }
  const tagName = element.tagName;
  return ["SCRIPT", "STYLE", "NOSCRIPT", "IFRAME"].includes(tagName);
};

const normalizeText = (value: string) => value.replace(/\s+/g, " ").trim();

const collectTextNodes = (root: ParentNode) => {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      const text = String(node.textContent || "");
      if (!normalizeText(text)) return NodeFilter.FILTER_REJECT;
      const parentElement = node.parentElement;
      if (shouldSkipElement(parentElement)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  let current = walker.nextNode();
  while (current) {
    nodes.push(current as Text);
    current = walker.nextNode();
  }

  return nodes;
};

const collectAttributeTargets = (root: ParentNode) => {
  const targets: Array<{ element: Element; attribute: (typeof TRANSLATABLE_ATTRIBUTES)[number] }> = [];
  const elements =
    root instanceof Element || root instanceof Document
      ? [root, ...Array.from(root.querySelectorAll("*"))]
      : [];

  for (const element of elements) {
    if (!(element instanceof Element) || shouldSkipElement(element)) continue;

    TRANSLATABLE_ATTRIBUTES.forEach((attribute) => {
      const value = element.getAttribute(attribute);
      if (!value || !normalizeText(value)) return;
      targets.push({ element, attribute });
    });
  }

  return targets;
};

const rememberAttributeOriginal = (element: Element, attribute: string, value: string) => {
  let originals = attributeOriginals.get(element);
  if (!originals) {
    originals = new Map<string, string>();
    attributeOriginals.set(element, originals);
  }
  if (!originals.has(attribute)) {
    originals.set(attribute, value);
  }
};

const disconnectTranslationObserver = () => {
  if (mutationObserver) {
    mutationObserver.disconnect();
    mutationObserver = null;
  }
  if (translationFlushTimer) {
    window.clearTimeout(translationFlushTimer);
    translationFlushTimer = 0;
  }
  pendingRoots.clear();
};

const restoreOriginalLanguage = () => {
  const textNodes = collectTextNodes(document.body);
  textNodes.forEach((node) => {
    const original = textOriginals.get(node);
    if (typeof original === "string" && node.textContent !== original) {
      node.textContent = original;
    }
  });

  const elements = Array.from(document.body.querySelectorAll("*"));
  elements.forEach((element) => {
    const originals = attributeOriginals.get(element);
    if (!originals) return;
    originals.forEach((value, attribute) => {
      if (element.getAttribute(attribute) !== value) {
        element.setAttribute(attribute, value);
      }
    });
  });
};

const translateTexts = async (texts: string[], languageCode: string) => {
  const language = getLanguageOption(languageCode);
  if (language.code === "en" || texts.length === 0) {
    return texts;
  }

  const cache = getCacheForLanguage(language.code);
  const uniqueTexts = Array.from(new Set(texts.filter((text) => normalizeText(text))));
  const missingTexts = uniqueTexts.filter((text) => !cache.has(text));

  for (let index = 0; index < missingTexts.length; index += TEXT_BATCH_SIZE) {
    const batch = missingTexts.slice(index, index + TEXT_BATCH_SIZE);
    const response = await fetch(`${API_BASE}/accessibility/translate`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...buildDevHeaders(),
      },
      body: JSON.stringify({
        targetLanguage: language.azureCode,
        texts: batch,
      }),
    });

    if (!response.ok) {
      throw new Error("Unable to translate the app right now.");
    }

    const payload = (await response.json()) as { translations?: string[] };
    const translations = Array.isArray(payload.translations) ? payload.translations : [];

    batch.forEach((text, batchIndex) => {
      cache.set(text, String(translations[batchIndex] || text));
    });
  }

  return texts.map((text) => cache.get(text) || text);
};

const applyTranslationToRoot = async (root: ParentNode, languageCode: string, runId: number) => {
  if (!document.body || runId !== latestRunId) return;
  const language = getLanguageOption(languageCode);

  const textNodes = collectTextNodes(root);
  const originalTextEntries = textNodes.map((node) => {
    const original = textOriginals.get(node) ?? String(node.textContent || "");
    if (!textOriginals.has(node)) {
      textOriginals.set(node, original);
    }
    return { node, original };
  });

  const attributeEntries = collectAttributeTargets(root).map(({ element, attribute }) => {
    const currentValue = String(element.getAttribute(attribute) || "");
    rememberAttributeOriginal(element, attribute, currentValue);
    const original = attributeOriginals.get(element)?.get(attribute) || currentValue;
    return { element, attribute, original };
  });

  const textsToTranslate = [
    ...originalTextEntries.map((entry) => entry.original),
    ...attributeEntries.map((entry) => entry.original),
  ];

  const translated = await translateTexts(textsToTranslate, language.code);
  if (runId !== latestRunId) return;

  isApplyingObservedTranslation = true;
  try {
    originalTextEntries.forEach((entry, index) => {
      if (!entry.node.isConnected) return;
      entry.node.textContent = translated[index] || entry.original;
    });

    const offset = originalTextEntries.length;
    attributeEntries.forEach((entry, index) => {
      if (!entry.element.isConnected) return;
      entry.element.setAttribute(entry.attribute, translated[offset + index] || entry.original);
    });
  } finally {
    isApplyingObservedTranslation = false;
  }
};

const scheduleObservedTranslation = () => {
  if (translationFlushTimer || currentObservedLanguage === "en") return;

  translationFlushTimer = window.setTimeout(() => {
    translationFlushTimer = 0;
    const roots = Array.from(pendingRoots);
    pendingRoots.clear();
    const runId = latestRunId;

    void Promise.all(
      roots.map((root) =>
        applyTranslationToRoot(root, currentObservedLanguage, runId).catch((error) => {
          console.error("Failed to translate updated app content:", error);
        }),
      ),
    );
  }, 80);
};

const connectTranslationObserver = () => {
  if (typeof document === "undefined" || !document.body || mutationObserver) return;

  mutationObserver = new MutationObserver((mutations) => {
    if (isApplyingObservedTranslation || currentObservedLanguage === "en") {
      return;
    }

    mutations.forEach((mutation) => {
      if (mutation.type === "childList") {
        mutation.addedNodes.forEach((node) => {
          if (node instanceof Text && node.parentElement) {
            pendingRoots.add(node.parentElement);
          } else if (node instanceof Element && !shouldSkipElement(node)) {
            pendingRoots.add(node);
          }
        });
        return;
      }

      if (mutation.type === "characterData" && mutation.target.parentElement) {
        pendingRoots.add(mutation.target.parentElement);
        return;
      }

      if (mutation.type === "attributes" && mutation.target instanceof Element) {
        pendingRoots.add(mutation.target);
      }
    });

    if (pendingRoots.size > 0) {
      scheduleObservedTranslation();
    }
  });

  mutationObserver.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: [...TRANSLATABLE_ATTRIBUTES],
  });
};

export const getSpeechLanguageCode = (settings: Pick<UserSettings, "appLanguage">) =>
  getLanguageOption(settings.appLanguage).speechCode;

export const getLanguageLabel = (languageCode: string) => getLanguageOption(languageCode).label;

export const translateAppText = async (text: string, languageCode: string) => {
  const normalizedText = String(text || "").trim();
  const language = getLanguageOption(languageCode);
  if (!normalizedText || language.code === "en") {
    return normalizedText;
  }

  const [translated] = await translateTexts([normalizedText], language.code);
  return String(translated || normalizedText).trim();
};

export const syncAppLanguage = async (settings: Pick<UserSettings, "appLanguage">) => {
  if (typeof document === "undefined") return;

  const nextLanguage = getLanguageOption(settings.appLanguage).code;
  latestRunId += 1;
  const runId = latestRunId;
  currentObservedLanguage = nextLanguage;

  document.documentElement.lang = nextLanguage;

  if (nextLanguage === "en") {
    disconnectTranslationObserver();
    restoreOriginalLanguage();
    return;
  }

  connectTranslationObserver();
  await applyTranslationToRoot(document.body, nextLanguage, runId);
  if (runId !== latestRunId) return;
};
