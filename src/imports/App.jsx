import katex from "katex";
import "katex/dist/katex.min.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Excalidraw, MainMenu, exportToCanvas } from "@excalidraw/excalidraw";
import { GlobalWorkerOptions, getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import pdfWorker from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import "@excalidraw/excalidraw/index.css";
import "./App.css";
import { analyzeDrawing } from "./services/ai";
import {
  addProblemToAssignment,
  createAssignment,
  deleteAssignment,
  deleteLastProblemFromAssignment,
  deleteProblemImage,
  deleteAssignmentPdf,
  downloadAssignmentPdfBlob,
  downloadProblemImageBlob,
  getAssignmentPdfDownloadUrl,
  getAssignmentById,
  getAssignmentPdf,
  getCurrentUser,
  getGoogleSignInUrl,
  getProblemContext,
  getProblemImage,
  getProblemScene,
  listAssignments,
  requestAccountDeletion,
  saveAssignmentPdf,
  saveProblemContext,
  saveProblemImage,
  saveProblemScene,
  signOut,
} from "./services/storage";

const MIN_PROBLEM_COUNT = 1;
const MAX_PROBLEM_COUNT = 60;
const MAX_PDF_BYTES = 20 * 1024 * 1024;
GlobalWorkerOptions.workerSrc = pdfWorker;

const getDefaultScene = () => ({
  elements: [],
  appState: { viewBackgroundColor: "#f8fafc" },
  files: {},
});

const WRONG_STEP_MATCHER =
  /\b(wrong|incorrect|mistake|error|invalid|not correct|don't|do not|avoid)\b/i;

const pickProblemBucket = (value, problemIndex) => {
  if (!value) return null;
  if (Array.isArray(value)) return value[problemIndex - 1] ?? null;
  if (typeof value === "object") {
    return value[problemIndex] ?? value[String(problemIndex)] ?? null;
  }
  return null;
};

const extractInsightEntries = (value, forcedKind = null) => {
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

const classifyInsightKind = (entry) => {
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

const parseInsightsForProblem = (assignment, problemIndex) => {
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



const escapeHtml = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const LATEX_SEGMENT_PATTERN =
  /(\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\$[^$\n]+?\$)/g;

const renderMathSegment = (segment) => {
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

const renderLatexTextToHtml = (value) => {
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

const LatexText = ({ text, as: Element = "span", className = "" }) => (
  <Element
    className={className}
    dangerouslySetInnerHTML={{
      __html: renderLatexTextToHtml(text),
    }}
  />
);

const deriveInsightsFromAiResult = (result, requestedMode) => {
  const entries = [];

  const toEntries = (items, kind) =>
    Array.isArray(items)
      ? items
          .map((item) => String(item || "").trim())
          .filter(Boolean)
          .map((content) => ({ kind, content }))
      : [];

  entries.push(...toEntries(result?.hints, "hint"));
  entries.push(...toEntries(result?.errors || result?.wrong || result?.mistakes, "wrong"));

  const directMessage =
    result?.explanation ||
    result?.hint ||
    result?.result ||
    result?.message ||
    result?.answer ||
    result?.value ||
    "";

  if (String(directMessage).trim() && requestedMode !== "calculate") {
    entries.push({
      kind: "hint",
      content: String(directMessage).trim(),
    });
  }

  return entries.map((entry, index) => ({
    id: "ai-" + Date.now() + "-" + index,
    kind: entry.kind,
    content: entry.content,
  }));
};

const readCalcValueFromAiResult = (result) => {
  const raw = result?.value || result?.answer || result?.result || result?.message || "";
  return String(raw || "").trim();
};

const readCalcMessageFromAiResult = (result) => {
  return String(result?.message || "").trim();
};

const readExplainTextFromAiResult = (result) => {
  const raw = result?.explanation || result?.hint || result?.message || result?.result || "";
  return String(raw || "").trim();
};

const getPersistedScene = (scene) => {
  const normalizedElements = Array.isArray(scene?.elements) ? scene.elements : [];
  const normalizedFiles =
    scene?.files && typeof scene.files === "object" && !Array.isArray(scene.files)
      ? scene.files
      : {};
  const viewBackgroundColor =
    typeof scene?.appState?.viewBackgroundColor === "string"
      ? scene.appState.viewBackgroundColor
      : "#f8fafc";

  return {
    elements: normalizedElements,
    appState: { viewBackgroundColor },
    files: normalizedFiles,
  };
};

const formatDate = (time) => new Date(time).toLocaleString();

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const WHITEBOARD_EXPORT_SCALE = 4;
const WHITEBOARD_MIN_DIMENSION = 1400;
const PDF_RENDER_SCALE = 2.5;
const PDF_MAX_WIDTH = 2400;
const PROBLEM_CROP_SCALE = 2;
const MAX_HINT_ITEMS = 3;
const MAX_ERROR_ITEMS = 3;
const MAX_CALCULATE_RESULTS = 1;
const MAX_EXPLAIN_RESULTS = 1;

const mergeLimitedInsights = (previous, incoming) => {
  const merged = [...previous, ...incoming];
  let hintCount = 0;
  let errorCount = 0;
  const retainedIndexes = new Set();

  for (let index = merged.length - 1; index >= 0; index -= 1) {
    const entry = merged[index];
    if (entry.kind === "wrong") {
      if (errorCount >= MAX_ERROR_ITEMS) continue;
      errorCount += 1;
      retainedIndexes.add(index);
      continue;
    }

    if (hintCount >= MAX_HINT_ITEMS) continue;
    hintCount += 1;
    retainedIndexes.add(index);
  }

  return merged.filter((_, index) => retainedIndexes.has(index));
};
const normalizeProblemCount = (value) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return MIN_PROBLEM_COUNT;
  return clamp(parsed, MIN_PROBLEM_COUNT, MAX_PROBLEM_COUNT);
};
const buildProblemIndexes = (problemCount) =>
  Array.from({ length: normalizeProblemCount(problemCount) }, (_value, index) => index + 1);

const upscaleCanvasToMinDimension = (canvas, minDimension = WHITEBOARD_MIN_DIMENSION) => {
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

const createCroppedImageBlob = async (sourceUrl, cropArea) => {
  const image = await new Promise((resolve, reject) => {
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

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Unable to export cropped problem image.");
  return blob;
};

const parseRoute = (path) => {
  if (path === "/login") return { name: "login" };
  if (path === "/assignments") return { name: "assignments" };

  const problemMatch = path.match(/^\/assignments\/([^/]+)\/problems\/([1-9]\d*)$/);
  if (problemMatch) {
    return {
      name: "problem-board",
      assignmentId: decodeURIComponent(problemMatch[1]),
      problemIndex: Number(problemMatch[2]),
    };
  }

  const detailMatch = path.match(/^\/assignments\/([^/]+)$/);
  if (detailMatch) {
    return {
      name: "assignment-detail",
      assignmentId: decodeURIComponent(detailMatch[1]),
    };
  }

  return { name: "unknown" };
};

function LoginPage({ authMessage }) {
  const handleGoogleSignIn = () => {
    window.location.assign(getGoogleSignInUrl());
  };

  return (
    <section className="auth-card">
      <p className="eyebrow">StepWise</p>
      <h1>Sign in to Dashboard</h1>
      <p className="subtle">Access assignments, uploads, and problem whiteboards.</p>

      <div className="auth-block">
        <h2>Google Sign-In (Server OAuth)</h2>
        <button type="button" onClick={handleGoogleSignIn}>
          Continue with Google
        </button>
        <p className="subtle">
          You will be redirected to Google and back to this app after sign-in.
        </p>
      </div>

      {authMessage && <p className="error-text">{authMessage}</p>}
    </section>
  );
}

function AssignmentsPage({ user, navigate, onSignOut, onDeleteAccount }) {
  const [assignments, setAssignments] = useState([]);
  const [title, setTitle] = useState("");
  const [problemCount, setProblemCount] = useState(String(MIN_PROBLEM_COUNT));
  const [status, setStatus] = useState("Loading assignments...");

  const loadAssignments = useCallback(async () => {
    const data = await listAssignments();
    setAssignments(data);
    setStatus(data.length === 0 ? "No assignments yet." : `${data.length} assignments found.`);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadAssignments();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadAssignments]);

  const handleCreate = async (event) => {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) {
      setStatus("Assignment title is required.");
      return;
    }
    const parsedCount = Number(problemCount);
    if (
      !Number.isInteger(parsedCount) ||
      parsedCount < MIN_PROBLEM_COUNT ||
      parsedCount > MAX_PROBLEM_COUNT
    ) {
      setStatus(`Problem count must be between ${MIN_PROBLEM_COUNT} and ${MAX_PROBLEM_COUNT}.`);
      return;
    }

    await createAssignment(trimmed, parsedCount);
    setTitle("");
    setProblemCount(String(MIN_PROBLEM_COUNT));
    await loadAssignments();
  };

  const handleDelete = async (assignmentId, assignmentTitle) => {
    const shouldDelete = window.confirm(`Delete assignment "${assignmentTitle}"?`);
    if (!shouldDelete) return;
    await deleteAssignment(assignmentId);
    await loadAssignments();
  };

  return (
    <>
      <header className="topbar">
        <div>
          <p className="eyebrow">Dashboard</p>
          <h1>{user.name}'s Assignments</h1>
        </div>
        <div className="topbar-actions">
          <p className="status-pill">{status}</p>
          <button type="button" className="danger" onClick={onDeleteAccount}>
            Delete Account
          </button>
          <button type="button" className="outline" onClick={onSignOut}>
            Sign Out
          </button>
        </div>
      </header>

      <section className="panel">
        <form className="control-row" onSubmit={handleCreate}>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="New assignment title"
            aria-label="New assignment title"
          />
          <input
            type="number"
            min={MIN_PROBLEM_COUNT}
            max={MAX_PROBLEM_COUNT}
            value={problemCount}
            onChange={(event) => setProblemCount(event.target.value)}
            placeholder="Problems (1-60)"
            aria-label="Number of problems"
          />
          <button type="submit">Create Assignment</button>
        </form>
      </section>

      <section className="grid-list">
        {assignments.map((assignment) => (
          <article key={assignment.id} className="assignment-card">
            <h2>{assignment.title}</h2>
            <p>Problems: {normalizeProblemCount(assignment.problemCount)}</p>
            <p>Updated: {formatDate(assignment.updatedAt)}</p>
            <div className="card-actions">
              <button type="button" onClick={() => navigate(`/assignments/${assignment.id}`)}>
                Open
              </button>
              <button
                type="button"
                className="danger"
                onClick={() => handleDelete(assignment.id, assignment.title)}
              >
                Delete
              </button>
            </div>
          </article>
        ))}
      </section>
    </>
  );
}

function AssignmentDetailPage({ assignmentId, navigate }) {
  const [assignment, setAssignment] = useState(null);
  const [fileRecord, setFileRecord] = useState(null);
  const [status, setStatus] = useState("Loading assignment...");

  const load = useCallback(async () => {
    try {
      const target = await getAssignmentById(assignmentId);
      const file = await getAssignmentPdf(assignmentId);
      setAssignment(target);
      setFileRecord(file || null);
      setStatus("Assignment loaded.");
    } catch {
      setStatus("Assignment not found.");
      setAssignment(null);
    }
  }, [assignmentId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const handleUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.type !== "application/pdf") {
      setStatus("Please upload a PDF file.");
      return;
    }
    if (file.size > MAX_PDF_BYTES) {
      setStatus("PDF exceeds the 20MB upload limit.");
      return;
    }

    await saveAssignmentPdf(assignmentId, file);
    setStatus(`Uploaded ${file.name}.`);
    await load();
  };

  const handleOpenPdf = async () => {
    const url = await getAssignmentPdfDownloadUrl(assignmentId);
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const handleRemovePdf = async () => {
    await deleteAssignmentPdf(assignmentId);
    setStatus("Removed uploaded PDF.");
    await load();
  };

  const handleDeleteAssignment = async () => {
    if (!assignment) return;
    const shouldDelete = window.confirm(`Delete assignment "${assignment.title}"?`);
    if (!shouldDelete) return;

    await deleteAssignment(assignment.id);
    navigate("/assignments");
  };
  const problemIndexes = buildProblemIndexes(assignment?.problemCount);

  const handleAddProblem = async () => {
    if (!assignment) return;
    const nextAssignment = await addProblemToAssignment(assignment.id);
    setAssignment(nextAssignment);
    setStatus(`Added problem ${nextAssignment.problemCount}.`);
  };

  const handleDeleteLastProblem = async () => {
    if (!assignment) return;
    const shouldDelete = window.confirm(
      `Delete Problem ${assignment.problemCount}? This removes its saved whiteboard and image.`,
    );
    if (!shouldDelete) return;

    const result = await deleteLastProblemFromAssignment(assignment.id);
    setAssignment(result.assignment);
    setStatus(
      result.removedArtifacts
        ? `Deleted Problem ${result.removedProblemIndex} and removed its saved data.`
        : `Deleted Problem ${result.removedProblemIndex}.`,
    );
  };

  if (!assignment) {
    return (
      <section className="panel">
        <p>{status}</p>
        <button type="button" onClick={() => navigate("/assignments")}>
          Back to Assignments
        </button>
      </section>
    );
  }

  return (
    <>
      <header className="topbar">
        <div>
          <p className="eyebrow">Assignment</p>
          <h1>{assignment.title}</h1>
        </div>
        <div className="topbar-actions">
          <p className="status-pill">{status}</p>
          <button type="button" className="outline" onClick={() => navigate("/assignments")}>
            Back
          </button>
        </div>
      </header>

      <section className="panel">
        <h2>Problem Sheet Upload</h2>
        <div className="control-row">
          <input type="file" accept="application/pdf" onChange={handleUpload} />
          {fileRecord && (
            <>
              <button type="button" onClick={handleOpenPdf}>
                Open PDF
              </button>
              <button type="button" className="danger" onClick={handleRemovePdf}>
                Remove PDF
              </button>
            </>
          )}
        </div>
        {fileRecord ? (
          <p className="subtle">
            {fileRecord.fileName} ({Math.round(fileRecord.size / 1024)} KB) - uploaded {formatDate(fileRecord.uploadedAt)}
          </p>
        ) : (
          <p className="subtle">No PDF uploaded yet.</p>
        )}
      </section>

      <section className="panel">
        <h2>Problems</h2>
        <div className="control-row">
          <button
            type="button"
            onClick={() => void handleAddProblem()}
            disabled={normalizeProblemCount(assignment.problemCount) >= MAX_PROBLEM_COUNT}
          >
            Add Problem
          </button>
          <button
            type="button"
            className="danger"
            onClick={() => void handleDeleteLastProblem()}
            disabled={normalizeProblemCount(assignment.problemCount) <= MIN_PROBLEM_COUNT}
          >
            Delete Last Problem
          </button>
          <p className="subtle">Total: {normalizeProblemCount(assignment.problemCount)}</p>
        </div>
        <p className="warning-text">
          Warning: Deleting the last problem permanently removes its saved whiteboard and image.
        </p>
        <div className="grid-list problem-grid">
          {problemIndexes.map((problemIndex) => (
            <article key={problemIndex} className="assignment-card">
              <h3>Problem {problemIndex}</h3>
              <p>Opens a dedicated whiteboard session.</p>
              <button
                type="button"
                onClick={() => navigate(`/assignments/${assignmentId}/problems/${problemIndex}`)}
              >
                Open Whiteboard
              </button>
            </article>
          ))}
        </div>
      </section>

      <section className="panel">
        <button type="button" className="danger" onClick={handleDeleteAssignment}>
          Delete Assignment
        </button>
      </section>
    </>
  );
}

function ProblemBoardPage({ assignmentId, problemIndex, navigate }) {
  const [assignment, setAssignment] = useState(null);
  const [status, setStatus] = useState("Loading whiteboard...");
  const [, setHint] = useState("Start drawing to receive hints.");
  const [initialScene, setInitialScene] = useState(getDefaultScene());
  const latestSceneRef = useRef(getDefaultScene());
  const insights = useMemo(
    () => parseInsightsForProblem(assignment, problemIndex),
    [assignment, problemIndex],
  );
  const [manualInsights, setManualInsights] = useState([]);
  const combinedInsights = useMemo(
    () => [...insights, ...manualInsights],
    [insights, manualInsights],
  );
  const hintInsights = useMemo(
    () => combinedInsights.filter((entry) => entry.kind === "hint").slice(-MAX_HINT_ITEMS),
    [combinedInsights],
  );
  const wrongInsights = useMemo(
    () => combinedInsights.filter((entry) => entry.kind === "wrong").slice(-MAX_ERROR_ITEMS),
    [combinedInsights],
  );
  const [sceneRevision, setSceneRevision] = useState(0);
  const [problemImageMeta, setProblemImageMeta] = useState(null);
  const [problemImageUrl, setProblemImageUrl] = useState("");
  const [problemContextMeta, setProblemContextMeta] = useState(null);
  const [answerKeyDraft, setAnswerKeyDraft] = useState("");
  const [isSavingAnswerKey, setIsSavingAnswerKey] = useState(false);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [pickerStatus, setPickerStatus] = useState("");
  const [pdfPageCount, setPdfPageCount] = useState(0);
  const [selectedPage, setSelectedPage] = useState(1);
  const [pageImageUrl, setPageImageUrl] = useState("");
  const [selectionRect, setSelectionRect] = useState(null);
  const [isSelecting, setIsSelecting] = useState(false);
  const [isRenderingPage, setIsRenderingPage] = useState(false);
  const [isSavingProblemImage, setIsSavingProblemImage] = useState(false);
<<<<<<< HEAD:src/App.jsx
  const [aspectRatio, setAspectRatio] = useState(4 / 3);
  const [ratioWidth, setRatioWidth] = useState(4);
  const [ratioHeight, setRatioHeight] = useState(3);
=======
  const [selectionMode, setSelectionMode] = useState(null);
  const [boardSelectionRect, setBoardSelectionRect] = useState(null);
  const [isBoardSelecting, setIsBoardSelecting] = useState(false);
  const [isAiSelecting, setIsAiSelecting] = useState(false);
  const [selectionResults, setSelectionResults] = useState([]);
  const [isStylePanelOpen, setIsStylePanelOpen] = useState(true);
>>>>>>> design-workcopy:src/imports/App.jsx
  const analyzeTimerRef = useRef(null);
  const lastSnapshotRef = useRef(null);
  const pdfDocumentRef = useRef(null);
  const problemImageUrlRef = useRef("");
  const pageImageUrlRef = useRef("");
  const cropImageRef = useRef(null);
  const dragStartRef = useRef(null);
  const whiteboardAreaRef = useRef(null);
  const boardSelectionStartRef = useRef(null);
  const hintLevelRef = useRef(1);
  const previousHintsRef = useRef([]);

  const clearProblemImageUrl = useCallback(() => {
    if (!problemImageUrlRef.current) return;
    URL.revokeObjectURL(problemImageUrlRef.current);
    problemImageUrlRef.current = "";
    setProblemImageUrl("");
  }, []);

  const clearPageImageUrl = useCallback(() => {
    if (!pageImageUrlRef.current) return;
    URL.revokeObjectURL(pageImageUrlRef.current);
    pageImageUrlRef.current = "";
    setPageImageUrl("");
  }, []);

  const loadProblemImage = useCallback(async () => {
    const metadata = await getProblemImage(assignmentId, problemIndex);
    if (!metadata) {
      setProblemImageMeta(null);
      clearProblemImageUrl();
      return;
    }

    const blob = await downloadProblemImageBlob(assignmentId, problemIndex);
    const objectUrl = URL.createObjectURL(blob);
    if (problemImageUrlRef.current) {
      URL.revokeObjectURL(problemImageUrlRef.current);
    }
    problemImageUrlRef.current = objectUrl;
    setProblemImageMeta(metadata);
    setProblemImageUrl(objectUrl);
  }, [assignmentId, clearProblemImageUrl, problemIndex]);

  const loadProblemContext = useCallback(async () => {
    const context = await getProblemContext(assignmentId, problemIndex);
    setProblemContextMeta(context);
    setAnswerKeyDraft(context?.answerKey || "");
  }, [assignmentId, problemIndex]);

  const closePicker = useCallback(() => {
    setIsPickerOpen(false);
    setPickerStatus("");
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
    async (pdfDocument, pageNumber) => {
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
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
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
    (blob) =>
      new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.readAsDataURL(blob);
      }),
    [],
  );

  const analyzeSceneForHint = useCallback(
    async (elements, appState, files) => {
      if (elements.length === 0) {
        setHint("Start drawing to receive hints.");
        return;
      }

      const canvas = await exportToCanvas({
        elements,
        appState,
        files,
        exportScale: WHITEBOARD_EXPORT_SCALE,
      });

      const exportCanvas = upscaleCanvasToMinDimension(canvas);

      const blob = await new Promise((resolve) => exportCanvas.toBlob(resolve, "image/png"));
      if (!blob) return;

      const base64 = await blobToBase64(blob);
      if (base64 === lastSnapshotRef.current) return;
      lastSnapshotRef.current = base64;

      setHint("Generating hint...");
      try {
        const result = await analyzeDrawing(blob, {
          assignmentId,
          problemIndex,
          problemImageUrl,
          hintLevel: hintLevelRef.current,
          previousHints: previousHintsRef.current,
        });

        const nextInsights = deriveInsightsFromAiResult(result, "explain");
        const newHintTexts = nextInsights
          .filter((e) => e.kind === "hint")
          .map((e) => e.content);
        if (newHintTexts.length > 0) {
          previousHintsRef.current = [...previousHintsRef.current, ...newHintTexts].slice(-5);
          hintLevelRef.current = Math.min(4, hintLevelRef.current + 1);
        }
        if (nextInsights.length > 0) {
          setManualInsights((previous) => mergeLimitedInsights(previous, nextInsights));
        }

        setHint("AI feedback updated.");
      } catch {
        setHint("Hint service unavailable.");
      }
    },
    [assignmentId, blobToBase64, problemImageUrl, problemIndex],
  );

  const handleChange = useCallback((elements, appState, files) => {
    latestSceneRef.current = getPersistedScene({ elements, appState, files });
    if (analyzeTimerRef.current) {
      window.clearTimeout(analyzeTimerRef.current);
    }
    analyzeTimerRef.current = window.setTimeout(() => {
      void analyzeSceneForHint(elements, appState, files);
    }, 3000);
  }, [analyzeSceneForHint]);

  useEffect(
    () => () => {
      if (analyzeTimerRef.current) {
        window.clearTimeout(analyzeTimerRef.current);
      }

      if (problemImageUrlRef.current) {
        URL.revokeObjectURL(problemImageUrlRef.current);
        problemImageUrlRef.current = "";
      }
      if (pageImageUrlRef.current) {
        URL.revokeObjectURL(pageImageUrlRef.current);
        pageImageUrlRef.current = "";
      }
      const currentPdf = pdfDocumentRef.current;
      pdfDocumentRef.current = null;
      if (currentPdf?.destroy) {
        void currentPdf.destroy();
      }
    },
    [],
  );

  const handleSave = async () => {
    await saveProblemScene(assignmentId, problemIndex, latestSceneRef.current);
    setStatus(`Saved at ${new Date().toLocaleTimeString()}.`);
  };

  const handleOpenPicker = async () => {
    setIsPickerOpen(true);
    setPickerStatus("Loading PDF...");
    try {
      const pdfBlob = await downloadAssignmentPdfBlob(assignmentId);
      const bytes = await pdfBlob.arrayBuffer();
      const loadingTask = getDocument({ data: new Uint8Array(bytes) });
      const pdfDocument = await loadingTask.promise;
      pdfDocumentRef.current = pdfDocument;
      setPdfPageCount(pdfDocument.numPages);
      setSelectedPage(1);
      await renderSelectedPage(pdfDocument, 1);
    } catch {
      setPickerStatus("Unable to open PDF. Upload a PDF first.");
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

  const handlePageChange = async (value) => {
    const nextPage = clamp(Number(value) || 1, 1, pdfPageCount || 1);
    setSelectedPage(nextPage);
    if (pdfDocumentRef.current) {
      await renderSelectedPage(pdfDocumentRef.current, nextPage);
    }
  };

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

  const handleSelectionStart = (event) => {
    if (!cropImageRef.current || !pageImageUrl) return;
    const imageRect = cropImageRef.current.getBoundingClientRect();
    const startX = clamp(event.clientX - imageRect.left, 0, imageRect.width);
    const startY = clamp(event.clientY - imageRect.top, 0, imageRect.height);

    dragStartRef.current = { x: startX, y: startY };
    setSelectionRect({ x: startX, y: startY, width: 0, height: 0 });
    setIsSelecting(true);
    setPickerStatus("Selecting crop area...");
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleSelectionMove = (event) => {
    if (!isSelecting || !dragStartRef.current || !cropImageRef.current) return;
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

  const handleSelectionEnd = (event) => {
    if (!isSelecting) return;
    setIsSelecting(false);
    dragStartRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
    setSelectionRect((currentRect) => {
      if (!currentRect || currentRect.width < 6 || currentRect.height < 6) {
        setPickerStatus("Selection too small. Drag a larger area.");
        return null;
      }
      setPickerStatus("Selection ready. Save cropped image.");
      return currentRect;
    });
  };

  const appendLimitedInsights = useCallback((incomingInsights) => {
    setManualInsights((previous) => mergeLimitedInsights(previous, incomingInsights));
  }, []);

  const appendLimitedSelectionResult = useCallback((incomingResult) => {
    setSelectionResults((previous) => {
      const merged = [incomingResult, ...previous];
      let explainCount = 0;
      let calculateCount = 0;

      return merged.filter((entry) => {
        if (entry.mode === "explain") {
          if (explainCount >= MAX_EXPLAIN_RESULTS) return false;
          explainCount += 1;
          return true;
        }

        if (entry.mode === "calculate") {
          if (calculateCount >= MAX_CALCULATE_RESULTS) return false;
          calculateCount += 1;
          return true;
        }

        return false;
      });
    });
  }, []);

  const startSelectionTool = (mode) => {
    setSelectionMode(mode);
    setBoardSelectionRect(null);
    setHint(
      mode === "calculate"
        ? "Draw a blue rectangle to calculate the selected expression."
        : "Draw a yellow rectangle to explain the selected area.",
    );
  };

  const runSelectionAnalysis = useCallback(
    async (selectionRect, mode, bounds) => {
      const scene = latestSceneRef.current || getDefaultScene();
      if (!scene.elements?.length) {
        setHint("Draw something first, then use a selection tool.");
        return;
      }

      setIsAiSelecting(true);
      try {
        const exportedCanvas = await exportToCanvas({
          elements: scene.elements,
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
        const cropBlob = await new Promise((resolve) =>
          exportCropCanvas.toBlob(resolve, "image/png"),
        );
        if (!cropBlob) throw new Error("Unable to export selected area.");

        const result = await analyzeDrawing(cropBlob, {
          assignmentId,
          problemIndex,
          problemImageUrl,
          mode,
        });

        const newInsights = deriveInsightsFromAiResult(result, mode);
        if (newInsights.length > 0) {
          appendLimitedInsights(newInsights);
        }

        if (mode === "calculate") {
          const value = readCalcValueFromAiResult(result);
          if (value) {
            appendLimitedSelectionResult({
              id: "result-" + Date.now(),
              mode: "calculate",
              cardText: `Your calculated result is ${value}`,
            });
          } else {
            const message = readCalcMessageFromAiResult(result);
            if (message) {
              appendLimitedSelectionResult({
                id: "result-" + Date.now(),
                mode: "calculate",
                cardText: message,
              });
            }
          }
          setHint("Calculation complete.");
        } else {
          const explanation = readExplainTextFromAiResult(result);
          if (explanation) {
            appendLimitedSelectionResult({
              id: "result-" + Date.now(),
              mode: "explain",
              cardText: explanation,
            });
          }
          setHint("Explanation ready.");
        }
      } catch {
        setHint("AI selection request failed.");
      } finally {
        setIsAiSelecting(false);
      }
    },
    [appendLimitedInsights, appendLimitedSelectionResult, assignmentId, problemImageUrl, problemIndex],
  );

  const handleAiSelectionStart = (event) => {
    if (!selectionMode || !whiteboardAreaRef.current) return;
    const bounds = whiteboardAreaRef.current.getBoundingClientRect();
    const startX = clamp(event.clientX - bounds.left, 0, bounds.width);
    const startY = clamp(event.clientY - bounds.top, 0, bounds.height);

    boardSelectionStartRef.current = { x: startX, y: startY, width: bounds.width, height: bounds.height };
    setBoardSelectionRect({ x: startX, y: startY, width: 0, height: 0 });
    setIsBoardSelecting(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleAiSelectionMove = (event) => {
    if (!isBoardSelecting || !boardSelectionStartRef.current || !whiteboardAreaRef.current) return;
    const bounds = whiteboardAreaRef.current.getBoundingClientRect();
    const nextX = clamp(event.clientX - bounds.left, 0, bounds.width);
    const nextY = clamp(event.clientY - bounds.top, 0, bounds.height);
    const startX = boardSelectionStartRef.current.x;
    const startY = boardSelectionStartRef.current.y;

    setBoardSelectionRect({
      x: Math.min(startX, nextX),
      y: Math.min(startY, nextY),
      width: Math.abs(nextX - startX),
      height: Math.abs(nextY - startY),
    });
  };

  const handleAiSelectionEnd = async (event) => {
    if (!isBoardSelecting) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    setIsBoardSelecting(false);

    const selection = boardSelectionRect;
    const startMeta = boardSelectionStartRef.current;
    boardSelectionStartRef.current = null;

    if (!selection || selection.width < 8 || selection.height < 8 || !startMeta) {
      setBoardSelectionRect(null);
      return;
    }

    const mode = selectionMode;
    setSelectionMode(null);
    await runSelectionAnalysis(selection, mode, {
      width: startMeta.width,
      height: startMeta.height,
    });
    setBoardSelectionRect(null);
  };
  const handleRemoveProblemImage = async () => {
    await deleteProblemImage(assignmentId, problemIndex);
    setProblemImageMeta(null);
    clearProblemImageUrl();
    setStatus("Removed problem image.");
  };

  if (!assignment) {
    return (
      <section className="panel">
        <p>{status}</p>
        <button type="button" onClick={() => navigate("/assignments")}>Go to Assignments</button>
      </section>
    );
  }

  if (problemIndex > normalizeProblemCount(assignment.problemCount)) {
    return (
      <section className="panel">
        <p>{status}</p>
        <button type="button" onClick={() => navigate(`/assignments/${assignmentId}`)}>
          Back to Assignment
        </button>
      </section>
    );
  }

  return (
    <>
      <header className="topbar">
        <div>
          <p className="eyebrow">Whiteboard</p>
          <h1>{assignment.title} - Problem {problemIndex}</h1>
        </div>
        <div className="topbar-actions">
          <p className="status-pill">{status}</p>
          <div className="selection-tool-row" aria-label="AI selection tools">
            <button
              type="button"
              className={`selection-tool-btn selection-tool-btn-blue ${selectionMode === "calculate" ? "selection-tool-btn-active" : ""}`}
              onClick={() => startSelectionTool("calculate")}
              disabled={isAiSelecting}
            >
              Calc
            </button>
            <button
              type="button"
              className={`selection-tool-btn selection-tool-btn-yellow ${selectionMode === "explain" ? "selection-tool-btn-active" : ""}`}
              onClick={() => startSelectionTool("explain")}
              disabled={isAiSelecting}
            >
              Explain
            </button>
          </div>
          <div className="topbar-right-actions">
            <button type="button" onClick={handleSave}>Save Drawing</button>
            <button
              type="button"
              className="outline"
              onClick={() => navigate(`/assignments/${assignmentId}`)}
            >
              Back
            </button>
          </div>
          <p className="subtle ai-selection-note">
            For Calc/Explain, first choose the tool, then drag on the whiteboard to select a portion.
          </p>
        </div>
      </header>

      <section className="panel">
        <h2>Problem Image</h2>
        <div className="control-row">
          <button type="button" onClick={() => void handleOpenPicker()}>
            {problemImageMeta ? "Replace from PDF" : "Select from PDF"}
          </button>
          {problemImageMeta && (
            <button type="button" className="danger" onClick={() => void handleRemoveProblemImage()}>
              Remove Image
            </button>
          )}
        </div>
        {problemImageMeta ? (
          <>
            <p className="subtle">
              Updated {formatDate(problemImageMeta.updatedAt)}
            </p>
            {problemImageUrl && (
              <img
                className="problem-image-preview"
                src={problemImageUrl}
                alt={`Problem ${problemIndex}`}
              />
            )}
          </>
        ) : (
          <p className="subtle">No problem image selected yet.</p>
        )}
      </section>

      <section className="whiteboard-stage">
        <section className={`canvas-area ${isStylePanelOpen ? "" : "style-panel-hidden"}`} ref={whiteboardAreaRef}>
          <button
            type="button"
            className="style-panel-toggle"
            onClick={() => setIsStylePanelOpen((current) => !current)}
            aria-expanded={isStylePanelOpen}
          >
            Styles {isStylePanelOpen ? "v" : ">"}
          </button>

          <Excalidraw
            key={`${assignmentId}-${problemIndex}-${sceneRevision}`}
            initialData={initialScene}
            onChange={handleChange}
            UIOptions={{
              canvasActions: {
                export: { saveFileToDisk: true },
                saveToActiveFile: false,
                loadScene: false,
              },
            }}
          >
            <MainMenu>
              <MainMenu.DefaultItems.Export />
              <MainMenu.DefaultItems.SaveAsImage />
              <MainMenu.DefaultItems.SearchMenu />
              <MainMenu.DefaultItems.Help />
              <MainMenu.DefaultItems.ClearCanvas />
              <MainMenu.Separator />
              <MainMenu.DefaultItems.ToggleTheme />
              <MainMenu.DefaultItems.ChangeCanvasBackground />
            </MainMenu>
          </Excalidraw>

          {selectionMode && (
            <div
              className={`ai-select-layer ai-select-layer-${selectionMode}`}
              onPointerDown={handleAiSelectionStart}
              onPointerMove={handleAiSelectionMove}
              onPointerUp={handleAiSelectionEnd}
              onPointerCancel={handleAiSelectionEnd}
            >
              {boardSelectionRect && (
                <div
                  className="ai-select-rect"
                  style={{
                    left: `${boardSelectionRect.x}px`,
                    top: `${boardSelectionRect.y}px`,
                    width: `${boardSelectionRect.width}px`,
                    height: `${boardSelectionRect.height}px`,
                  }}
                />
              )}
            </div>
          )}
        </section>

        <aside className="insights-rail">
          <section className="insights-panel" aria-label="AI Study Buddy">
            <h2>AI Study Buddy</h2>

            <div className="insight-group">
              <h3>Hints</h3>
              {hintInsights.length > 0 ? (
                hintInsights.map((entry, index) => (
                  <details key={entry.id} className="insight-item insight-item-hint">
                    <summary>{`Hint ${index + 1}`}</summary>
                    <LatexText as="p" text={entry.content} />
                  </details>
                ))
              ) : (
                <p className="subtle">No hints yet.</p>
              )}
            </div>

            {selectionResults.length > 0 && (
              <section className="selection-results" aria-label="Selection results">
                {selectionResults.map((entry) => (
                  <div
                    key={entry.id}
                    className={`selection-result-card selection-result-card-${entry.mode}`}
                  >
                    <LatexText as="div" text={entry.cardText} />
                  </div>
                ))}
              </section>
            )}

            <div className="insight-group">
              <h3>Errors</h3>
              {wrongInsights.length > 0 ? (
                wrongInsights.map((entry, index) => (
                  <details key={entry.id} className="insight-item insight-item-wrong">
                    <summary>{`Error ${index + 1}`}</summary>
                    <LatexText as="p" text={entry.content} />
                  </details>
                ))
              ) : (
                <p className="subtle">No errors yet.</p>
              )}
            </div>
          </section>
        </aside>
      </section>

      <section className="panel">
        <h2>Answer Key</h2>
        <p className="subtle">
          Optional. If provided, the AI uses it to validate generated solutions and hints.
        </p>
        <div className="answer-key-editor">
          <textarea
            value={answerKeyDraft}
            onChange={(event) => setAnswerKeyDraft(event.target.value)}
            placeholder="Example: Final answer is $x = 4$. Accept equivalent simplified forms only."
            rows={4}
          />
          <div className="control-row">
            <button
              type="button"
              onClick={() => void handleSaveAnswerKey()}
              disabled={isSavingAnswerKey}
            >
              {isSavingAnswerKey ? "Saving..." : "Save Answer Key"}
            </button>
            {problemContextMeta?.updatedAt ? (
              <p className="subtle">Updated {formatDate(problemContextMeta.updatedAt)}</p>
            ) : null}
          </div>
        </div>
      </section>

      {isPickerOpen && (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <section className="panel picker-panel">
            <h2>Select Problem Area</h2>
            <div className="control-row">
              <button
                type="button"
                className="outline"
                onClick={() => void handlePageChange(selectedPage - 1)}
                disabled={selectedPage <= 1 || isRenderingPage}
              >
                Previous Page
              </button>
              <label className="picker-label">
                Page
                <input
                  type="number"
                  min={1}
                  max={pdfPageCount || 1}
                  value={selectedPage}
                  onChange={(event) => void handlePageChange(event.target.value)}
                  disabled={!pdfPageCount || isRenderingPage}
                />
              </label>
              <span className="subtle">of {pdfPageCount || "-"}</span>
              <button
                type="button"
                className="outline"
                onClick={() => void handlePageChange(selectedPage + 1)}
                disabled={!pdfPageCount || selectedPage >= pdfPageCount || isRenderingPage}
              >
                Next Page
              </button>
            </div>

            <div className="picker-crop-shell">
              {pageImageUrl ? (
                <div className="picker-image-stage">
                  <img
                    ref={cropImageRef}
                    className="picker-crop-image"
                    src={pageImageUrl}
                    alt={`PDF page ${selectedPage}`}
                    draggable={false}
                    onPointerDown={handleSelectionStart}
                    onPointerMove={handleSelectionMove}
                    onPointerUp={handleSelectionEnd}
                    onPointerCancel={handleSelectionEnd}
                    onPointerLeave={handleSelectionEnd}
                  />
                  {selectionRect && (
                    <div
                      className="picker-selection"
                      style={{
                        left: `${selectionRect.x}px`,
                        top: `${selectionRect.y}px`,
                        width: `${selectionRect.width}px`,
                        height: `${selectionRect.height}px`,
                      }}
                    />
                  )}
                </div>
              ) : (
                <p className="subtle">Rendering selected page...</p>
              )}
            </div>
            <p className="subtle">Drag on the page image to choose the exact crop area.</p>
            <p className="subtle">{pickerStatus}</p>
            <div className="control-row">
              <button
                type="button"
                onClick={() => void handleSaveProblemImage()}
                disabled={isSavingProblemImage || isRenderingPage || !pageImageUrl}
              >
                {isSavingProblemImage ? "Saving..." : "Save Cropped Image"}
              </button>
              <button type="button" className="outline" onClick={closePicker}>
                Cancel
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

function App() {
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [authMessage, setAuthMessage] = useState("");
  const [path, setPath] = useState(() => window.location.pathname || "/login");

  const navigate = useCallback((nextPath, replace = false) => {
    if (replace) {
      window.history.replaceState({}, "", nextPath);
    } else {
      window.history.pushState({}, "", nextPath);
    }
    setPath(nextPath);
  }, []);

  useEffect(() => {
    const onPopState = () => setPath(window.location.pathname || "/login");
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    getCurrentUser()
      .then((currentUser) => {
        setUser(currentUser);
      })
      .catch(() => {
        setAuthMessage("Unable to validate your session. Please sign in again.");
      })
      .finally(() => {
        setAuthReady(true);
      });
  }, []);

  useEffect(() => {
    if (!authReady) return;
    let timer = null;
    if (!user && path !== "/login") {
      timer = window.setTimeout(() => navigate("/login", true), 0);
      return;
    }
    if (user && (path === "/" || path === "/login")) {
      timer = window.setTimeout(() => navigate("/assignments", true), 0);
    }
    return () => {
      if (timer) window.clearTimeout(timer);
    };
  }, [authReady, navigate, path, user]);

  const route = useMemo(() => parseRoute(path), [path]);

  const handleSignOut = useCallback(async () => {
    const { logoutUrl } = await signOut();
    if (logoutUrl) {
      window.location.assign(logoutUrl);
      return;
    }
    setUser(null);
    navigate("/login", true);
  }, [navigate]);

  const handleDeleteAccount = useCallback(async () => {
    const shouldDelete = window.confirm(
      "Delete your account? This will remove your assignments and uploaded files.",
    );
    if (!shouldDelete) return;
    await requestAccountDeletion();
    setUser(null);
    setAuthMessage("Your account deletion request has been submitted.");
    navigate("/login", true);
  }, [navigate]);

  if (!authReady) {
    return (
      <main className="app-shell">
        <section className="panel">
          <p>Checking session...</p>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      {route.name === "login" && <LoginPage authMessage={authMessage} />}

      {user && route.name === "assignments" && (
        <AssignmentsPage
          user={user}
          navigate={navigate}
          onSignOut={handleSignOut}
          onDeleteAccount={handleDeleteAccount}
        />
      )}

      {user && route.name === "assignment-detail" && (
        <AssignmentDetailPage assignmentId={route.assignmentId} navigate={navigate} />
      )}

      {user && route.name === "problem-board" && (
        <ProblemBoardPage
          assignmentId={route.assignmentId}
          problemIndex={route.problemIndex}
          navigate={navigate}
        />
      )}

      {route.name === "unknown" && (
        <section className="panel">
          <p>Page not found.</p>
          <button type="button" onClick={() => navigate(user ? "/assignments" : "/login", true)}>
            Go Home
          </button>
        </section>
      )}
    </main>
  );
}

export default App;
