import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Excalidraw, MainMenu } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import "./App.css";
import {
  createAssignment,
  deleteAssignment,
  deleteAssignmentPdf,
  getAssignmentPdfDownloadUrl,
  getAssignmentById,
  getAssignmentPdf,
  getCurrentUser,
  getGoogleSignInUrl,
  getProblemScene,
  listAssignments,
  requestAccountDeletion,
  saveAssignmentPdf,
  saveProblemScene,
  signOut,
} from "./services/storage";

const PROBLEMS = [1, 2, 3];

const getDefaultScene = () => ({
  elements: [],
  appState: { viewBackgroundColor: "#f8fafc" },
  files: {},
});

const formatDate = (time) => new Date(time).toLocaleString();

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
  const [excalidrawAPI, setExcalidrawAPI] = useState(null);
  const [initialScene, setInitialScene] = useState(getDefaultScene());
  const latestSceneRef = useRef(getDefaultScene());

  useEffect(() => {
    const loadData = async () => {
      const target = await getAssignmentById(assignmentId);
      const storedScene = await getProblemScene(assignmentId, problemIndex);
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

    loadData().catch(() => setStatus("Unable to load whiteboard."));
  }, [assignmentId, problemIndex]);

  useEffect(() => {
    if (!excalidrawAPI) return;
    excalidrawAPI.updateScene(initialScene);
  }, [excalidrawAPI, initialScene]);

  const handleChange = useCallback((elements, appState, files) => {
    latestSceneRef.current = { elements, appState, files };
  }, []);

  const handleSave = async () => {
    await saveProblemScene(assignmentId, problemIndex, latestSceneRef.current);
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
    await signOut();
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
