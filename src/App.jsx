import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Excalidraw, MainMenu } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import "./App.css";
import {
  clearActiveUser,
  createAssignment,
  deleteAssignment,
  deleteAssignmentPdf,
  getActiveUser,
  getAssignmentById,
  getAssignmentPdf,
  getProblemScene,
  listAssignments,
  saveAssignmentPdf,
  saveProblemScene,
  setActiveUser,
} from "./services/storage";

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || "";

const PROBLEMS = [1, 2, 3];

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

const formatDate = (time) => new Date(time).toLocaleString();

const decodeJwtPayload = (token) => {
  try {
    const base64 = token.split(".")[1]?.replace(/-/g, "+").replace(/_/g, "/");
    if (!base64) return null;
    const json = decodeURIComponent(
      atob(base64)
        .split("")
        .map((char) => `%${char.charCodeAt(0).toString(16).padStart(2, "0")}`)
        .join(""),
    );
    return JSON.parse(json);
  } catch {
    return null;
  }
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

function LoginPage({ onSignIn }) {
  const [name, setName] = useState("");
  const [authError, setAuthError] = useState("");
  const googleButtonRef = useRef(null);

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return;

    const initGoogle = () => {
      if (!window.google?.accounts?.id || !googleButtonRef.current) return;

      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: (response) => {
          const payload = decodeJwtPayload(response.credential);
          if (!payload?.sub) {
            setAuthError("Google sign-in failed. Please continue in test mode.");
            return;
          }

          onSignIn({
            id: payload.sub,
            name: payload.name || payload.email || "Google User",
            email: payload.email || "",
          });
        },
      });

      googleButtonRef.current.innerHTML = "";
      window.google.accounts.id.renderButton(googleButtonRef.current, {
        theme: "outline",
        size: "large",
        width: 260,
      });
    };

    if (window.google?.accounts?.id) {
      initGoogle();
      return;
    }

    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = initGoogle;
    script.onerror = () => setAuthError("Unable to load Google sign-in. Use test mode.");
    document.body.appendChild(script);

    return () => {
      document.body.removeChild(script);
    };
  }, [onSignIn]);

  const handleDevSignIn = (event) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;

    onSignIn({
      id: `local-${trimmed.toLowerCase().replace(/\s+/g, "-")}`,
      name: trimmed,
      email: "",
    });
  };

  return (
    <section className="auth-card">
      <p className="eyebrow">StepWise</p>
      <h1>Sign in to Dashboard</h1>
      <p className="subtle">Access assignments, uploads, and problem whiteboards.</p>

      <div className="auth-block">
        <h2>Google Sign-In</h2>
        {GOOGLE_CLIENT_ID ? (
          <div ref={googleButtonRef} className="google-button-slot" />
        ) : (
          <p className="subtle">Set `VITE_GOOGLE_CLIENT_ID` to enable Google login.</p>
        )}
      </div>

      <div className="auth-divider">or</div>

      <form className="auth-block" onSubmit={handleDevSignIn}>
        <h2>Test Mode</h2>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Enter your name"
          aria-label="Name"
        />
        <button type="submit">Continue</button>
      </form>

      {authError && <p className="error-text">{authError}</p>}
    </section>
  );
}

