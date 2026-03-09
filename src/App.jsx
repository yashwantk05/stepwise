import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Excalidraw, MainMenu, exportToCanvas } from "@excalidraw/excalidraw";
import Cropper from "react-easy-crop";
import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "@excalidraw/excalidraw/index.css";
import "react-easy-crop/react-easy-crop.css";
import "./App.css";
import { analyzeDrawing } from "./services/ai";
import {
  createAssignment,
  deleteAssignment,
  deleteProblemImage,
  deleteAssignmentPdf,
  downloadAssignmentPdfBlob,
  downloadProblemImageBlob,
  getAssignmentPdfDownloadUrl,
  getAssignmentById,
  getAssignmentPdf,
  getCurrentUser,
  getGoogleSignInUrl,
  getProblemImage,
  getProblemScene,
  listAssignments,
  requestAccountDeletion,
  saveAssignmentPdf,
  saveProblemImage,
  saveProblemScene,
  signOut,
} from "./services/storage";

const PROBLEMS = [1, 2, 3];
const MAX_PDF_BYTES = 20 * 1024 * 1024;
const ASPECT_PRESETS = [
  { label: "4:3", value: 4 / 3 },
  { label: "16:9", value: 16 / 9 },
  { label: "3:2", value: 3 / 2 },
  { label: "1:1", value: 1 },
  { label: "9:16", value: 9 / 16 },
];
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
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) throw new Error("Unable to initialize image crop context.");
  context.drawImage(image, x, y, width, height, 0, 0, width, height);

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Unable to export cropped problem image.");
  return blob;
};

