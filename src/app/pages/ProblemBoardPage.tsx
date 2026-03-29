import katex from "katex";
import "katex/dist/katex.min.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Play, Square } from "lucide-react";
import { Excalidraw, MainMenu, exportToCanvas } from "@excalidraw/excalidraw";
import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "@excalidraw/excalidraw/index.css";
import { analyzeDrawing, isDebugImagesEnabled, simplifyQuestion } from "../services/ai";
import { QuestionSimplifier } from "../components/QuestionSimplifier";
import {
  speakWithAzure,
  stopAccessibilitySpeech,
  subscribeAccessibilitySpeechState,
} from "../services/accessibility";
import {
  downloadAssignmentCaptureImageBlob,
  getAssignmentById,
  getAssignmentCaptureImage,
  getProblemContext,
  getProblemImage,
  getProblemScene,
  saveProblemContext,
  saveProblemImage,
  saveProblemScene,
  downloadProblemImageBlob,
  downloadAssignmentPdfBlob,
  deleteProblemImage,
  getUserSettings,
} from "../services/storage";
import { translateAppText } from "../services/translation";

GlobalWorkerOptions.workerSrc = pdfWorker;

const MIN_PROBLEM_COUNT = 1;
const MAX_PROBLEM_COUNT = 60;
const WHITEBOARD_EXPORT_SCALE = 4;
const WHITEBOARD_MIN_DIMENSION = 1400;
const PDF_RENDER_SCALE = 2.5;
const PDF_MAX_WIDTH = 2400;
const PROBLEM_CROP_SCALE = 2;
const MAX_HINT_ITEMS = 3;
const MAX_ERROR_ITEMS = 3;
const MAX_SELECTION_INSIGHT_ITEMS = 1;
const SIDEBAR_COLLAPSED_BREAKPOINT = Number.MAX_SAFE_INTEGER;
const WHITEBOARD_AUTOSAVE_DELAY_MS = 2000;

type WhiteboardExcalidrawApi = {
  refresh: () => void;
  updateScene?: (sceneData: {
    appState?: {
      openMenu?: "canvas" | "shape" | null;
      openPopup?: "canvasBackground" | "elementBackground" | "elementStroke" | "fontFamily" | null;
    };
  }) => void;
  getAppState?: () => {
    openMenu?: "canvas" | "shape" | null;
    openSidebar?: { name: string } | null;
  };
};

const getDefaultScene = () => ({
  elements: [],
  appState: {
    viewBackgroundColor: "#f8fafc",
    defaultSidebarDockedPreference: false,
  },
  files: {},
});

const WRONG_STEP_MATCHER =
  /\b(wrong|incorrect|mistake|error|invalid|not correct|don't|do not|avoid)\b/i;
const ERROR_LIKE_FEEDBACK_MATCHER =
  /\b(error|incorrect|wrong|mistake|mistaken|substitut(?:e|ed|ing)\s+.*incorrect|recheck|recalculate|fix|correction)\b/i;

const pickProblemBucket = (value: any, problemIndex: number) => {
  if (!value) return null;
  if (Array.isArray(value)) return value[problemIndex - 1] ?? null;
  if (typeof value === "object") {
    return value[problemIndex] ?? value[String(problemIndex)] ?? null;
  }
  return null;
};

const extractInsightEntries = (value: any, forcedKind: string | null = null): any[] => {
  if (!value) return [];

  if (typeof value === "string") {
    return [{ content: value, kind: forcedKind }];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry) => extractInsightEntries(entry, forcedKind));
  }

  if (typeof value === "object") {
    const hints = value.hints || value.hint || [];
    const wrong =
      value.wrongSteps || value.wrongStep || value.wrong || value.errors || value.mistakes || [];

    if (hints.length || wrong.length) {
      return [
        ...extractInsightEntries(hints, "hint"),
        ...extractInsightEntries(wrong, "wrong"),
      ];
    }

    const textValue =
      value.content ||
      value.text ||
      value.message ||
      value.value ||
      value.description ||
      "";

    if (textValue) {
      return [
        {
          content: String(textValue),
          title: value.title || value.label || "",
          kind: value.kind || value.type || value.category || forcedKind,
        },
      ];
    }
  }

  return [];
};

const classifyInsightKind = (entry: any) => {
  const declaredKind = String(entry.kind || "").toLowerCase();
  if (declaredKind.includes("hint")) return "hint";
  if (
    declaredKind.includes("wrong") ||
    declaredKind.includes("error") ||
    declaredKind.includes("mistake")
  ) {
    return "wrong";
  }
  return WRONG_STEP_MATCHER.test(entry.content) ? "wrong" : "hint";
};

const isErrorLikeFeedback = (entry: any) =>
  ERROR_LIKE_FEEDBACK_MATCHER.test(String(entry?.content || "").trim());

const parseInsightsForProblem = (assignment: any, problemIndex: number) => {
  const candidates = [
    pickProblemBucket(assignment?.insightsByProblem, problemIndex),
    pickProblemBucket(assignment?.feedbackByProblem, problemIndex),
    pickProblemBucket(assignment?.hintsByProblem, problemIndex),
    pickProblemBucket(assignment?.wrongStepsByProblem, problemIndex),
    pickProblemBucket(assignment?.aiFeedbackByProblem, problemIndex),
    assignment?.insights,
    assignment?.feedback,
  ];

  const parsed = candidates
    .flatMap((candidate) => extractInsightEntries(candidate))
    .map((entry) => ({
      content: String(entry.content || "").trim(),
      kind: classifyInsightKind(entry),
      title: String(entry.title || "").trim(),
    }))
    .filter((entry) => entry.content.length > 0);

  return parsed.map((entry, index) => ({ id: `insight-${index}`, ...entry }));
};

const escapeHtml = (value: string) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const LATEX_SEGMENT_PATTERN =
  /(\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\$[^$\n]+?\$)/g;

const renderMathSegment = (segment: string) => {
  let expression = segment;
  let displayMode = false;

  if (segment.startsWith("$$") && segment.endsWith("$$")) {
    expression = segment.slice(2, -2);
    displayMode = true;
  } else if (segment.startsWith("\\[") && segment.endsWith("\\]")) {
    expression = segment.slice(2, -2);
    displayMode = true;
  } else if (segment.startsWith("\\(") && segment.endsWith("\\)")) {
    expression = segment.slice(2, -2);
  } else if (segment.startsWith("$") && segment.endsWith("$")) {
    expression = segment.slice(1, -1);
  }

  try {
    return katex.renderToString(expression.trim(), {
      displayMode,
      throwOnError: false,
      strict: "ignore",
    });
  } catch {
    return escapeHtml(segment);
  }
};

const renderLatexTextToHtml = (value: string) => {
  const source = String(value || "");
  let html = "";
  let cursor = 0;

  for (const match of source.matchAll(LATEX_SEGMENT_PATTERN)) {
    const [segment] = match;
    const index = match.index ?? 0;

    if (index > cursor) {
      html += escapeHtml(source.slice(cursor, index)).replace(/\n/g, "<br/>");
    }

    html += renderMathSegment(segment);
    cursor = index + segment.length;
  }

  if (cursor < source.length) {
    html += escapeHtml(source.slice(cursor)).replace(/\n/g, "<br/>");
  }

  return html;
};