function AssignmentsPage({ user, navigate, onSignOut }) {
  const [assignments, setAssignments] = useState([]);
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState("Loading assignments...");

  const loadAssignments = useCallback(async () => {
    const data = await listAssignments(user.id);
    setAssignments(data);
    setStatus(data.length === 0 ? "No assignments yet." : `${data.length} assignments found.`);
  }, [user.id]);

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

    await createAssignment(user.id, trimmed);
    setTitle("");
    await loadAssignments();
  };

  const handleDelete = async (assignmentId, assignmentTitle) => {
    const shouldDelete = window.confirm(`Delete assignment "${assignmentTitle}"?`);
    if (!shouldDelete) return;
    await deleteAssignment(user.id, assignmentId);
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

function AssignmentDetailPage({ user, assignmentId, navigate }) {
  const [assignment, setAssignment] = useState(null);
  const [fileRecord, setFileRecord] = useState(null);
  const [status, setStatus] = useState("Loading assignment...");

  const load = useCallback(async () => {
    const target = await getAssignmentById(assignmentId);
    if (!target || target.userId !== user.id) {
      setStatus("Assignment not found.");
      setAssignment(null);
      return;
    }

    const file = await getAssignmentPdf(user.id, assignmentId);
    setAssignment(target);
    setFileRecord(file || null);
    setStatus("Assignment loaded.");
  }, [assignmentId, user.id]);

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

    await saveAssignmentPdf(user.id, assignmentId, file);
    setStatus(`Uploaded ${file.name}.`);
    await load();
  };

  const handleOpenPdf = () => {
    if (!fileRecord?.blob) return;
    const url = URL.createObjectURL(fileRecord.blob);
    window.open(url, "_blank", "noopener,noreferrer");
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  };

  const handleRemovePdf = async () => {
    await deleteAssignmentPdf(user.id, assignmentId);
    setStatus("Removed uploaded PDF.");
    await load();
  };

  const handleDeleteAssignment = async () => {
    if (!assignment) return;
    const shouldDelete = window.confirm(`Delete assignment "${assignment.title}"?`);
    if (!shouldDelete) return;

    await deleteAssignment(user.id, assignment.id);
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

function ProblemBoardPage({ user, assignmentId, problemIndex, navigate }) {
  const [assignment, setAssignment] = useState(null);
  const [status, setStatus] = useState("Loading whiteboard...");
  const [excalidrawAPI, setExcalidrawAPI] = useState(null);
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

  useEffect(() => {
    const loadData = async () => {
      const target = await getAssignmentById(assignmentId);
      if (!target || target.userId !== user.id) {
        setStatus("Assignment not found.");
        return;
      }

      const storedScene = await getProblemScene(user.id, assignmentId, problemIndex);
      const scene = storedScene?.scene || getDefaultScene();

      setAssignment(target);
      setInitialScene(scene);
      latestSceneRef.current = scene;
      setStatus(
        storedScene
          ? `Last saved ${formatDate(storedScene.updatedAt)}.`
          : "No saved drawing yet.",
      );
    };

    loadData();
  }, [assignmentId, problemIndex, user.id]);

  useEffect(() => {
    if (!excalidrawAPI) return;
    excalidrawAPI.updateScene(initialScene);
  }, [excalidrawAPI, initialScene]);

  const handleChange = useCallback((elements, appState, files) => {
    latestSceneRef.current = { elements, appState, files };
  }, []);

  const handleSave = async () => {
    await saveProblemScene(user.id, assignmentId, problemIndex, latestSceneRef.current);
    setStatus(`Saved at ${new Date().toLocaleTimeString()}.`);
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

      <section className="whiteboard-stage">
        <section className="canvas-area">
          <Excalidraw
            excalidrawAPI={setExcalidrawAPI}
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
    </>
  );
}

function App() {
  const [user, setUser] = useState(() => getActiveUser());
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
  }, [navigate, path, user]);

  const route = useMemo(() => parseRoute(path), [path]);

  const handleSignIn = useCallback(
    (nextUser) => {
      setUser(nextUser);
      setActiveUser(nextUser);
      navigate("/assignments", true);
    },
    [navigate],
  );

  const handleSignOut = useCallback(() => {
    clearActiveUser();
    setUser(null);
    navigate("/login", true);
  }, [navigate]);

  return (
    <main className="app-shell">
      {route.name === "login" && <LoginPage onSignIn={handleSignIn} />}

      {user && route.name === "assignments" && (
        <AssignmentsPage user={user} navigate={navigate} onSignOut={handleSignOut} />
      )}

      {user && route.name === "assignment-detail" && (
        <AssignmentDetailPage user={user} assignmentId={route.assignmentId} navigate={navigate} />
      )}

      {user && route.name === "problem-board" && (
        <ProblemBoardPage
          user={user}
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

