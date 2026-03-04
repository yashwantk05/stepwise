import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Excalidraw } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import "./App.css";

const STORAGE_KEY = "stepwise.whiteboard.sessions";

const createSessionId = () =>
  `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const getSessionLabel = (session) =>
  `${session.name} (${new Date(session.updatedAt).toLocaleString()})`;

const getDefaultScene = () => ({
  elements: [],
  appState: {
    viewBackgroundColor: "#f8fafc",
  },
  files: {},
});

const loadStoredSessions = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const getInitialState = () => {
  const initialSessions = loadStoredSessions();
  return {
    sessions: initialSessions,
    activeSessionId: initialSessions[0]?.id || null,
    statusMessage:
      initialSessions.length > 0
        ? `Loaded ${initialSessions[0].name}.`
        : "Create a session to start drawing.",
  };
};

function App() {
  const initialState = useMemo(() => getInitialState(), []);
  const [excalidrawAPI, setExcalidrawAPI] = useState(null);
  const [sessions, setSessions] = useState(initialState.sessions);
  const [sessionName, setSessionName] = useState("");
  const [activeSessionId, setActiveSessionId] = useState(initialState.activeSessionId);
  const [statusMessage, setStatusMessage] = useState(initialState.statusMessage);

  const latestSceneRef = useRef(getDefaultScene());

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  }, [sessions]);

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) || null,
    [activeSessionId, sessions],
  );

  useEffect(() => {
    if (!excalidrawAPI) return;

    if (!activeSession) {
      excalidrawAPI.updateScene(getDefaultScene());
      return;
    }

    excalidrawAPI.updateScene(activeSession.scene || getDefaultScene());
  }, [activeSession, excalidrawAPI]);

  const handleChange = useCallback((elements, appState, files) => {
    latestSceneRef.current = { elements, appState, files };
  }, []);

  const handleCreateSession = useCallback(() => {
    const name = sessionName.trim() || `Session ${sessions.length + 1}`;
    const now = Date.now();

    const newSession = {
      id: createSessionId(),
      name,
      createdAt: now,
      updatedAt: now,
      scene: getDefaultScene(),
    };

    setSessions((prev) => [newSession, ...prev]);
    setActiveSessionId(newSession.id);
    setSessionName("");
    setStatusMessage(`Created ${name}.`);

    if (excalidrawAPI) {
      excalidrawAPI.updateScene(getDefaultScene());
    }
    latestSceneRef.current = getDefaultScene();
  }, [excalidrawAPI, sessionName, sessions.length]);

  const handleSaveSession = useCallback(() => {
    if (!activeSessionId) {
      setStatusMessage("Create or select a session before saving.");
      return;
    }

    let saved = false;
    setSessions((prev) =>
      prev.map((session) => {
        if (session.id !== activeSessionId) return session;
        saved = true;
        return {
          ...session,
          updatedAt: Date.now(),
          scene: latestSceneRef.current,
        };
      }),
    );

    if (!saved) {
      setStatusMessage("Selected session was not found.");
      return;
    }

    setStatusMessage(`Saved ${activeSession?.name || "session"}.`);
  }, [activeSession?.name, activeSessionId]);

  const handleDeleteSession = useCallback(() => {
    if (!activeSessionId) {
      setStatusMessage("Select a session to delete.");
      return;
    }

    const target = sessions.find((session) => session.id === activeSessionId);
    const nextSessions = sessions.filter((session) => session.id !== activeSessionId);

    setSessions(nextSessions);
    setActiveSessionId(nextSessions[0]?.id || null);

    if (nextSessions.length === 0 && excalidrawAPI) {
      excalidrawAPI.updateScene(getDefaultScene());
      latestSceneRef.current = getDefaultScene();
    }

    setStatusMessage(`Deleted ${target?.name || "session"}.`);
  }, [activeSessionId, excalidrawAPI, sessions]);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">StepWise</p>
          <h1>Whiteboard Sessions</h1>
        </div>
        <p className="status" role="status" aria-live="polite">
          {statusMessage}
        </p>
      </header>

      <section className="panel">
        <div className="control-row">
          <input
            type="text"
            value={sessionName}
            onChange={(event) => setSessionName(event.target.value)}
            placeholder="Session name"
            aria-label="Session name"
          />
          <button type="button" onClick={handleCreateSession}>
            Create Session
          </button>
        </div>

        <div className="control-row">
          <select
            value={activeSessionId || ""}
            onChange={(event) => setActiveSessionId(event.target.value || null)}
            aria-label="Choose session"
          >
            <option value="">Select session</option>
            {sessions.map((session) => (
              <option key={session.id} value={session.id}>
                {getSessionLabel(session)}
              </option>
            ))}
          </select>
          <button type="button" onClick={handleSaveSession}>
            Save Drawing
          </button>
          <button type="button" className="danger" onClick={handleDeleteSession}>
            Delete Session
          </button>
        </div>
      </section>

      <section className="canvas-area">
        <Excalidraw
          excalidrawAPI={setExcalidrawAPI}
          onChange={handleChange}
          UIOptions={{
            canvasActions: {
              saveToActiveFile: false,
              loadScene: false,
            },
          }}
        />
      </section>
    </main>
  );
}

export default App;
