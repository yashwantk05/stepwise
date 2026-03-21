import React, { useState, useEffect, useCallback } from 'react';
import "../styles/index.css";
import "../styles/app.css";
import { getCurrentUser, signOut, requestAccountDeletion } from './services/storage';
import { Sidebar } from './components/Sidebar';
import { Topbar } from './components/Topbar';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { WhiteboardPage } from './pages/WhiteboardPage';
import { MyNotesPage } from './pages/MyNotesPage';
import { SubjectDetailPage } from './pages/SubjectDetailPage';
import { AssignmentDetailPage } from './pages/AssignmentDetailPage';
import { ProblemBoardPage } from './pages/ProblemBoardPage';

type Route = 
  | { type: 'dashboard' }
  | { type: 'whiteboard' }
  | { type: 'notes' }
  | { type: 'subject'; subjectId: string }
  | { type: 'assignment'; subjectId: string; assignmentId: string }
  | { type: 'problem'; subjectId: string; assignmentId: string; problemIndex: number };

function App() {
  const [user, setUser] = useState<any>(null);
  const [authReady, setAuthReady] = useState(false);
  const [route, setRoute] = useState<Route>({ type: 'dashboard' });
  const [isCompactLayout, setIsCompactLayout] = useState(() => window.innerWidth <= 1024);
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => window.innerWidth > 1024);

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

  const handleSignOut = useCallback(async () => {
    await signOut();
    setUser(null);
  }, []);

  const handleDeleteAccount = useCallback(async () => {
    const confirmed = window.confirm(
      "Delete your account? This will remove all subjects, assignments, and uploaded files."
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
        />
        
        {route.type === 'dashboard' && <DashboardPage user={user} />}
        
        {route.type === 'whiteboard' && (
          <WhiteboardPage onOpenSubject={openSubject} />
        )}

        {route.type === 'notes' && <MyNotesPage />}
        
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
