import React from 'react';

interface GameCardProps {
  title: string;
  description: string;
  accent: string;
  onClick: () => void;
}

export function GameCard({ title, description, accent, onClick }: GameCardProps) {
  return (
    <button className="refresh-game-card" type="button" onClick={onClick}>
      <span className="refresh-game-card-accent" style={{ background: accent }} />
      <h3>{title}</h3>
      <p>{description}</p>
      <span className="refresh-game-card-cta">Play now</span>
    </button>
  );
}
