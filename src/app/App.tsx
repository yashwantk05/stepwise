import React, { useState, useEffect, useCallback, useRef } from 'react';
import "../styles/index.css";
import "../styles/fonts.css";
import "../styles/app.css";
import {
  DEFAULT_USER_SETTINGS,
  getCurrentUser,
  getUserSettings,
  signOut,
  requestAccountDeletion,
  getLearningStreakSummary,
  recordLearningActivity,
  type UserSettings,
} from './services/storage';
import {
  applyAccessibilitySettings,
  extractPageSpeechText,
  speakWithAzure,
  stopAccessibilitySpeech,
  subscribeAccessibilitySpeechState,
} from './services/accessibility';
import { Sidebar } from './components/Sidebar';
import { Topbar } from './components/Topbar';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { WhiteboardPage } from './pages/WhiteboardPage';
import { MyNotesPage } from './pages/MyNotesPage';
import { WeakAreasPage } from './pages/WeakAreasPage';
import { ProgressAnalyticsPage } from './pages/ProgressAnalyticsPage';
import { SocraticTutorPage } from './pages/SocraticTutorPage';
import { StudyToolPage } from './pages/StudyToolPage';
import { SubjectDetailPage } from './pages/SubjectDetailPage';
import { AssignmentDetailPage } from './pages/AssignmentDetailPage';
import { ProblemBoardPage } from './pages/ProblemBoardPage';
import { SettingsPage } from './pages/SettingsPage';
import type { StudyToolType } from './services/studyTools';

type Route =
  | { type: 'dashboard' }
  | { type: 'whiteboard' }
  | { type: 'notes' }
  | { type: 'weak-areas' }
  | { type: 'progress-analytics' }
  | { type: 'settings' }
  | { type: 'socratic-tutor'; context?: Record<string, unknown> }
  | { type: 'study-tool'; tool: StudyToolType; subjectId?: string }
  | { type: 'subject'; subjectId: string }
  | { type: 'assignment'; subjectId: string; assignmentId: string }
  | { type: 'problem'; subjectId: string; assignmentId: string; problemIndex: number };

