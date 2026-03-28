import React, { useEffect, useMemo, useState } from 'react';

const PUZZLES = {
  easy: {
    puzzle:
      '530070000600195000098000060800060003400803001700020006060000280000419005000080079',
    solution:
      '534678912672195348198342567859761423426853791713924856961537284287419635345286179',
  },
  medium: {
    puzzle:
      '000260701680070090190004500820100040004602900050003028009300074040050036703018000',
    solution:
      '435269781682571493197834562826195347374682915951743628519326874248957136763418259',
  },
  hard: {
    puzzle:
      '000000907000420180000705026100904000050000040000507009920108000034059000507000000',
    solution:
      '483651927659423187271795326162934875795812643348567219926178534834259761517346298',
  },
} as const;

type Difficulty = keyof typeof PUZZLES;

const getCellMeta = (index: number) => ({
  row: Math.floor(index / 9),
  col: index % 9,
  box: Math.floor(index / 27) * 3 + Math.floor((index % 9) / 3),
});

export function Sudoku({ onComplete }: { onComplete: () => void }) {
  const [difficulty, setDifficulty] = useState<Difficulty>('easy');
  const [cells, setCells] = useState<string[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(0);

  const current = useMemo(() => PUZZLES[difficulty], [difficulty]);

  useEffect(() => {
    setCells(current.puzzle.split(''));
    setSelectedIndex(0);
  }, [current]);

  useEffect(() => {
    if (cells.length === 81 && cells.join('') === current.solution) {
      onComplete();
    }
  }, [cells, current.solution, onComplete]);

  const selectedMeta = selectedIndex === null ? null : getCellMeta(selectedIndex);

  const setCellValue = (index: number, rawValue: string) => {
    if (current.puzzle[index] !== '0') return;
    const nextValue = rawValue.replace(/[^1-9]/g, '').slice(-1);
    setCells((previous) => {
      const next = [...previous];
      next[index] = nextValue || '0';
      return next;
    });
  };

  return (
    <div className="sudoku-shell refined">
      <div className="sudoku-stage">
        <div className="sudoku-board-wrap">
          <div className="sudoku-board-frame">
            <div className="sudoku-grid refined">
              {cells.map((value, index) => {
                const locked = current.puzzle[index] !== '0';
                const meta = getCellMeta(index);
                const isSelected = selectedIndex === index;
                const related =
                  selectedMeta !== null &&
                  (selectedMeta.row === meta.row ||
                    selectedMeta.col === meta.col ||
                    selectedMeta.box === meta.box);
                const sameValue =
                  selectedIndex !== null &&
                  cells[selectedIndex] !== '0' &&
                  cells[selectedIndex] === value &&
                  value !== '0';

                return (
                  <button
                    key={index}
                    type="button"
                    className={[
                      'sudoku-cell',
                      'refined',
                      locked ? 'locked' : '',
                      isSelected ? 'selected' : '',
                      !isSelected && related ? 'related' : '',
                      sameValue ? 'same-value' : '',
                      (meta.col + 1) % 3 === 0 && meta.col !== 8 ? 'col-divider' : '',
                      (meta.row + 1) % 3 === 0 && meta.row !== 8 ? 'row-divider' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onClick={() => setSelectedIndex(index)}
                  >
                    <span>{value === '0' ? '' : value}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <aside className="sudoku-panel">
          <div className="sudoku-mode-switch" role="tablist" aria-label="Sudoku mode">
            <button type="button" className="active">
              Normal
            </button>
            <button type="button" disabled>
              Candidate
            </button>
          </div>

          <div className="sudoku-number-pad">
            {Array.from({ length: 9 }, (_, index) => index + 1).map((value) => (
              <button
                key={value}
                type="button"
                className="sudoku-pad-key"
                onClick={() => {
                  if (selectedIndex === null) return;
                  setCellValue(selectedIndex, String(value));
                }}
              >
                {value}
              </button>
            ))}
          </div>

          <div className="sudoku-pad-actions">
            <button
              type="button"
              className="sudoku-pad-action"
              onClick={() => {
                if (selectedIndex === null) return;
                setCellValue(selectedIndex, '');
              }}
            >
              ×
            </button>
            <button
              type="button"
              className="sudoku-pad-action muted"
              onClick={() => {
                setCells(current.puzzle.split(''));
                setSelectedIndex(0);
              }}
            >
              Undo
            </button>
          </div>

          <div className="sudoku-difficulty">
            {(['easy', 'medium', 'hard'] as Difficulty[]).map((level) => (
              <button
                key={level}
                type="button"
                className={`refresh-chip ${difficulty === level ? 'active' : ''}`}
                onClick={() => setDifficulty(level)}
              >
                {level}
              </button>
            ))}
          </div>

          <label className="sudoku-candidate-toggle">
            <input type="checkbox" disabled />
            <span>Auto Candidate Mode</span>
          </label>
        </aside>
      </div>
    </div>
  );
}
