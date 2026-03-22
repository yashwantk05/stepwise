import React, { useState, useEffect, useCallback } from 'react';
import "../styles/index.css";
import "../styles/app.css";
import {
  getCurrentUser,
  signOut,
  requestAccountDeletion,
  getLearningStreakSummary,
  recordLearningActivity,
} from './services/storage';
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
import type { StudyToolType } from './services/studyTools';

type Route =
  | { type: 'dashboard' }
  | { type: 'whiteboard' }
  | { type: 'notes' }
  | { type: 'weak-areas' }
  | { type: 'progress-analytics' }
  | { type: 'socratic-tutor'; context?: Record<string, unknown> }
  | { type: 'study-tool'; tool: StudyToolType; subjectId?: string }
  | { type: 'subject'; subjectId: string }
  | { type: 'assignment'; subjectId: string; assignmentId: string }
  | { type: 'problem'; subjectId: string; assignmentId: string; problemIndex: number };

function App() {
  const [user, setUser] = useState<any>(null);
  const [authReady, setAuthReady] = useState(false);
  const [route, setRoute] = useState<Route>({ type: 'dashboard' });
  const [isCompactLayout, setIsCompactLayout] = useState(() => window.innerWidth <= 1024);
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => window.innerWidth > 1024);
  const [streakCount, setStreakCount] = useState(0);
  const [notificationCount, setNotificationCount] = useState(0);

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
    const onResize = () => {
      const compact = window.innerWidth <= 1024;
      setIsCompactLayout(compact);
      setIsSidebarOpen(!compact);
    };

    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
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

    if (isCompactLayout) {
      setIsSidebarOpen(false);
    }
  }, [isCompactLayout]);

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
    if (route.type === 'socratic-tutor') return 'socratic-tutor';
    if (route.type === 'study-tool') return route.tool;
    return 'whiteboard';
  };

  return (
    <div className="app-layout">
      {isCompactLayout && isSidebarOpen && (
        <button
          className="sidebar-backdrop"
          aria-label="Close menu"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}
      <Sidebar
        currentPage={getCurrentPage()}
        onNavigate={navigate}
        isOpen={isSidebarOpen}
        isCompact={isCompactLayout}
        onClose={() => setIsSidebarOpen(false)}
      />

      <div className="app-main">
        <Topbar
          user={user}
          onSignOut={handleSignOut}
          onDeleteAccount={handleDeleteAccount}
          showSidebarToggle={isCompactLayout}
          onToggleSidebar={() => setIsSidebarOpen((prev) => !prev)}
          streakCount={streakCount}
          notificationCount={notificationCount}
        />

        {route.type === 'dashboard' && (
          <DashboardPage
            user={user}
            onOpenWhiteboard={() => setRoute({ type: 'whiteboard' })}
            onOpenNotes={() => setRoute({ type: 'notes' })}
            onOpenStudyTool={openStudyTool}
            onDashboardMetaChange={({ recommendationCount, streak }) => {
              setNotificationCount(recommendationCount);
              setStreakCount(streak);
            }}
          />
        )}

        {route.type === 'whiteboard' && (
          <WhiteboardPage onOpenSubject={openSubject} />
        )}

        {route.type === 'notes' && <MyNotesPage onOpenTool={openStudyTool} />}

        {route.type === 'weak-areas' && <WeakAreasPage />}

        {route.type === 'progress-analytics' && <ProgressAnalyticsPage />}

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
