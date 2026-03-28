import React from 'react';

export function LockOverlay() {
  return (
    <div className="refresh-lock-overlay">
      <div className="refresh-lock-card">
        <span className="refresh-lock-icon">🔒</span>
        <h2>Refresh Zone Locked</h2>
        <p>Study for 30 minutes to earn more break time</p>
      </div>
    </div>
  );
}
