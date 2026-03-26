import React, { useState, useRef, useEffect } from 'react';
import { Flame, Settings, Square } from 'lucide-react';

interface TopbarProps {
  user: any;
  onSignOut: () => void;
  onDeleteAccount: () => void;
  onOpenSettings: () => void;
  onStopAudio: () => void;
  showAudioControl: boolean;
  isAudioPlaying: boolean;
  streakCount: number;
  notificationCount: number;
}

export function Topbar({
  user,
  onSignOut,
  onDeleteAccount,
  onOpenSettings,
  onStopAudio,
  showAudioControl,
  isAudioPlaying,
  streakCount,
  notificationCount,
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

  const handleOpenSettings = () => {
    setShowAccountMenu(false);
    onOpenSettings();
  };

  return (
    <div className="app-topbar">
      <div className="topbar-left">
        <div className="main-page-logo" aria-label="StepWise">
          M
        </div>
      </div>

      <div className="topbar-actions">
        {showAudioControl ? (
          <button
            type="button"
            className={`topbar-audio-button ${isAudioPlaying ? 'is-playing' : ''}`}
            onClick={onStopAudio}
            title="Stop audio narration"
            aria-label="Stop audio narration"
          >
            <Square size={16} />
            <span>Stop Audio</span>
          </button>
        ) : null}

        <div className="topbar-streak-pill" title="Learning streak">
          <Flame size={18} />
          <span>{streakCount}</span>
        </div>

        <button className="icon-button notification-button" title="AI Recommendations">
          <img
            src="/notification-bell-svgrepo-com.svg"
            alt=""
            aria-hidden="true"
            className="notification-icon"
          />
          {notificationCount > 0 ? <span className="notification-badge">{notificationCount}</span> : null}
        </button>
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

              <button onClick={handleOpenSettings}>
                <Settings size={16} />
                Settings
              </button>
              
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
