import React from 'react';

export function GameContainer({
  title,
  subtitle,
  onBack,
  children,
}: {
  title: string;
  subtitle: string;
  onBack: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="refresh-game-shell">
      <div className="refresh-game-shell-header">
        <button type="button" className="refresh-back-button" onClick={onBack}>
          ← Back to Games
        </button>
        <div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
      </div>
      <div className="refresh-game-shell-body">{children}</div>
    </section>
  );
}
