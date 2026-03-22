import React, { useState, useRef, useEffect } from 'react';

interface TopbarProps {
  user: any;
  onSignOut: () => void;
  onDeleteAccount: () => void;
  showSidebarToggle?: boolean;
  onToggleSidebar?: () => void;
}

export function Topbar({
  user,
  onSignOut,
  onDeleteAccount,
  showSidebarToggle = false,
  onToggleSidebar,
}: TopbarProps) {
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const avatarSrc = String(
    user?.avatarUrl || user?.avatarURL || user?.photoURL || user?.picture || "",
  ).trim();

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowAccountMenu(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    setAvatarFailed(false);
  }, [avatarSrc]);

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  return (
    <div className="app-topbar">
      <div className="topbar-left">
        {showSidebarToggle && (
          <button className="icon-button sidebar-toggle-btn" onClick={onToggleSidebar} title="Open menu" aria-label="Open menu">
            <svg width="22" height="22" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.4">
              <path d="M3 5h14M3 10h14M3 15h14" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>

      <div className="topbar-actions">
        <div style={{ position: 'relative' }} ref={menuRef}>
          <button
            className={`account-button ${avatarSrc && !avatarFailed ? 'account-button-with-photo' : ''}`}
            onClick={() => setShowAccountMenu(!showAccountMenu)}
            title={user.name}
          >
            {avatarSrc && !avatarFailed ? (
              <img
                src={avatarSrc}
                alt={`${user.name} profile`}
                className="account-avatar-image"
                referrerPolicy="no-referrer"
                onError={() => setAvatarFailed(true)}
              />
            ) : (
              getInitials(user.name)
            )}
          </button>

          {showAccountMenu && (
            <div className="account-menu">
              <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--line)', marginBottom: '8px' }}>
                <div style={{ fontWeight: 600, fontSize: '14px' }}>{user.name}</div>
                <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '2px' }}>{user.email}</div>
              </div>
              
              <button onClick={onSignOut}>
                <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M7 3H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h2M13 10h8m0 0l-3-3m3 3l-3 3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Sign Out
              </button>
              
              <div className="account-menu-divider" />
              
              <button className="danger" onClick={onDeleteAccount}>
                <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 6h14M8 6V4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v2m3 0v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h10z" strokeLinecap="round" />
                </svg>
                Delete Account
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