const parseRoute = (path) => {
  if (path === "/login") return { name: "login" };
  if (path === "/assignments") return { name: "assignments" };

  const problemMatch = path.match(/^\/assignments\/([^/]+)\/problems\/([1-3])$/);
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
    if (!trimmed) return;

    await createAssignment(trimmed);
    setTitle("");
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
          <button type="submit">Create Assignment</button>
        </form>
      </section>

      <section className="grid-list">
        {assignments.map((assignment) => (
          <article key={assignment.id} className="assignment-card">
            <h2>{assignment.title}</h2>
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
        <div className="grid-list problem-grid">
          {PROBLEMS.map((problemIndex) => (
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
  const [hint, setHint] = useState("Start drawing to receive hints.");
  const [initialScene, setInitialScene] = useState(getDefaultScene());
  const [isInsightsOpen, setIsInsightsOpen] = useState(false);
  const latestSceneRef = useRef(getDefaultScene());
  const insights = useMemo(
    () => parseInsightsForProblem(assignment, problemIndex),
    [assignment, problemIndex],
  );
  const hintInsights = useMemo(
    () => insights.filter((entry) => entry.kind === "hint"),
    [insights],
  );
  const wrongInsights = useMemo(
    () => insights.filter((entry) => entry.kind === "wrong"),
    [insights],
  );
  const [sceneRevision, setSceneRevision] = useState(0);
  const [problemImageMeta, setProblemImageMeta] = useState(null);
  const [problemImageUrl, setProblemImageUrl] = useState("");
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [pickerStatus, setPickerStatus] = useState("");
  const [pdfPageCount, setPdfPageCount] = useState(0);
  const [selectedPage, setSelectedPage] = useState(1);
  const [pageImageUrl, setPageImageUrl] = useState("");
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState(null);
  const [isRenderingPage, setIsRenderingPage] = useState(false);
  const [isSavingProblemImage, setIsSavingProblemImage] = useState(false);
  const [aspectRatio, setAspectRatio] = useState(4 / 3);
  const [ratioWidth, setRatioWidth] = useState(4);
  const [ratioHeight, setRatioHeight] = useState(3);
  const latestSceneRef = useRef(getDefaultScene());
  const analyzeTimerRef = useRef(null);
  const lastSnapshotRef = useRef(null);
  const pdfDocumentRef = useRef(null);
  const problemImageUrlRef = useRef("");
  const pageImageUrlRef = useRef("");

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

  const closePicker = useCallback(() => {
    setIsPickerOpen(false);
    setPickerStatus("");
    setPdfPageCount(0);
    setSelectedPage(1);
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setAspectRatio(4 / 3);
    setRatioWidth(4);
    setRatioHeight(3);
    setCroppedAreaPixels(null);
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
        const initialViewport = page.getViewport({ scale: 1.5 });
        const boundedScale = initialViewport.width > 1400 ? 1.5 * (1400 / initialViewport.width) : 1.5;
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
        setCrop({ x: 0, y: 0 });
        setZoom(1);
        setCroppedAreaPixels(null);
        setPickerStatus(`Page ${pageNumber} ready. Adjust crop and save.`);
      } finally {
        setIsRenderingPage(false);
      }
    },
    [],
  );

  useEffect(() => {
    const loadData = async () => {
      const [target, storedScene] = await Promise.all([
        getAssignmentById(assignmentId),
        getProblemScene(assignmentId, problemIndex),
      ]);
      const scene = getPersistedScene(storedScene?.scene || getDefaultScene());

      setAssignment(target);
      setInitialScene(scene);
      setSceneRevision((revision) => revision + 1);
      latestSceneRef.current = scene;
      setHint("Start drawing to receive hints.");
      lastSnapshotRef.current = null;
      setStatus(
        storedScene
          ? `Last saved ${formatDate(storedScene.updatedAt)}.`
          : "No saved drawing yet.",
      );
      await loadProblemImage();
    };

    loadData().catch(() => setStatus("Unable to load whiteboard."));
  }, [assignmentId, problemIndex, loadProblemImage]);

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
      });

      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) return;

      const base64 = await blobToBase64(blob);
      if (base64 === lastSnapshotRef.current) return;
      lastSnapshotRef.current = base64;

      setHint("Generating hint...");
      try {
        const result = await analyzeDrawing(blob);
        const nextHint = typeof result?.result === "string" ? result.result.trim() : "";
        setHint(nextHint || "No hint available yet.");
      } catch {
        setHint("Hint service unavailable.");
      }
    },
    [blobToBase64],
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

  const handlePageChange = async (value) => {
    const nextPage = clamp(Number(value) || 1, 1, pdfPageCount || 1);
    setSelectedPage(nextPage);
    if (pdfDocumentRef.current) {
      await renderSelectedPage(pdfDocumentRef.current, nextPage);
    }
  };

  const handleSaveProblemImage = async () => {
    if (!pageImageUrl || !croppedAreaPixels) {
      setPickerStatus("Select a page and crop area first.");
      return;
    }

    setIsSavingProblemImage(true);
    try {
      const croppedBlob = await createCroppedImageBlob(pageImageUrl, croppedAreaPixels);
      const imageFile = new File([croppedBlob], `problem-${problemIndex}.png`, {
        type: "image/png",
      });
      await saveProblemImage(assignmentId, problemIndex, imageFile);
      await loadProblemImage();
      closePicker();
      setStatus(`Saved problem image at ${new Date().toLocaleTimeString()}.`);
    } catch {
      setPickerStatus("Unable to save cropped image.");
    } finally {
      setIsSavingProblemImage(false);
    }
  };

  const applyCustomRatio = () => {
    const width = Number(ratioWidth);
    const height = Number(ratioHeight);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      setPickerStatus("Enter valid ratio values.");
      return;
    }
    setAspectRatio(width / height);
    setPickerStatus(`Using ratio ${width}:${height}.`);
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

  return (
    <>
      <header className="topbar">
        <div>
          <p className="eyebrow">Whiteboard</p>
          <h1>{assignment.title} - Problem {problemIndex}</h1>
        </div>
        <div className="topbar-actions">
          <p className="status-pill">{status}</p>
          <button type="button" onClick={handleSave}>Save Drawing</button>
          <button
            type="button"
            className="outline"
            onClick={() => navigate(`/assignments/${assignmentId}`)}
          >
            Back
          </button>
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
        <section className="canvas-area">
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
        </section>

        <aside className={`insights-rail ${isInsightsOpen ? "is-open" : ""}`}>
          <button
            type="button"
            className="insights-tab"
            onClick={() => setIsInsightsOpen((current) => !current)}
            aria-expanded={isInsightsOpen}
            aria-controls="whiteboard-insights-panel"
          >
            Hints
          </button>

          <section id="whiteboard-insights-panel" className="insights-panel" aria-label="Hints and wrong steps">
            <h2>Hints and Wrong Steps</h2>

            <div className="insight-group">
              <h3>Hints</h3>
              {hintInsights.length > 0 ? (
                hintInsights.map((entry, index) => (
                  <details key={entry.id} className="insight-item insight-item-hint">
                    <summary>{entry.title || `Hint ${index + 1}`}</summary>
                    <p>{entry.content}</p>
                  </details>
                ))
              ) : (
                <p className="subtle">No hints yet.</p>
              )}
            </div>

            <div className="insight-group">
              <h3>Wrong Steps</h3>
              {wrongInsights.length > 0 ? (
                wrongInsights.map((entry, index) => (
                  <details key={entry.id} className="insight-item insight-item-wrong">
                    <summary>{entry.title || `Wrong Step ${index + 1}`}</summary>
                    <p>{entry.content}</p>
                  </details>
                ))
              ) : (
                <p className="subtle">No wrong steps yet.</p>
              )}
            </div>
          </section>
        </aside>
      </section>

      <section className="panel">
        <h2>AI Study Buddy</h2>
        <p className="subtle">{hint}</p>
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
              <label className="picker-label">
                Ratio
                <select
                  value={String(aspectRatio)}
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    setAspectRatio(next);
                    setPickerStatus("Aspect ratio updated.");
                  }}
                >
                  {ASPECT_PRESETS.map((preset) => (
                    <option key={preset.label} value={String(preset.value)}>
                      {preset.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="picker-label">
                W
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={ratioWidth}
                  onChange={(event) => setRatioWidth(Number(event.target.value))}
                />
              </label>
              <label className="picker-label">
                H
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={ratioHeight}
                  onChange={(event) => setRatioHeight(Number(event.target.value))}
                />
              </label>
              <button type="button" className="outline" onClick={applyCustomRatio}>
                Apply Ratio
              </button>
            </div>

            <div className="picker-crop-shell">
              {pageImageUrl ? (
                <Cropper
                  image={pageImageUrl}
                  crop={crop}
                  zoom={zoom}
                  aspect={aspectRatio}
                  onCropChange={setCrop}
                  onZoomChange={setZoom}
                  onCropComplete={(_, pixels) => setCroppedAreaPixels(pixels)}
                />
              ) : (
                <p className="subtle">Rendering selected page...</p>
              )}
            </div>

            <label className="picker-label">
              Zoom
              <input
                type="range"
                min={1}
                max={3}
                step={0.1}
                value={zoom}
                onChange={(event) => setZoom(Number(event.target.value))}
              />
            </label>
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
