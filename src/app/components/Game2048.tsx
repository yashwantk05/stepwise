import React, { useCallback, useEffect, useMemo, useState } from 'react';

const BEST_SCORE_KEY = 'stepwise_refresh_2048_best';

const createBoard = () => {
  const board = Array(16).fill(0);
  addRandomTile(board);
  addRandomTile(board);
  return board;
};

const addRandomTile = (board: number[]) => {
  const emptyIndexes = board.map((value, index) => (value === 0 ? index : -1)).filter((value) => value !== -1);
  if (emptyIndexes.length === 0) return board;
  const nextIndex = emptyIndexes[Math.floor(Math.random() * emptyIndexes.length)];
  board[nextIndex] = Math.random() > 0.12 ? 2 : 4;
  return board;
};

const slideLine = (line: number[]) => {
  const filled = line.filter(Boolean);
  const merged: number[] = [];
  for (let index = 0; index < filled.length; index += 1) {
    if (filled[index] === filled[index + 1]) {
      merged.push(filled[index] * 2);
      index += 1;
    } else {
      merged.push(filled[index]);
    }
  }
  while (merged.length < 4) merged.push(0);
  return merged;
};

const moveBoard = (board: number[], direction: 'left' | 'right' | 'up' | 'down') => {
  const next = [...board];
  const readRow = (row: number) => next.slice(row * 4, row * 4 + 4);
  const writeRow = (row: number, values: number[]) => values.forEach((value, idx) => { next[row * 4 + idx] = value; });
  const readCol = (col: number) => [next[col], next[col + 4], next[col + 8], next[col + 12]];
  const writeCol = (col: number, values: number[]) => values.forEach((value, idx) => { next[col + idx * 4] = value; });

  for (let i = 0; i < 4; i += 1) {
    if (direction === 'left' || direction === 'right') {
      const line = readRow(i);
      const working = direction === 'right' ? [...line].reverse() : line;
      const slid = slideLine(working);
      writeRow(i, direction === 'right' ? slid.reverse() : slid);
    } else {
      const line = readCol(i);
      const working = direction === 'down' ? [...line].reverse() : line;
      const slid = slideLine(working);
      writeCol(i, direction === 'down' ? slid.reverse() : slid);
    }
  }

  const changed = next.some((value, index) => value !== board[index]);
  return changed ? addRandomTile(next) : board;
};

const readBestScore = () => {
  const stored = Number(localStorage.getItem(BEST_SCORE_KEY));
  return Number.isFinite(stored) ? stored : 0;
};

export function Game2048({ onComplete }: { onComplete: () => void }) {
  const [board, setBoard] = useState<number[]>(() => createBoard());
  const [bestScore, setBestScore] = useState(() => readBestScore());

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const keyMap: Record<string, 'left' | 'right' | 'up' | 'down'> = {
        ArrowLeft: 'left',
        ArrowRight: 'right',
        ArrowUp: 'up',
        ArrowDown: 'down',
      };
      const direction = keyMap[event.key];
      if (!direction) return;
      event.preventDefault();
      setBoard((previous) => moveBoard(previous, direction));
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (board.some((value) => value >= 2048)) {
      onComplete();
    }
  }, [board, onComplete]);

  const score = useMemo(() => board.reduce((sum, value) => sum + value, 0), [board]);

  useEffect(() => {
    if (score > bestScore) {
      setBestScore(score);
      localStorage.setItem(BEST_SCORE_KEY, String(score));
    }
  }, [bestScore, score]);

  const reset = useCallback(() => setBoard(createBoard()), []);

  return (
    <div className="game-2048-shell refined">
      <div className="game-2048-layout">
        <div className="game-2048-sidebar">
          <div className="game-2048-heading">
            <h2>2048</h2>
            <p>Use your arrow keys to move the tiles. When two tiles with the same number touch, they merge into one.</p>
          </div>

          <div className="game-2048-scoreboard">
            <div className="game-2048-score-card">
              <strong>Score</strong>
              <span>{score}</span>
            </div>
            <div className="game-2048-score-card">
              <strong>Best</strong>
              <span>{bestScore}</span>
            </div>
          </div>

          <button type="button" className="game-2048-new-game" onClick={reset}>
            New Game
          </button>

          <div className="game-2048-help">
            <strong>How to play:</strong> Keep merging matching tiles to climb toward 2048 before your break time runs out.
          </div>
        </div>

        <div className="game-2048-board-shell">
          <div className="game-2048-grid refined">
            {board.map((value, index) => (
              <div key={index} className={`game-2048-tile value-${value || 0}`}>
                {value || ''}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