function App() {
  const [user, setUser] = useState<any>(null);
  const [authReady, setAuthReady] = useState(false);
  const [route, setRoute] = useState<Route>({ type: 'dashboard' });
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(false);
  const [streakCount, setStreakCount] = useState(0);
  const [notificationCount, setNotificationCount] = useState(0);
  const [userSettings, setUserSettings] = useState<UserSettings>(DEFAULT_USER_SETTINGS);
  const [isAccessibilityAudioPlaying, setIsAccessibilityAudioPlaying] = useState(false);
  const [suppressedNarrationRouteKey, setSuppressedNarrationRouteKey] = useState<string | null>(null);
  const narrationRequestId = useRef(0);

  const getRouteNarrationKey = useCallback((currentRoute: Route) => {
    switch (currentRoute.type) {
      case 'dashboard':
      case 'whiteboard':
      case 'notes':
      case 'weak-areas':
      case 'progress-analytics':
      case 'settings':
        return currentRoute.type;
      case 'socratic-tutor':
        return `socratic-tutor:${JSON.stringify(currentRoute.context || {})}`;
      case 'study-tool':
        return `study-tool:${currentRoute.tool}:${currentRoute.subjectId || ''}`;
      case 'subject':
        return `subject:${currentRoute.subjectId}`;
      case 'assignment':
        return `assignment:${currentRoute.subjectId}:${currentRoute.assignmentId}`;
      case 'problem':
        return `problem:${currentRoute.subjectId}:${currentRoute.assignmentId}:${currentRoute.problemIndex}`;
      default:
        return 'unknown';
    }
  }, []);

  const currentRouteNarrationKey = getRouteNarrationKey(route);

  useEffect(() => {
    getCurrentUser()
      .then((currentUser) => {
        setUser(currentUser);
      })
      .catch(() => {
        setUser(null);
      })
      .finally(() => {
        setAuthReady(true);
      });
  }, []);

  useEffect(() => {
    const nextSettings = getUserSettings(user?.id);
    setUserSettings(nextSettings);
    applyAccessibilitySettings(nextSettings);
  }, [user?.id]);

  useEffect(() => {
    const onFullscreenChange = () => {
      // Keep the sidebar from “sticking around” when the user enters fullscreen.
      if (document.fullscreenElement) {
        setIsSidebarExpanded(false);
      }
    };

    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () =>
      document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  useEffect(() => {
    setStreakCount(getLearningStreakSummary().streak);

    const intervalId = window.setInterval(() => {
      if (document.visibilityState !== 'visible' || !document.hasFocus()) {
        return;
      }

      recordLearningActivity(30);
      setStreakCount(getLearningStreakSummary().streak);
    }, 30000);

    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    applyAccessibilitySettings(userSettings);
  }, [userSettings]);

  useEffect(() => subscribeAccessibilitySpeechState(setIsAccessibilityAudioPlaying), []);

  useEffect(() => {
    narrationRequestId.current += 1;
    const requestId = narrationRequestId.current;

    if (
      !authReady ||
      !user ||
      !userSettings.textToSpeechEnabled
    ) {
      stopAccessibilitySpeech();
      return;
    }

    if (suppressedNarrationRouteKey === currentRouteNarrationKey) {
      stopAccessibilitySpeech();
      return;
    }

    let frameOne = 0;
    let frameTwo = 0;
    let timer = 0;

    frameOne = window.requestAnimationFrame(() => {
      frameTwo = window.requestAnimationFrame(() => {
        timer = window.setTimeout(() => {
          if (requestId !== narrationRequestId.current) return;

          const text = extractPageSpeechText();
          if (!text) return;

          void speakWithAzure(text, userSettings).catch((error) => {
            console.error("Accessibility speech playback failed:", error);
          });
        }, 250);
      });
    });

    return () => {
      narrationRequestId.current += 1;
      window.cancelAnimationFrame(frameOne);
      window.cancelAnimationFrame(frameTwo);
      window.clearTimeout(timer);
      stopAccessibilitySpeech();
    };
  }, [authReady, currentRouteNarrationKey, route, suppressedNarrationRouteKey, user, userSettings]);

  useEffect(() => {
    if (suppressedNarrationRouteKey && suppressedNarrationRouteKey !== currentRouteNarrationKey) {
      setSuppressedNarrationRouteKey(null);
    }
  }, [currentRouteNarrationKey, suppressedNarrationRouteKey]);

  const handleSignOut = useCallback(async () => {
    await signOut();
    setUser(null);
  }, []);

  const handleDeleteAccount = useCallback(async () => {
    const confirmed = window.confirm(
      "Delete your account? This will remove all notebooks, assignments, and uploaded files."
    );
    if (!confirmed) return;

    await requestAccountDeletion();
    setUser(null);
  }, []);

  const handleSettingsChange = useCallback((nextSettings: UserSettings) => {
    setUserSettings(nextSettings);
    applyAccessibilitySettings(nextSettings);
  }, []);

  const handleStopAccessibilityAudio = useCallback(() => {
    narrationRequestId.current += 1;
    setSuppressedNarrationRouteKey(getRouteNarrationKey(route));
    stopAccessibilitySpeech();
  }, [getRouteNarrationKey, route]);

  const navigate = useCallback((page: string) => {
    if (page === 'dashboard') {
      setRoute({ type: 'dashboard' });
    } else if (page === 'whiteboard') {
      setRoute({ type: 'whiteboard' });
    } else if (page === 'notes') {
      setRoute({ type: 'notes' });
    } else if (page === 'weak-areas') {
      setRoute({ type: 'weak-areas' });
    } else if (page === 'progress-analytics') {
      setRoute({ type: 'progress-analytics' });
    } else if (page === 'settings') {
      setRoute({ type: 'settings' });
    } else if (page === 'socratic-tutor') {
      setRoute({ type: 'socratic-tutor' });
    } else if (page === 'flashcards') {
      setRoute({ type: 'study-tool', tool: 'flashcards' });
    } else if (page === 'quiz') {
      setRoute({ type: 'study-tool', tool: 'quiz' });
    } else if (page === 'mind-map') {
      setRoute({ type: 'study-tool', tool: 'mind-map' });
    } else if (page === 'revision-sheet') {
      setRoute({ type: 'study-tool', tool: 'revision-sheet' });
    }
  }, []);

  const openSubject = useCallback((subjectId: string) => {
    setRoute({ type: 'subject', subjectId });
  }, []);

  const openAssignment = useCallback((subjectId: string, assignmentId: string) => {
    setRoute({ type: 'assignment', subjectId, assignmentId });
  }, []);

  const openProblem = useCallback((subjectId: string, assignmentId: string, problemIndex: number) => {
    setRoute({ type: 'problem', subjectId, assignmentId, problemIndex });
  }, []);

  const goBackToWhiteboard = useCallback(() => {
    setRoute({ type: 'whiteboard' });
  }, []);

  const goBackToSubject = useCallback((subjectId: string) => {
    setRoute({ type: 'subject', subjectId });
  }, []);

  const openStudyTool = useCallback((tool: StudyToolType, subjectId?: string) => {
    setRoute({ type: 'study-tool', tool, subjectId });
  }, []);

  const handleDashboardMetaChange = useCallback(
    ({ recommendationCount, streak }: { recommendationCount: number; streak: number }) => {
      setNotificationCount(recommendationCount);
      setStreakCount(streak);
    },
    [],
  );

  if (!authReady) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        background: 'var(--surface-light)'
      }}>
        <p>Loading...</p>
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  const getCurrentPage = () => {
    if (route.type === 'dashboard') return 'dashboard';
    if (route.type === 'notes') return 'notes';
    if (route.type === 'weak-areas') return 'weak-areas';
    if (route.type === 'progress-analytics') return 'progress-analytics';
    if (route.type === 'settings') return 'settings';
    if (route.type === 'socratic-tutor') return 'socratic-tutor';
    if (route.type === 'study-tool') return route.tool;
    return 'whiteboard';
  };

  return (
    <div className={`app-layout ${isSidebarExpanded ? 'sidebar-expanded' : ''}`}>
      <Sidebar
        currentPage={getCurrentPage()}
        onNavigate={navigate}
        isExpanded={isSidebarExpanded}
        onToggleExpanded={() => setIsSidebarExpanded((prev) => !prev)}
      />

      <div className="app-main">
        <Topbar
          user={user}
          onSignOut={handleSignOut}
          onDeleteAccount={handleDeleteAccount}
          onOpenSettings={() => setRoute({ type: 'settings' })}
          onStopAudio={handleStopAccessibilityAudio}
          showAudioControl={userSettings.textToSpeechEnabled}
          isAudioPlaying={isAccessibilityAudioPlaying}
          streakCount={streakCount}
          notificationCount={notificationCount}
        />

        {route.type === 'dashboard' && (
          <DashboardPage
            user={user}
            onOpenWhiteboard={() => setRoute({ type: 'whiteboard' })}
            onOpenNotes={() => setRoute({ type: 'notes' })}
            onOpenStudyTool={openStudyTool}
            onDashboardMetaChange={handleDashboardMetaChange}
          />
        )}

        {route.type === 'whiteboard' && (
          <WhiteboardPage onOpenSubject={openSubject} />
        )}

        {route.type === 'notes' && <MyNotesPage onOpenTool={openStudyTool} />}

        {route.type === 'weak-areas' && <WeakAreasPage />}

        {route.type === 'progress-analytics' && <ProgressAnalyticsPage />}

        {route.type === 'settings' && (
          <SettingsPage
            user={user}
            settings={userSettings}
            onSettingsChange={handleSettingsChange}
          />
        )}

        {route.type === 'socratic-tutor' && (
          <div className="socratic-page-shell">
            <SocraticTutorPage initialContext={route.context as any} />
          </div>
        )}
        
        {route.type === 'study-tool' && (
          <StudyToolPage
            tool={route.tool}
            initialSubjectId={route.subjectId}
            onBack={() => setRoute({ type: 'notes' })}
          />
        )}

        {route.type === 'subject' && (
          <SubjectDetailPage
            subjectId={route.subjectId}
            onBack={goBackToWhiteboard}
            onOpenAssignment={(assignmentId) => openAssignment(route.subjectId, assignmentId)}
          />
        )}

        {route.type === 'assignment' && (
          <AssignmentDetailPage
            subjectId={route.subjectId}
            assignmentId={route.assignmentId}
            onBack={() => goBackToSubject(route.subjectId)}
            onOpenProblem={(problemIndex) => openProblem(route.subjectId, route.assignmentId, problemIndex)}
          />
        )}

        {route.type === 'problem' && (
          <ProblemBoardPage
            subjectId={route.subjectId}
            assignmentId={route.assignmentId}
            problemIndex={route.problemIndex}
            onBack={() => openAssignment(route.subjectId, route.assignmentId)}
          />
        )}
      </div>
    </div>
  );
}

export default App;