const LatexText = ({ text, as: Element = "span", className = "" }: { text: string; as?: any; className?: string }) => (
  <Element
    className={className}
    dangerouslySetInnerHTML={{
      __html: renderLatexTextToHtml(text),
    }}
  />
);

const deriveInsightsFromAiResult = (result: any, requestedMode: string) => {
  const entries: any[] = [];

  const toEntries = (items: any, kind: string) =>
    Array.isArray(items)
      ? items
          .map((item) => String(item || "").trim())
          .filter(Boolean)
          .map((content) => ({ kind, content }))
      : [];

  entries.push(...toEntries(result?.hints, "hint"));
  entries.push(...toEntries(result?.errors || result?.wrong || result?.mistakes, "wrong"));

  if (requestedMode === "calculate") {
    const value = String(result?.value || result?.answer || result?.result || result?.message || "").trim();
    if (value) {
      entries.push({
        kind: "calculate",
        title: "Calculated Result",
        content: value,
      });
    }
  }

  if (requestedMode === "explain") {
    const explanation = String(result?.explanation || result?.hint || result?.message || result?.result || "").trim();
    if (explanation) {
      entries.push({
        kind: "explain",
        title: "Explained Selection",
        content: explanation,
      });
    }
  }

  const directMessage = requestedMode === "hint" ? result?.hint || result?.message || "" : "";

  if (String(directMessage).trim()) {
    entries.push({
      kind: "hint",
      content: String(directMessage).trim(),
    });
  }

  const seen = new Set<string>();
  const uniqueEntries = entries.filter((entry) => {
    const key = `${String(entry.kind || "").trim().toLowerCase()}::${String(entry.content || "")
      .trim()
      .toLowerCase()}`;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return uniqueEntries.map((entry, index) => ({
    id: "ai-" + Date.now() + "-" + index,
    kind: entry.kind,
    title: entry.title,
    content: entry.content,
  }));
};

const getPersistedScene = (scene: any) => {
  const normalizedElements = Array.isArray(scene?.elements) ? scene.elements : [];
  const normalizedFiles =
    scene?.files && typeof scene.files === "object" && !Array.isArray(scene.files)
      ? scene.files
      : {};
  const viewBackgroundColor =
    typeof scene?.appState?.viewBackgroundColor === "string"
      ? scene.appState.viewBackgroundColor
      : "#f8fafc";
  const defaultSidebarDockedPreference = false;

  return {
    elements: normalizedElements,
    appState: { viewBackgroundColor, defaultSidebarDockedPreference },
    files: normalizedFiles,
  };
};

const getRenderableElements = (elements: any[]) =>
  (Array.isArray(elements) ? elements : []).filter((element) => !element?.isDeleted);

const formatDate = (time: number) => new Date(time).toLocaleString();

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const normalizeProblemCount = (value: number) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return MIN_PROBLEM_COUNT;
  return clamp(parsed, MIN_PROBLEM_COUNT, MAX_PROBLEM_COUNT);
};

const mergeLimitedInsights = (previous: any[], incoming: any[]) => {
  const merged = [...previous, ...incoming];
  let hintCount = 0;
  let errorCount = 0;
  let calculateCount = 0;
  let explainCount = 0;
  const retainedIndexes = new Set();

  for (let index = merged.length - 1; index >= 0; index -= 1) {
    const entry = merged[index];
    if (entry.kind === "wrong") {
      if (errorCount >= MAX_ERROR_ITEMS) continue;
      errorCount += 1;
      retainedIndexes.add(index);
      continue;
    }

    if (entry.kind === "calculate") {
      if (calculateCount >= MAX_SELECTION_INSIGHT_ITEMS) continue;
      calculateCount += 1;
      retainedIndexes.add(index);
      continue;
    }

    if (entry.kind === "explain") {
      if (explainCount >= MAX_SELECTION_INSIGHT_ITEMS) continue;
      explainCount += 1;
      retainedIndexes.add(index);
      continue;
    }

    if (hintCount >= MAX_HINT_ITEMS) continue;
    hintCount += 1;
    retainedIndexes.add(index);
  }

  return merged.filter((_, index) => retainedIndexes.has(index));
};

const upscaleCanvasToMinDimension = (canvas: HTMLCanvasElement, minDimension = WHITEBOARD_MIN_DIMENSION) => {
  const maxDimension = Math.max(canvas.width, canvas.height);
  if (!maxDimension || maxDimension >= minDimension) return canvas;

  const scale = minDimension / maxDimension;
  if (scale <= 1) return canvas;

  const scaledCanvas = document.createElement("canvas");
  scaledCanvas.width = Math.round(canvas.width * scale);
  scaledCanvas.height = Math.round(canvas.height * scale);
  const context = scaledCanvas.getContext("2d");
  if (!context) return canvas;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(canvas, 0, 0, scaledCanvas.width, scaledCanvas.height);
  return scaledCanvas;
};

const createCroppedImageBlob = async (sourceUrl: string, cropArea: any) => {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const nextImage = new Image();
    nextImage.onload = () => resolve(nextImage);
    nextImage.onerror = () => reject(new Error("Unable to load rendered PDF page."));
    nextImage.src = sourceUrl;
  });

  const width = clamp(Math.round(cropArea.width), 1, image.naturalWidth);
  const height = clamp(Math.round(cropArea.height), 1, image.naturalHeight);
  const x = clamp(Math.round(cropArea.x), 0, image.naturalWidth - width);
  const y = clamp(Math.round(cropArea.y), 0, image.naturalHeight - height);

  const canvas = document.createElement("canvas");
  canvas.width = width * PROBLEM_CROP_SCALE;
  canvas.height = height * PROBLEM_CROP_SCALE;

  const context = canvas.getContext("2d");
  if (!context) throw new Error("Unable to initialize image crop context.");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(
    image,
    x,
    y,
    width,
    height,
    0,
    0,
    width * PROBLEM_CROP_SCALE,
    height * PROBLEM_CROP_SCALE,
  );

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Unable to export cropped problem image.");
  return blob;
};

interface ProblemBoardPageProps {
  subjectId: string;
  assignmentId: string;
  problemIndex: number;
  onBack: () => void;
}

type PickerSource = "pdf" | "capture";

