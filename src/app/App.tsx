import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
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
  hasAccessibilitySpeechResume,
  speakWithAzure,
  stopAccessibilitySpeech,
} from './services/accessibility';
import { stopAllAudioPlayback, subscribeGlobalAudioState } from './services/audioControl';
import { syncAppLanguage } from './services/translation';
import { Sidebar } from './components/Sidebar';
import { Topbar } from './components/Topbar';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { WhiteboardPage } from './pages/WhiteboardPage';
import { MyNotesPage } from './pages/MyNotesPage';
import { WeakAreasPage } from './pages/WeakAreasPage';
import { ProgressAnalyticsPage } from './pages/ProgressAnalyticsPage';
import { RefreshZonePage } from './pages/RefreshZonePage';
import { SocraticTutorPage } from './pages/SocraticTutorPage';
import { StudyToolPage } from './pages/StudyToolPage';
import { StudyToolsHubPage } from './pages/StudyToolsHubPage';
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
  | { type: 'study-tools' }
  | { type: 'settings' }
  | { type: 'refresh-zone' }
  | { type: 'socratic-tutor'; context?: Record<string, unknown> }
  | { type: 'study-tool'; tool: StudyToolType; subjectId?: string; backTo?: 'notes' | 'study-tools' }
  | { type: 'subject'; subjectId: string }
  | { type: 'assignment'; subjectId: string; assignmentId: string }
  | { type: 'problem'; subjectId: string; assignmentId: string; problemIndex: number };

function getRouteKey(routeToKey: Route) {
  switch (routeToKey.type) {
    case 'dashboard':
    case 'whiteboard':
    case 'notes':
    case 'weak-areas':
    case 'progress-analytics':
    case 'study-tools':
    case 'settings':
      return routeToKey.type;
    case 'socratic-tutor':
      return `socratic-tutor:${JSON.stringify(routeToKey.context || {})}`;
    case 'study-tool':
      return `study-tool:${routeToKey.tool}:${routeToKey.subjectId || ''}:${routeToKey.backTo || ''}`;
    case 'subject':
      return `subject:${routeToKey.subjectId}`;
    case 'assignment':
      return `assignment:${routeToKey.subjectId}:${routeToKey.assignmentId}`;
    case 'problem':
      return `problem:${routeToKey.subjectId}:${routeToKey.assignmentId}:${routeToKey.problemIndex}`;
    default:
      return 'unknown';
  }
}

function useStableRouteState(initialRoute: Route) {
  const [route, setRouteState] = useState<Route>(initialRoute);
  const activeRouteKey = useMemo(() => getRouteKey(route), [route]);

  const setRoute = useCallback((nextRoute: Route) => {
    setRouteState((currentRoute) => {
      if (getRouteKey(currentRoute) === getRouteKey(nextRoute)) {
        return currentRoute;
      }
      return nextRoute;
    });
  }, []);

  return { route, setRoute, activeRouteKey };
}

function usePersistentRoutes(activeRoute: Route) {
  const routeCacheRef = useRef<Record<string, Route>>({});
  const [visitedRouteKeys, setVisitedRouteKeys] = useState<string[]>([]);
  const activeRouteKey = getRouteKey(activeRoute);

  useEffect(() => {
    routeCacheRef.current[activeRouteKey] = activeRoute;
    setVisitedRouteKeys((previousKeys) =>
      previousKeys.includes(activeRouteKey) ? previousKeys : [...previousKeys, activeRouteKey],
    );
  }, [activeRoute, activeRouteKey]);

  return {
    activeRouteKey,
    getCachedRoute: (routeKey: string) => routeCacheRef.current[routeKey],
    visitedRouteKeys,
  };
}

