import React from 'react';

const formatTime = (seconds: number) => {
  const safeSeconds = Math.max(0, seconds);
  const mins = String(Math.floor(safeSeconds / 60)).padStart(2, '0');
  const secs = String(safeSeconds % 60).padStart(2, '0');
  return `${mins}:${secs}`;
};

export function TimerDisplay({ seconds }: { seconds: number }) {
  return (
    <div className="refresh-timer">
      <span>⏳ Available Break Time</span>
      <strong>{formatTime(seconds)}</strong>
    </div>
  );
}