export function ProblemBoardPage({ assignmentId, problemIndex, onBack }: ProblemBoardPageProps) {
  const pickerPageStorageKey = useMemo(
    () => `stepwise_problem_picker_page_v1:${assignmentId}:${problemIndex}`,
    [assignmentId, problemIndex],
  );
  const [assignment, setAssignment] = useState<any>(null);
  const [status, setStatus] = useState("Loading whiteboard...");
  const [, setHint] = useState("Start drawing to receive hints.");
  const [initialScene, setInitialScene] = useState(getDefaultScene());
  const latestSceneRef = useRef(getDefaultScene());
  const latestSceneSnapshotRef = useRef(JSON.stringify(getDefaultScene()));
  const excalidrawApiRef = useRef<WhiteboardExcalidrawApi | null>(null);
  const excalidrawRefreshRafRef = useRef<number | null>(null);
  const persistedInsights = useMemo(
    () => parseInsightsForProblem(assignment, problemIndex),
    [assignment, problemIndex],
  );
  const [manualInsights, setManualInsights] = useState<any[]>([]);
  const combinedInsights = useMemo(
    () => [
      ...persistedInsights.filter(
        (entry) => entry.kind === "calculate" || entry.kind === "explain",
      ),
      ...manualInsights,
    ],
    [persistedInsights, manualInsights],
  );
  const hintInsights = useMemo(
    () =>
      combinedInsights.filter(
        (entry) =>
          (entry.kind === "hint" && !isErrorLikeFeedback(entry)) ||
          entry.kind === "calculate" ||
          entry.kind === "explain",
      ),
    [combinedInsights],
  );
  const wrongInsights = useMemo(
    () =>
      combinedInsights.filter(
        (entry) => entry.kind === "wrong" || (entry.kind === "hint" && isErrorLikeFeedback(entry)),
      ).slice(-MAX_ERROR_ITEMS),
    [combinedInsights],
  );
  const [sceneRevision, setSceneRevision] = useState(0);
  const [problemImageMeta, setProblemImageMeta] = useState<any>(null);
  const [problemImageUrl, setProblemImageUrl] = useState("");
  const [questionExplanationStatus, setQuestionExplanationStatus] = useState("");
  const [problemContextMeta, setProblemContextMeta] = useState<any>(null);
  const [answerKeyDraft, setAnswerKeyDraft] = useState("");
  const [isSavingAnswerKey, setIsSavingAnswerKey] = useState(false);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [pickerStatus, setPickerStatus] = useState("");
  const [pickerSource, setPickerSource] = useState<PickerSource>("pdf");
  const [pdfPageCount, setPdfPageCount] = useState(0);
  const [selectedPage, setSelectedPage] = useState(1);
  const [pageImageUrl, setPageImageUrl] = useState("");
  const [selectionRect, setSelectionRect] = useState<any>(null);
  const [isSelecting, setIsSelecting] = useState(false);
  const [isRenderingPage, setIsRenderingPage] = useState(false);
  const [isSavingProblemImage, setIsSavingProblemImage] = useState(false);
  const [selectionMode, setSelectionMode] = useState<string | null>(null);
  const [boardSelectionRect, setBoardSelectionRect] = useState<any>(null);
  const [isBoardSelecting, setIsBoardSelecting] = useState(false);
  const [isAiSelecting, setIsAiSelecting] = useState(false);
  const [isStylePanelOpen, setIsStylePanelOpen] = useState(true);
  const [, setDebugHintImage] = useState<{
    url: string;
    width: number;
    height: number;
    bytes: number;
  } | null>(null);
  const analyzeTimerRef = useRef<any>(null);
  const lastSnapshotRef = useRef<string | null>(null);
  const pdfDocumentRef = useRef<any>(null);
  const problemImageUrlRef = useRef("");
  const pageImageUrlRef = useRef("");
  const cropImageRef = useRef<HTMLImageElement>(null);
  const dragStartRef = useRef<any>(null);
  const selectionPointerIdRef = useRef<number | null>(null);
  const whiteboardAreaRef = useRef<HTMLDivElement>(null);
  const boardSelectionStartRef = useRef<any>(null);
  const hintLevelRef = useRef(1);
  const previousHintsRef = useRef<string[]>([]);
  const autosaveTimerRef = useRef<number | null>(null);
  const lastSavedSceneRef = useRef<string>("");
  const pendingAutosaveAfterCurrentRef = useRef(false);
  const isAutosavingRef = useRef(false);
  const [playingInsightId, setPlayingInsightId] = useState<string | null>(null);
  const [isAutosaving, setIsAutosaving] = useState(false);

  useEffect(() => subscribeAccessibilitySpeechState((active) => {
    if (!active) {
      setPlayingInsightId(null);
    }
  }), []);

  useEffect(() => () => {
    stopAccessibilitySpeech();
  }, []);

  const clearProblemImageUrl = useCallback(() => {
    if (!problemImageUrlRef.current) return;
    URL.revokeObjectURL(problemImageUrlRef.current);
    problemImageUrlRef.current = "";
    setProblemImageUrl("");
  }, []);

  const replaceProblemImageUrl = useCallback((nextUrl: string, revokeOnClear = false) => {
    if (problemImageUrlRef.current) {
      URL.revokeObjectURL(problemImageUrlRef.current);
      problemImageUrlRef.current = "";
    }
    if (revokeOnClear) {
      problemImageUrlRef.current = nextUrl;
    }
    setProblemImageUrl(nextUrl);
  }, []);

  const clearPageImageUrl = useCallback(() => {
    if (!pageImageUrlRef.current) return;
    URL.revokeObjectURL(pageImageUrlRef.current);
    pageImageUrlRef.current = "";
    setPageImageUrl("");
  }, []);

  const clearDebugHintImage = useCallback(() => {
    setDebugHintImage((current) => {
      if (current?.url) {
        URL.revokeObjectURL(current.url);
      }
      return null;
    });
  }, []);

  const clearTransientFeedback = useCallback(() => {
    setManualInsights((previous) =>
      previous.filter((entry) => entry.kind === "calculate" || entry.kind === "explain"),
    );
    previousHintsRef.current = [];
    hintLevelRef.current = 1;
  }, []);

  const handleToggleInsightAudio = useCallback(async (insight: { id: string; title?: string; content: string }) => {
    if (playingInsightId === insight.id) {
      stopAccessibilitySpeech();
      setPlayingInsightId(null);
      return;
    }

    const settings = getUserSettings();
    const rawSpeechText = [String(insight.title || "").trim(), String(insight.content || "").trim()]
      .filter(Boolean)
      .join(". ");

    if (!rawSpeechText) {
      return;
    }

    setPlayingInsightId(insight.id);
    try {
      const speechText = await translateAppText(rawSpeechText, settings.appLanguage);
      await speakWithAzure(speechText, settings, {
        sessionKey: `problem-insight:${assignmentId}:${problemIndex}:${insight.id}`,
      });
    } catch {
      // The shared speech service already handles fallback and logging.
    } finally {
      setPlayingInsightId((current) => (current === insight.id ? null : current));
    }
  }, [assignmentId, playingInsightId, problemIndex]);

  const persistScene = useCallback(async (source: "manual" | "autosave") => {
    const serializedScene = JSON.stringify(latestSceneRef.current);
    if (serializedScene === lastSavedSceneRef.current) {
      return;
    }

    if (isAutosavingRef.current) {
      pendingAutosaveAfterCurrentRef.current = true;
      return;
    }

    isAutosavingRef.current = true;
    setIsAutosaving(true);

    try {
      await saveProblemScene(assignmentId, problemIndex, latestSceneRef.current);
      lastSavedSceneRef.current = serializedScene;
      if (source === "manual") {
        setStatus(`Saved at ${new Date().toLocaleTimeString()}.`);
      }
    } finally {
      isAutosavingRef.current = false;
      setIsAutosaving(false);

      if (pendingAutosaveAfterCurrentRef.current) {
        pendingAutosaveAfterCurrentRef.current = false;
        const nextSerializedScene = JSON.stringify(latestSceneRef.current);
        if (nextSerializedScene !== lastSavedSceneRef.current) {
          void persistScene("autosave");
        }
      }
    }
  }, [assignmentId, problemIndex]);

  const loadProblemImage = useCallback(async () => {
    const metadata = await getProblemImage(assignmentId, problemIndex);
    if (!metadata) {
      setProblemImageMeta(null);
      clearProblemImageUrl();
      return;
    }

    setProblemImageMeta(metadata);

    if (metadata.downloadUrl) {
      replaceProblemImageUrl(metadata.downloadUrl);
      return;
    }

    const blob = await downloadProblemImageBlob(assignmentId, problemIndex);
    const objectUrl = URL.createObjectURL(blob);
    replaceProblemImageUrl(objectUrl, true);
  }, [assignmentId, clearProblemImageUrl, problemIndex, replaceProblemImageUrl]);

  const loadProblemContext = useCallback(async () => {
    const context = await getProblemContext(assignmentId, problemIndex);
    setProblemContextMeta(context);
    setAnswerKeyDraft(context?.answerKey || "");
  }, [assignmentId, problemIndex]);

  const closePicker = useCallback(() => {
    setIsPickerOpen(false);
    setPickerStatus("");
    setPickerSource("pdf");
    setPdfPageCount(0);
    setSelectedPage(1);
    setSelectionRect(null);
    setIsSelecting(false);
    clearPageImageUrl();

    const currentPdf = pdfDocumentRef.current;
    pdfDocumentRef.current = null;
    if (currentPdf?.destroy) {
      void currentPdf.destroy();
    }
  }, [clearPageImageUrl]);

  const renderSelectedPage = useCallback(
    async (pdfDocument: any, pageNumber: number) => {
      setIsRenderingPage(true);
      try {
        const page = await pdfDocument.getPage(pageNumber);
        const initialViewport = page.getViewport({ scale: PDF_RENDER_SCALE });
        const boundedScale =
          initialViewport.width > PDF_MAX_WIDTH
            ? PDF_RENDER_SCALE * (PDF_MAX_WIDTH / initialViewport.width)
            : PDF_RENDER_SCALE;
        const viewport = page.getViewport({ scale: boundedScale });
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d");
        if (!context) {
          throw new Error("Unable to initialize PDF rendering context.");
        }
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        await page.render({ canvasContext: context, viewport }).promise;
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
        if (!blob) {
          throw new Error("Unable to render selected page.");
        }

        const objectUrl = URL.createObjectURL(blob);
        if (pageImageUrlRef.current) {
          URL.revokeObjectURL(pageImageUrlRef.current);
        }
        pageImageUrlRef.current = objectUrl;
        setPageImageUrl(objectUrl);
        setSelectionRect(null);
        setIsSelecting(false);
        setPickerStatus(`Page ${pageNumber} ready. Drag on the image to select a crop area.`);
      } finally {
        setIsRenderingPage(false);
      }
    },
    [],
  );

  useEffect(() => {
    const loadData = async () => {
      const target = await getAssignmentById(assignmentId);
      setAssignment(target);
      const assignmentProblemCount = normalizeProblemCount(target.problemCount);
      if (problemIndex > assignmentProblemCount) {
        setInitialScene(getDefaultScene());
        setSceneRevision((revision) => revision + 1);
        latestSceneRef.current = getDefaultScene();
        latestSceneSnapshotRef.current = JSON.stringify(latestSceneRef.current);
        setHint("Start drawing to receive hints.");
        lastSnapshotRef.current = null;
        hintLevelRef.current = 1;
        previousHintsRef.current = [];
        setStatus(`Problem ${problemIndex} does not exist in this assignment.`);
        setProblemImageMeta(null);
        clearProblemImageUrl();
        return;
      }

      const storedScene = await getProblemScene(assignmentId, problemIndex);
      await loadProblemContext();
      const scene = getPersistedScene(storedScene?.scene || getDefaultScene());
      setInitialScene(scene);
      setSceneRevision((revision) => revision + 1);
      latestSceneRef.current = scene;
      latestSceneSnapshotRef.current = JSON.stringify(scene);
      lastSavedSceneRef.current = JSON.stringify(scene);
      setHint("Start drawing to receive hints.");
      lastSnapshotRef.current = null;
      hintLevelRef.current = 1;
      previousHintsRef.current = [];
      setStatus(
        storedScene
          ? `Last saved ${formatDate(storedScene.updatedAt)}.`
          : "No saved drawing yet.",
      );
      await loadProblemImage();
    };

    loadData().catch(() => setStatus("Unable to load whiteboard."));
  }, [assignmentId, clearProblemImageUrl, loadProblemContext, loadProblemImage, problemIndex]);

  const blobToBase64 = useCallback(
    (blob: Blob) =>
      new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.readAsDataURL(blob);
      }),
    [],
  );

  const analyzeSceneForHint = useCallback(
    async (elements: any, appState: any, files: any) => {
      const renderableElements = getRenderableElements(elements);
      if (renderableElements.length === 0) {
        clearTransientFeedback();
        setHint("Start drawing to receive hints.");
        return;
      }

      const canvas = await exportToCanvas({
        elements: renderableElements,
        appState,
        files,
        exportScale: WHITEBOARD_EXPORT_SCALE,
      });

      const exportCanvas = upscaleCanvasToMinDimension(canvas);

      const blob = await new Promise<Blob | null>((resolve) => exportCanvas.toBlob(resolve, "image/png"));
      if (!blob) return;

      if (isDebugImagesEnabled()) {
        const debugUrl = URL.createObjectURL(blob);
        setDebugHintImage((current) => {
          if (current?.url) {
            URL.revokeObjectURL(current.url);
          }
          return {
            url: debugUrl,
            width: exportCanvas.width,
            height: exportCanvas.height,
            bytes: blob.size,
          };
        });
      }

      const base64 = await blobToBase64(blob);
      if (base64 === lastSnapshotRef.current) return;
      lastSnapshotRef.current = base64;

      clearTransientFeedback();
      setHint("Generating hint...");
      try {
        const result = await analyzeDrawing(blob, {
          assignmentId,
          problemIndex,
          problemImageUrl,
          hintLevel: hintLevelRef.current,
          previousHints: previousHintsRef.current,
        });

        const nextInsights = deriveInsightsFromAiResult(result, "hint");
        const newHintTexts = nextInsights
          .filter((e: any) => e.kind === "hint")
          .map((e: any) => e.content);
        if (newHintTexts.length > 0) {
          previousHintsRef.current = [...previousHintsRef.current, ...newHintTexts].slice(-5);
          hintLevelRef.current = Math.min(4, hintLevelRef.current + 1);
        }
        setManualInsights((previous) => {
          const preservedSelectionInsights = previous.filter(
            (entry) => entry.kind === "calculate" || entry.kind === "explain",
          );
          if (nextInsights.length === 0) {
            return preservedSelectionInsights;
          }
          return mergeLimitedInsights(preservedSelectionInsights, nextInsights);
        });

        setHint("AI feedback updated.");
      } catch {
        setHint("Hint service unavailable.");
      }
    },
    [assignmentId, blobToBase64, clearTransientFeedback, problemImageUrl, problemIndex],
  );

  const handleChange = useCallback((elements: any, appState: any, files: any) => {
    const isMenuOpen = Boolean(appState?.openMenu);
    setIsStylePanelOpen((current) => (current === isMenuOpen ? current : isMenuOpen));

    const nextScene = getPersistedScene({ elements, appState, files });
    const nextSerializedScene = JSON.stringify(nextScene);
    if (nextSerializedScene === latestSceneSnapshotRef.current) {
      return;
    }

    latestSceneRef.current = nextScene;
    latestSceneSnapshotRef.current = nextSerializedScene;

    if (autosaveTimerRef.current) {
      window.clearTimeout(autosaveTimerRef.current);
    }
    autosaveTimerRef.current = window.setTimeout(() => {
      void persistScene("autosave");
    }, WHITEBOARD_AUTOSAVE_DELAY_MS);

    if (analyzeTimerRef.current) {
      window.clearTimeout(analyzeTimerRef.current);
    }
    analyzeTimerRef.current = window.setTimeout(() => {
      void analyzeSceneForHint(elements, appState, files);
    }, 3000);
  }, [analyzeSceneForHint, persistScene]);

  const scheduleExcalidrawRefresh = useCallback(() => {
    if (!excalidrawApiRef.current?.refresh) return;
    if (excalidrawRefreshRafRef.current != null) {
      cancelAnimationFrame(excalidrawRefreshRafRef.current);
    }
    excalidrawRefreshRafRef.current = requestAnimationFrame(() => {
      excalidrawApiRef.current?.refresh();
    });
  }, []);

  const handleStylePanelToggle = useCallback(() => {
    setIsStylePanelOpen((current) => {
      const next = !current;
      const api = excalidrawApiRef.current;
      if (api?.updateScene) {
        api.updateScene({
          appState: {
            openMenu: next ? "shape" : null,
            openPopup: null,
          },
        });
      }
      return next;
    });
  }, []);

  // Excalidraw caches container bounds for pointer coordinate mapping.
  // When AI UI updates cause a reflow, those cached bounds can get stale,
  // leading to a visible cursor offset while drawing. Refreshing fixes it
  // without remounting Excalidraw (so the user's drawing stays intact).
  useEffect(() => {
    scheduleExcalidrawRefresh();
  }, [scheduleExcalidrawRefresh, hintInsights.length, wrongInsights.length, selectionMode, status]);

  useEffect(() => {
    const handleWindowResize = () => scheduleExcalidrawRefresh();
    window.addEventListener("resize", handleWindowResize);
    return () => window.removeEventListener("resize", handleWindowResize);
  }, [scheduleExcalidrawRefresh]);

  useEffect(
    () => () => {
      if (analyzeTimerRef.current) {
        window.clearTimeout(analyzeTimerRef.current);
      }
      if (autosaveTimerRef.current) {
        window.clearTimeout(autosaveTimerRef.current);
      }

      if (problemImageUrlRef.current) {
        URL.revokeObjectURL(problemImageUrlRef.current);
        problemImageUrlRef.current = "";
      }
      if (pageImageUrlRef.current) {
        URL.revokeObjectURL(pageImageUrlRef.current);
        pageImageUrlRef.current = "";
      }
      clearDebugHintImage();
      const currentPdf = pdfDocumentRef.current;
      pdfDocumentRef.current = null;
      if (currentPdf?.destroy) {
        void currentPdf.destroy();
      }
    },
    [],
  );

  const handleSave = async () => {
    if (autosaveTimerRef.current) {
      window.clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
    await persistScene("manual");
  };

  const handleOpenPicker = async () => {
    setIsPickerOpen(true);
    setPickerStatus("Loading assignment upload...");
    try {
      const pdfBlob = await downloadAssignmentPdfBlob(assignmentId);
      const bytes = await pdfBlob.arrayBuffer();
      const loadingTask = getDocument({ data: new Uint8Array(bytes) });
      const pdfDocument = await loadingTask.promise;
      pdfDocumentRef.current = pdfDocument;
      setPickerSource("pdf");
      setPdfPageCount(pdfDocument.numPages);
      const storedPage = Number(localStorage.getItem(pickerPageStorageKey) || 1);
      const initialPage = clamp(storedPage || 1, 1, pdfDocument.numPages || 1);
      setSelectedPage(initialPage);
      await renderSelectedPage(pdfDocument, initialPage);
      return;
    } catch {
      // Fall through to capture mode.
    }

    try {
      const capture = await getAssignmentCaptureImage(assignmentId);
      if (!capture) {
        setPickerStatus("Unable to open source. Upload a PDF or image/capture first.");
        return;
      }
      const captureBlob = await downloadAssignmentCaptureImageBlob(assignmentId);
      const objectUrl = URL.createObjectURL(captureBlob);
      if (pageImageUrlRef.current) {
        URL.revokeObjectURL(pageImageUrlRef.current);
      }
      pageImageUrlRef.current = objectUrl;
      setPickerSource("capture");
      setPdfPageCount(1);
      setSelectedPage(1);
      setPageImageUrl(objectUrl);
      setSelectionRect(null);
      setIsSelecting(false);
      setPickerStatus("Capture image ready. Drag on the image to select a crop area.");
    } catch {
      setPickerStatus("Unable to open source. Upload a PDF or image/capture first.");
    }
  };

  const handleSaveAnswerKey = async () => {
    setIsSavingAnswerKey(true);
    try {
      const saved = await saveProblemContext(assignmentId, problemIndex, {
        answerKey: answerKeyDraft,
      });
      setProblemContextMeta(saved);
      setAnswerKeyDraft(saved?.answerKey || "");
      setStatus(`Saved answer key at ${new Date().toLocaleTimeString()}.`);
    } finally {
      setIsSavingAnswerKey(false);
    }
  };

  const handlePageChange = async (value: string) => {
    if (pickerSource !== "pdf") return;
    const nextPage = clamp(Number(value) || 1, 1, pdfPageCount || 1);
    setSelectedPage(nextPage);
    if (pdfDocumentRef.current) {
      await renderSelectedPage(pdfDocumentRef.current, nextPage);
    }
  };

  useEffect(() => {
    if (!isPickerOpen || pickerSource !== "pdf") return;
    localStorage.setItem(pickerPageStorageKey, String(selectedPage));
  }, [isPickerOpen, pickerPageStorageKey, pickerSource, selectedPage]);

  const handleSaveProblemImage = async () => {
    if (!pageImageUrl || !selectionRect || !cropImageRef.current) {
      setPickerStatus("Drag to select a crop area first.");
      return;
    }

    setIsSavingProblemImage(true);
    try {
      const imageElement = cropImageRef.current;
      const renderedWidth = imageElement.clientWidth;
      const renderedHeight = imageElement.clientHeight;
      if (!renderedWidth || !renderedHeight) {
        throw new Error("Unable to read selected image dimensions.");
      }

      const scaleX = imageElement.naturalWidth / renderedWidth;
      const scaleY = imageElement.naturalHeight / renderedHeight;
      const cropAreaPixels = {
        x: selectionRect.x * scaleX,
        y: selectionRect.y * scaleY,
        width: selectionRect.width * scaleX,
        height: selectionRect.height * scaleY,
      };

      const croppedBlob = await createCroppedImageBlob(pageImageUrl, cropAreaPixels);
      const imageFile = new File([croppedBlob], `problem-${problemIndex}.png`, {
        type: "image/png",
      });
      await saveProblemImage(assignmentId, problemIndex, imageFile);
      await loadProblemImage();
      closePicker();
      setStatus(`Saved problem image and refreshed context at ${new Date().toLocaleTimeString()}.`);
    } catch {
      setPickerStatus("Unable to save cropped image.");
    } finally {
      setIsSavingProblemImage(false);
    }
  };

  const finalizeSelection = useCallback(
    (
      currentTarget?: (EventTarget & HTMLDivElement) | null,
      pointerId?: number,
    ) => {
      const activePointerId = selectionPointerIdRef.current;
      if (!isSelecting && !dragStartRef.current && activePointerId == null) return;

      setIsSelecting(false);
      dragStartRef.current = null;
      selectionPointerIdRef.current = null;

      if (
        currentTarget &&
        pointerId != null &&
        activePointerId === pointerId &&
        typeof currentTarget.hasPointerCapture === "function" &&
        currentTarget.hasPointerCapture(pointerId)
      ) {
        try {
          currentTarget.releasePointerCapture(pointerId);
        } catch {
          // Ignore invalid capture release edge cases across browsers.
        }
      }

      setSelectionRect((currentRect: any) => {
        if (!currentRect || currentRect.width < 6 || currentRect.height < 6) {
          setPickerStatus("Selection too small. Drag a larger area.");
          return null;
        }
        setPickerStatus("Selection ready. Save cropped image.");
        return currentRect;
      });
    },
    [isSelecting],
  );

  const handleSelectionStart = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (!cropImageRef.current || !pageImageUrl) return;
    event.preventDefault();
    const imageRect = cropImageRef.current.getBoundingClientRect();
    const startX = clamp(event.clientX - imageRect.left, 0, imageRect.width);
    const startY = clamp(event.clientY - imageRect.top, 0, imageRect.height);

    dragStartRef.current = { x: startX, y: startY };
    selectionPointerIdRef.current = event.pointerId;
    setSelectionRect({ x: startX, y: startY, width: 0, height: 0 });
    setIsSelecting(true);
    setPickerStatus("Selecting crop area...");
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture can fail on some devices; dragging still works without it.
    }
  };

  const handleSelectionMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isSelecting || !dragStartRef.current || !cropImageRef.current) return;
    if (selectionPointerIdRef.current != null && selectionPointerIdRef.current !== event.pointerId) return;
    if (event.pointerType === "mouse" && (event.buttons & 1) !== 1) {
      finalizeSelection(event.currentTarget, event.pointerId);
      return;
    }
    event.preventDefault();

    const imageRect = cropImageRef.current.getBoundingClientRect();
    const nextX = clamp(event.clientX - imageRect.left, 0, imageRect.width);
    const nextY = clamp(event.clientY - imageRect.top, 0, imageRect.height);
    const originX = dragStartRef.current.x;
    const originY = dragStartRef.current.y;

    setSelectionRect({
      x: Math.min(originX, nextX),
      y: Math.min(originY, nextY),
      width: Math.abs(nextX - originX),
      height: Math.abs(nextY - originY),
    });
  };

  const handleSelectionEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    if (selectionPointerIdRef.current != null && selectionPointerIdRef.current !== event.pointerId) return;
    event.preventDefault();
    finalizeSelection(event.currentTarget, event.pointerId);
  };

  const handleSelectionCancel = (event: React.PointerEvent<HTMLDivElement>) => {
    if (selectionPointerIdRef.current != null && selectionPointerIdRef.current !== event.pointerId) return;
    finalizeSelection(event.currentTarget, event.pointerId);
  };

  const handleSelectionLostCapture = (event: React.PointerEvent<HTMLDivElement>) => {
    if (selectionPointerIdRef.current != null && selectionPointerIdRef.current !== event.pointerId) return;
    finalizeSelection(event.currentTarget, event.pointerId);
  };

  const appendLimitedInsights = useCallback((incomingInsights: any[]) => {
    setManualInsights((previous) => mergeLimitedInsights(previous, incomingInsights));
  }, [clearDebugHintImage]);

  const startSelectionTool = (mode: string) => {
    setSelectionMode(mode);
    setBoardSelectionRect(null);
    setHint(
      mode === "calculate"
        ? "Draw a blue rectangle to calculate the selected expression."
        : "Draw a yellow rectangle to explain the selected area.",
    );
  };

  const runSelectionAnalysis = useCallback(
    async (selectionRect: any, mode: string, bounds: any) => {
      const scene = latestSceneRef.current || getDefaultScene();
      const renderableElements = getRenderableElements(scene.elements);
      if (!renderableElements.length) {
        setHint("Draw something first, then use a selection tool.");
        return;
      }

      setIsAiSelecting(true);
      try {
        const exportedCanvas = await exportToCanvas({
          elements: renderableElements,
          appState: scene.appState,
          files: scene.files,
          exportScale: WHITEBOARD_EXPORT_SCALE,
        });

        const scaleX = exportedCanvas.width / Math.max(bounds.width, 1);
        const scaleY = exportedCanvas.height / Math.max(bounds.height, 1);
        const cropX = Math.max(0, Math.round(selectionRect.x * scaleX));
        const cropY = Math.max(0, Math.round(selectionRect.y * scaleY));
        const cropWidth = Math.max(1, Math.round(selectionRect.width * scaleX));
        const cropHeight = Math.max(1, Math.round(selectionRect.height * scaleY));

        const cropCanvas = document.createElement("canvas");
        cropCanvas.width = cropWidth;
        cropCanvas.height = cropHeight;
        const cropContext = cropCanvas.getContext("2d");
        if (!cropContext) throw new Error("Unable to crop selection.");

        cropContext.drawImage(
          exportedCanvas,
          cropX,
          cropY,
          cropWidth,
          cropHeight,
          0,
          0,
          cropWidth,
          cropHeight,
        );

        const exportCropCanvas = upscaleCanvasToMinDimension(cropCanvas);
        const cropBlob = await new Promise<Blob | null>((resolve) =>
          exportCropCanvas.toBlob(resolve, "image/png"),
        );
        if (!cropBlob) throw new Error("Unable to export selected area.");

        const result = await analyzeDrawing(cropBlob, {
          assignmentId,
          problemIndex,
          problemImageUrl,
          mode: mode === "calculate" ? "calculate" : "explain",
        });

        appendLimitedInsights(
          deriveInsightsFromAiResult(result, mode === "calculate" ? "calculate" : "explain"),
        );

        setHint("Selection analyzed.");
      } catch {
        setHint("Selection analysis failed.");
      } finally {
        setIsAiSelecting(false);
      }
    },
    [assignmentId, problemImageUrl, problemIndex, appendLimitedInsights],
  );

  const handleBoardSelectionStart = (event: React.PointerEvent) => {
    if (!selectionMode || !whiteboardAreaRef.current) return;
    const bounds = whiteboardAreaRef.current.getBoundingClientRect();
    const startX = event.clientX - bounds.left;
    const startY = event.clientY - bounds.top;

    boardSelectionStartRef.current = { x: startX, y: startY };
    setBoardSelectionRect({ x: startX, y: startY, width: 0, height: 0 });
    setIsBoardSelecting(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleBoardSelectionMove = (event: React.PointerEvent) => {
    if (!isBoardSelecting || !boardSelectionStartRef.current || !whiteboardAreaRef.current) return;
    const bounds = whiteboardAreaRef.current.getBoundingClientRect();
    const nextX = event.clientX - bounds.left;
    const nextY = event.clientY - bounds.top;
    const originX = boardSelectionStartRef.current.x;
    const originY = boardSelectionStartRef.current.y;

    setBoardSelectionRect({
      x: Math.min(originX, nextX),
      y: Math.min(originY, nextY),
      width: Math.abs(nextX - originX),
      height: Math.abs(nextY - originY),
    });
  };

  const handleBoardSelectionEnd = (event: React.PointerEvent) => {
    if (!isBoardSelecting || !boardSelectionRect || !whiteboardAreaRef.current) return;
    setIsBoardSelecting(false);
    event.currentTarget.releasePointerCapture(event.pointerId);

    if (boardSelectionRect.width < 10 || boardSelectionRect.height < 10) {
      setBoardSelectionRect(null);
      setSelectionMode(null);
      setHint("Selection too small.");
      return;
    }

    const bounds = whiteboardAreaRef.current.getBoundingClientRect();
    void runSelectionAnalysis(boardSelectionRect, selectionMode!, bounds);
    setBoardSelectionRect(null);
    setSelectionMode(null);
  };

  const handleRemoveProblemImage = async () => {
    await deleteProblemImage(assignmentId, problemIndex);
    clearProblemImageUrl();
    setProblemImageMeta(null);
    setStatus("Removed problem image.");
  };

  const handleSimplifyQuestion = useCallback(async () => {
    if (!problemImageUrl) {
      return "This question is asking you to look at the uploaded problem image first.";
    }

    setQuestionExplanationStatus("Reading question...");
    try {
      const blob = await downloadProblemImageBlob(assignmentId, problemIndex);
      const result = await simplifyQuestion(blob, {
        assignmentId,
        problemIndex,
      });
      setQuestionExplanationStatus("");
      return (
        String(result?.explanation || "").trim() ||
        "This question is asking you to identify what quantity or value the problem wants."
      );
    } catch {
      setQuestionExplanationStatus("");
      return "This question is asking you to identify the goal of the problem in simpler language.";
    }
  }, [assignmentId, problemImageUrl, problemIndex]);

  if (!assignment) {
    return (
      <div className="app-content">
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Whiteboard</p>
          <h1><span data-no-translate="true">{assignment.title}</span> - Problem {problemIndex}</h1>
        </div>
        <div className="topbar-actions">
          {!selectionMode && (
            <>
              <p className="status-pill">{status}</p>
              <button
                type="button"
                className="btn-secondary selection-tool-btn selection-tool-btn-blue"
                onClick={() => startSelectionTool("calculate")}
              >
                Calculate
              </button>
              <button
                type="button"
                className="btn-secondary selection-tool-btn selection-tool-btn-yellow"
                onClick={() => startSelectionTool("explain")}
              >
                Explain
              </button>
              <button type="button" onClick={handleSave} className="btn-primary" disabled={isAutosaving}>
                {isAutosaving ? "Saving..." : "Save Drawing"}
              </button>
              <button type="button" className="outline" onClick={onBack}>
                Back
              </button>
            </>
          )}
          {selectionMode && (
            <>
              <p className="subtle" style={{ fontSize: 'calc(0.85rem * var(--app-text-zoom))', maxWidth: '400px' }}>
                For Calc/Explain, first choose the tool, then drag on the whiteboard to select a portion.
              </p>
              <button
                type="button"
                className={`btn-secondary selection-tool-btn selection-tool-btn-blue ${
                  selectionMode === "calculate" ? "selection-tool-btn-active" : ""
                }`}
                onClick={() => startSelectionTool("calculate")}
              >
                Calculate
              </button>
              <button
                type="button"
                className={`btn-secondary selection-tool-btn selection-tool-btn-yellow ${
                  selectionMode === "explain" ? "selection-tool-btn-active" : ""
                }`}
                onClick={() => startSelectionTool("explain")}
              >
                Explain
              </button>
              <button
                type="button"
                onClick={() => {
                  setSelectionMode(null);
                  setBoardSelectionRect(null);
                  setHint("Selection tool closed.");
                }}
              >
                Cancel
              </button>
            </>
          )}
        </div>
      </header>

      <section className="panel">
        <h2>Problem Image</h2>
        <div className="control-row">
          <button type="button" onClick={handleOpenPicker}>
            Replace from Upload
          </button>
          {problemImageMeta && (
            <>
              <button type="button" className="danger" onClick={handleRemoveProblemImage}>
                Remove Image
              </button>
              <p className="subtle" style={{ margin: 0 }}>
                Updated {formatDate(problemImageMeta.updatedAt)}
              </p>
            </>
          )}
        </div>
        {problemImageUrl && (
          <img
            src={problemImageUrl}
            alt="Problem context"
            className="problem-image-preview"
          />
        )}
        {!problemImageUrl && <p className="subtle">No problem image set.</p>}
        <QuestionSimplifier onOpen={handleSimplifyQuestion} />
        {questionExplanationStatus ? <p className="subtle mt-1">{questionExplanationStatus}</p> : null}
      </section>

      <div className="whiteboard-stage">
        <div
          ref={whiteboardAreaRef}
          className={`canvas-area ${isStylePanelOpen ? "" : "style-panel-hidden"}`}
        >
          <button
            type="button"
            className="style-panel-toggle"
            onClick={handleStylePanelToggle}
            aria-expanded={isStylePanelOpen}
          >
            Styles {isStylePanelOpen ? "v" : ">"}
          </button>
          <Excalidraw
            key={sceneRevision}
            initialData={initialScene}
            onChange={handleChange}
            excalidrawAPI={(api) => {
              excalidrawApiRef.current = {
                refresh: api.refresh.bind(api),
                updateScene: api.updateScene?.bind(api),
                getAppState: api.getAppState?.bind(api),
              };
              setIsStylePanelOpen(Boolean(api.getAppState?.().openMenu));
            }}
            detectScroll={true}
            UIOptions={{
              dockedSidebarBreakpoint: SIDEBAR_COLLAPSED_BREAKPOINT,
              canvasActions: {
                saveAsImage: false,
              },
            }}
          >
            <MainMenu>
              <MainMenu.DefaultItems.SaveAsImage />
              <MainMenu.DefaultItems.ChangeCanvasBackground />
              <MainMenu.DefaultItems.ClearCanvas />
            </MainMenu>
          </Excalidraw>

          {selectionMode && (
            <div
              className={`ai-select-layer ${
                selectionMode === "calculate"
                  ? "ai-select-layer-calculate"
                  : "ai-select-layer-explain"
              }`}
              onPointerDown={handleBoardSelectionStart}
              onPointerMove={handleBoardSelectionMove}
              onPointerUp={handleBoardSelectionEnd}
            >
              {boardSelectionRect && (
                <div
                  className="ai-select-rect"
                  style={{
                    left: boardSelectionRect.x,
                    top: boardSelectionRect.y,
                    width: boardSelectionRect.width,
                    height: boardSelectionRect.height,
                  }}
                />
              )}
            </div>
          )}

          {isAiSelecting && (
            <div
              className="ai-calc-pill ai-calc-pill-calculate"
              style={{ top: "50%", left: "50%", transform: "translate(-50%, -50%)" }}
            >
              Analyzing...
            </div>
          )}
        </div>

        <aside className="insights-rail">
          <button type="button" className="insights-tab">
            AI Study Buddy
          </button>

          <div className="insights-panel">
            <h2>Recommendations</h2>

            {wrongInsights.length > 0 && (
              <div className="insight-group">
                <h3>Errors</h3>
                {wrongInsights.map((insight) => (
                  <details key={insight.id} className="insight-item insight-item-wrong" open>
                    <summary>
                      <span className="insight-summary-title">{insight.title || "Error Found"}</span>
                      <span className="insight-summary-controls">
                        <button
                          type="button"
                          className={`btn-secondary btn-sm insight-audio-button ${
                            playingInsightId === insight.id ? "is-playing" : ""
                          }`}
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            void handleToggleInsightAudio(insight);
                          }}
                          aria-label={playingInsightId === insight.id ? "Stop error audio" : "Play error audio"}
                          title={playingInsightId === insight.id ? "Stop audio" : "Play audio"}
                        >
                          {playingInsightId === insight.id ? <Square size={13} /> : <Play size={14} />}
                          {playingInsightId === insight.id ? "Stop" : "Play"}
                        </button>
                        <span className="insight-summary-toggle" aria-hidden="true" />
                      </span>
                    </summary>
                    <LatexText text={insight.content} as="p" />
                  </details>
                ))}
              </div>
            )}

            {hintInsights.length > 0 && (
              <div className="insight-group">
                <h3>Hints</h3>
                {hintInsights.map((insight) => (
                  <details
                    key={insight.id}
                    className={`insight-item ${
                      insight.kind === "calculate"
                        ? "insight-item-calculate"
                        : insight.kind === "explain"
                          ? "insight-item-explain"
                          : "insight-item-hint"
                    }`}
                  >
                    <summary>
                      <span className="insight-summary-title">
                        {insight.title ||
                          (insight.kind === "calculate"
                            ? "Calculated Result"
                            : insight.kind === "explain"
                              ? "Explained Selection"
                              : "Hint")}
                      </span>
                      <span className="insight-summary-controls">
                        <button
                          type="button"
                          className={`btn-secondary btn-sm insight-audio-button ${
                            playingInsightId === insight.id ? "is-playing" : ""
                          }`}
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            void handleToggleInsightAudio(insight);
                          }}
                          aria-label={playingInsightId === insight.id ? "Stop insight audio" : "Play insight audio"}
                          title={playingInsightId === insight.id ? "Stop audio" : "Play audio"}
                        >
                          {playingInsightId === insight.id ? <Square size={13} /> : <Play size={14} />}
                          {playingInsightId === insight.id ? "Stop" : "Play"}
                        </button>
                        <span className="insight-summary-toggle" aria-hidden="true" />
                      </span>
                    </summary>
                    <LatexText text={insight.content} as="p" />
                  </details>
                ))}
              </div>
            )}

            {hintInsights.length === 0 && wrongInsights.length === 0 && (
              <p className="ai-buddy-status">Start drawing to receive AI feedback.</p>
            )}
          </div>
        </aside>
      </div>

      <section className="panel">
        <h2>Optional Answer Key</h2>
        <div className="answer-key-editor">
          <textarea
            id="answer-key"
            value={answerKeyDraft}
            onChange={(e) => setAnswerKeyDraft(e.target.value)}
            placeholder="Type the answer key if it is provided with the problem. This will be used to validate the solution."
            rows={3}
          />
          <div className="control-row">
            <button
              type="button"
              onClick={handleSaveAnswerKey}
              disabled={isSavingAnswerKey}
            >
              {isSavingAnswerKey ? "Saving..." : "Save Answer Key"}
            </button>
          </div>
          {problemContextMeta?.answerKey && (
            <div style={{ marginTop: '12px', padding: '12px', background: '#f0fdf4', borderRadius: '8px', border: '1px solid #86efac' }}>
              <p className="subtle" style={{ marginBottom: '8px' }}>Preview:</p>
              <LatexText text={problemContextMeta.answerKey} />
            </div>
          )}
        </div>
      </section>

      {isPickerOpen && (
        <div className="modal-overlay" onClick={closePicker}>
          <div className="panel picker-panel" onClick={(e) => e.stopPropagation()}>
            <h2>{pickerSource === "pdf" ? "Select Problem from PDF" : "Select Problem from Capture"}</h2>
            <p className="subtle">{pickerStatus}</p>

            {pickerSource === "pdf" && (
              <div className="control-row">
                <label className="picker-label">
                  Page:
                  <input
                    type="number"
                    min={1}
                    max={pdfPageCount || 1}
                    value={selectedPage}
                    onChange={(e) => void handlePageChange(e.target.value)}
                    disabled={isRenderingPage}
                  />
                </label>
                <span className="subtle">of {pdfPageCount}</span>
              </div>
            )}

            {pageImageUrl && (
              <div className="picker-crop-shell">
                <div
                  className="picker-image-stage"
                  onPointerDown={handleSelectionStart}
                  onPointerMove={handleSelectionMove}
                  onPointerUp={handleSelectionEnd}
                  onPointerCancel={handleSelectionCancel}
                  onLostPointerCapture={handleSelectionLostCapture}
                >
                  <img
                    ref={cropImageRef}
                    src={pageImageUrl}
                    alt={pickerSource === "pdf" ? `Page ${selectedPage}` : "Captured assignment"}
                    className="picker-crop-image"
                    draggable={false}
                    onDragStart={(event) => event.preventDefault()}
                  />
                  {selectionRect && (
                    <div
                      className="picker-selection"
                      style={{
                        left: selectionRect.x,
                        top: selectionRect.y,
                        width: selectionRect.width,
                        height: selectionRect.height,
                      }}
                    />
                  )}
                </div>
              </div>
            )}

            <div className="control-row">
              <button
                type="button"
                onClick={handleSaveProblemImage}
                disabled={isSavingProblemImage || !selectionRect}
              >
                {isSavingProblemImage ? "Saving..." : "Save Cropped Image"}
              </button>
              <button type="button" className="outline" onClick={closePicker}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