function App() {
  const [user, setUser] = useState<any>(null);
  const [authReady, setAuthReady] = useState(false);
  const { route, setRoute, activeRouteKey: stableActiveRouteKey } = useStableRouteState({ type: 'dashboard' });
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(false);
  const [streakCount, setStreakCount] = useState(0);
  const [notificationCount, setNotificationCount] = useState(0);
  const [userSettings, setUserSettings] = useState<UserSettings>(DEFAULT_USER_SETTINGS);
  const [isAccessibilityAudioPlaying, setIsAccessibilityAudioPlaying] = useState(false);
  const [suppressedNarrationRouteKey, setSuppressedNarrationRouteKey] = useState<string | null>(null);
  const narrationRequestId = useRef(0);
  const {
    activeRouteKey,
    getCachedRoute,
    visitedRouteKeys,
  } = usePersistentRoutes(route);
  const currentRouteNarrationKey = stableActiveRouteKey;

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
    void syncAppLanguage(nextSettings).catch((error) => {
      console.error("Failed to sync app language:", error);
    });
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

  useEffect(() => {
    let cancelled = false;

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        if (cancelled) return;
        applyAccessibilitySettings(userSettings);
        void syncAppLanguage(userSettings).catch((error) => {
          console.error("Failed to sync app language:", error);
        });
      });
    });

    return () => {
      cancelled = true;
    };
  }, [route, userSettings]);

  useEffect(() => subscribeGlobalAudioState(setIsAccessibilityAudioPlaying), []);

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

          void speakWithAzure(text, userSettings, {
            sessionKey: currentRouteNarrationKey,
          }).catch((error) => {
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

  const handleToggleAccessibilityAudio = useCallback(() => {
    const routeKey = getRouteKey(route);

    if (isAccessibilityAudioPlaying) {
      narrationRequestId.current += 1;
      setSuppressedNarrationRouteKey(routeKey);
      stopAllAudioPlayback();
      return;
    }

    const text = extractPageSpeechText();
    if (!text) return;

    narrationRequestId.current += 1;
    setSuppressedNarrationRouteKey(routeKey);
    void speakWithAzure(text, userSettings, {
      sessionKey: routeKey,
      resume: hasAccessibilitySpeechResume(routeKey, text),
    }).catch((error) => {
      console.error("Accessibility speech playback failed:", error);
    });
  }, [isAccessibilityAudioPlaying, route, userSettings]);

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
    } else if (page === 'study-tools') {
      setRoute({ type: 'study-tools' });
    } else if (page === 'settings') {
      setRoute({ type: 'settings' });
    } else if (page === 'refresh-zone') {
      setRoute({ type: 'refresh-zone' });
    } else if (page === 'socratic-tutor') {
      setRoute({ type: 'socratic-tutor' });
    } else if (page === 'flashcards') {
      setRoute({ type: 'study-tool', tool: 'flashcards', backTo: 'study-tools' });
    } else if (page === 'quiz') {
      setRoute({ type: 'study-tool', tool: 'quiz', backTo: 'study-tools' });
    } else if (page === 'mind-map') {
      setRoute({ type: 'study-tool', tool: 'mind-map', backTo: 'study-tools' });
    } else if (page === 'revision-sheet') {
      setRoute({ type: 'study-tool', tool: 'revision-sheet', backTo: 'study-tools' });
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
    setRoute({ type: 'study-tool', tool, subjectId, backTo: 'notes' });
  }, []);

  const openStudyToolFromHub = useCallback((tool: StudyToolType) => {
    setRoute({ type: 'study-tool', tool, backTo: 'study-tools' });
  }, []);

  const handleDashboardMetaChange = useCallback(
    ({ recommendationCount, streak }: { recommendationCount: number; streak: number }) => {
      setNotificationCount(recommendationCount);
      setStreakCount(streak);
    },
    [],
  );

  const openSettings = useCallback(() => {
    setRoute({ type: 'settings' });
  }, [setRoute]);

  const openWhiteboard = useCallback(() => {
    setRoute({ type: 'whiteboard' });
  }, [setRoute]);

  const openNotes = useCallback(() => {
    setRoute({ type: 'notes' });
  }, [setRoute]);

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
    if (route.type === 'study-tools') return 'study-tools';
    if (route.type === 'settings') return 'settings';
    if (route.type === 'refresh-zone') return 'refresh-zone';
    if (route.type === 'socratic-tutor') return 'socratic-tutor';
    if (route.type === 'study-tool') return 'study-tools';
    return 'whiteboard';
  };

  const currentPageSpeechText = extractPageSpeechText();
  const canResumeAudio =
    !isAccessibilityAudioPlaying &&
    hasAccessibilitySpeechResume(currentRouteNarrationKey, currentPageSpeechText);

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
          onOpenSettings={openSettings}
          onStopAudio={handleToggleAccessibilityAudio}
          showAudioControl={userSettings.textToSpeechEnabled || route.type === 'socratic-tutor' || isAccessibilityAudioPlaying}
          isAudioPlaying={isAccessibilityAudioPlaying}
          audioButtonLabel={canResumeAudio ? 'Resume Audio' : 'Play Audio'}
          streakCount={streakCount}
          notificationCount={notificationCount}
        />

        {visitedRouteKeys.map((routeKey) => {
          const cachedRoute = getCachedRoute(routeKey);
          if (!cachedRoute) {
            return null;
          }

          const isActive = routeKey === activeRouteKey;
          let pageContent: React.ReactNode = null;

          if (cachedRoute.type === 'dashboard') {
            pageContent = (
              <DashboardPage
                user={user}
                onOpenWhiteboard={openWhiteboard}
                onOpenNotes={openNotes}
                onOpenStudyTool={openStudyTool}
                onDashboardMetaChange={handleDashboardMetaChange}
              />
            );
          } else if (cachedRoute.type === 'whiteboard') {
            pageContent = (
              <WhiteboardPage
                onOpenSubject={openSubject}
                onOpenAssignment={openAssignment}
                onOpenProblem={openProblem}
              />
            );
          } else if (cachedRoute.type === 'notes') {
            pageContent = <MyNotesPage onOpenTool={openStudyTool} />;
          } else if (cachedRoute.type === 'weak-areas') {
            pageContent = <WeakAreasPage />;
          } else if (cachedRoute.type === 'progress-analytics') {
            pageContent = <ProgressAnalyticsPage />;
          } else if (cachedRoute.type === 'refresh-zone') {
            pageContent = <RefreshZonePage />;
          } else if (cachedRoute.type === 'study-tools') {
            pageContent = <StudyToolsHubPage onOpenStudyTool={openStudyToolFromHub} />;
          } else if (cachedRoute.type === 'settings') {
            pageContent = (
              <SettingsPage
                user={user}
                settings={userSettings}
                onSettingsChange={handleSettingsChange}
              />
            );
          } else if (cachedRoute.type === 'socratic-tutor') {
            pageContent = (
              <div className="socratic-page-shell">
                <SocraticTutorPage initialContext={cachedRoute.context as any} />
              </div>
            );
          } else if (cachedRoute.type === 'study-tool') {
            pageContent = (
              <StudyToolPage
                tool={cachedRoute.tool}
                initialSubjectId={cachedRoute.subjectId}
                onBack={() =>
                  setRoute({
                    type: cachedRoute.backTo === 'study-tools' ? 'study-tools' : 'notes',
                  })
                }
              />
            );
          } else if (cachedRoute.type === 'subject') {
            pageContent = (
              <SubjectDetailPage
                subjectId={cachedRoute.subjectId}
                onBack={goBackToWhiteboard}
                onOpenAssignment={(assignmentId) => openAssignment(cachedRoute.subjectId, assignmentId)}
              />
            );
          } else if (cachedRoute.type === 'assignment') {
            pageContent = (
              <AssignmentDetailPage
                subjectId={cachedRoute.subjectId}
                assignmentId={cachedRoute.assignmentId}
                onBack={() => goBackToSubject(cachedRoute.subjectId)}
                onOpenProblem={(problemIndex) =>
                  openProblem(cachedRoute.subjectId, cachedRoute.assignmentId, problemIndex)
                }
              />
            );
          } else if (cachedRoute.type === 'problem') {
            pageContent = (
              <ProblemBoardPage
                subjectId={cachedRoute.subjectId}
                assignmentId={cachedRoute.assignmentId}
                problemIndex={cachedRoute.problemIndex}
                onBack={() => openAssignment(cachedRoute.subjectId, cachedRoute.assignmentId)}
              />
            );
          }

          return (
            <div
              key={routeKey}
              style={{
                display: isActive ? 'block' : 'none',
                height: isActive ? 'auto' : 0,
                overflow: 'hidden',
              }}
              aria-hidden={!isActive}
            >
              {pageContent}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default App;
