import React, { useEffect, useRef, useState } from 'react';

export function BouncyBall({ onComplete }: { onComplete: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [level, setLevel] = useState(1);
  const [gameOver, setGameOver] = useState(false);
  const [score, setScore] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    const wallThickness = 16;
    const paddleWidth = 96;
    const paddleHeight = 14;
    const paddleY = canvas.height - 34;
    const baseSpeedX = 2.2 + level * 0.65;
    const baseSpeedY = 2.8 + level * 0.8;

    let animationFrame = 0;
    let paddleX = canvas.width / 2;
    let targetPaddleX = canvas.width / 2;
    let ballX = canvas.width / 2;
    let ballY = 138;
    let velocityX = baseSpeedX;
    let velocityY = baseSpeedY;
    let localScore = 0;

    const clampPaddle = (value: number) =>
      Math.max(wallThickness + paddleWidth / 2, Math.min(canvas.width - wallThickness - paddleWidth / 2, value));

    const updateTargetFromClientX = (clientX: number) => {
      const bounds = canvas.getBoundingClientRect();
      targetPaddleX = clampPaddle(clientX - bounds.left);
    };

    const onPointerMove = (event: PointerEvent) => {
      updateTargetFromClientX(event.clientX);
    };

    const onTouchMove = (event: TouchEvent) => {
      if (event.touches[0]) {
        updateTargetFromClientX(event.touches[0].clientX);
      }
    };

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft') {
        targetPaddleX = clampPaddle(targetPaddleX - 34);
      }
      if (event.key === 'ArrowRight') {
        targetPaddleX = clampPaddle(targetPaddleX + 34);
      }
    };

    const drawWalls = () => {
      context.fillStyle = '#4c1d95';
      context.fillRect(0, 0, wallThickness, canvas.height);
      context.fillRect(canvas.width - wallThickness, 0, wallThickness, canvas.height);
      context.fillRect(0, 0, canvas.width, wallThickness);
    };

    const render = () => {
      context.clearRect(0, 0, canvas.width, canvas.height);

      const backdrop = context.createLinearGradient(0, 0, canvas.width, canvas.height);
      backdrop.addColorStop(0, '#faf5ff');
      backdrop.addColorStop(1, '#eef2ff');
      context.fillStyle = backdrop;
      context.fillRect(0, 0, canvas.width, canvas.height);

      drawWalls();

      context.fillStyle = 'rgba(124, 58, 237, 0.08)';
      context.fillRect(wallThickness, wallThickness, canvas.width - wallThickness * 2, canvas.height - wallThickness);

      paddleX += (targetPaddleX - paddleX) * 0.18;
      paddleX = clampPaddle(paddleX);

      const paddleGradient = context.createLinearGradient(paddleX - paddleWidth / 2, 0, paddleX + paddleWidth / 2, 0);
      paddleGradient.addColorStop(0, '#60a5fa');
      paddleGradient.addColorStop(1, '#7c3aed');
      context.fillStyle = paddleGradient;
      context.beginPath();
      context.roundRect(paddleX - paddleWidth / 2, paddleY, paddleWidth, paddleHeight, 999);
      context.fill();

      context.beginPath();
      context.fillStyle = '#4c1d95';
      context.arc(ballX, ballY, 10, 0, Math.PI * 2);
      context.fill();

      ballX += velocityX;
      ballY += velocityY;

      if (ballX <= wallThickness + 10 || ballX >= canvas.width - wallThickness - 10) {
        velocityX *= -1;
        ballX = Math.max(wallThickness + 10, Math.min(canvas.width - wallThickness - 10, ballX));
      }
      if (ballY <= wallThickness + 10) {
        velocityY *= -1;
        ballY = wallThickness + 10;
      }

      if (
        ballY >= paddleY - 10 &&
        ballY <= paddleY + paddleHeight &&
        ballX >= paddleX - paddleWidth / 2 - 6 &&
        ballX <= paddleX + paddleWidth / 2 + 6 &&
        velocityY > 0
      ) {
        const hitOffset = (ballX - paddleX) / (paddleWidth / 2);
        velocityX = (baseSpeedX + Math.abs(hitOffset) * 2.4) * hitOffset;
        velocityY = -baseSpeedY;
        ballY = paddleY - 10;
        localScore += 1;
        setScore(localScore);
        if (localScore >= 12) {
          onComplete();
        }
      }

      if (ballY > canvas.height + 12) {
        setGameOver(true);
        return;
      }

      animationFrame = window.requestAnimationFrame(render);
    };

    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('keydown', onKey);
    animationFrame = window.requestAnimationFrame(render);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('keydown', onKey);
    };
  }, [level, onComplete]);

  return (
    <div className="bouncy-shell refined">
      <div className="bouncy-toolbar">
        <div className="bouncy-levels">
          {[1, 2, 3].map((value) => (
            <button
              key={value}
              type="button"
              className={`refresh-chip ${level === value ? 'active' : ''}`}
              onClick={() => {
                setScore(0);
                setGameOver(false);
                setLevel(value);
              }}
            >
              Level {value}
            </button>
          ))}
        </div>
        <span>Score: {score}</span>
      </div>
      <canvas ref={canvasRef} width={420} height={420} className="bouncy-canvas refined" />
      {gameOver && <p className="bouncy-status">Game over. Pick a level to jump back in.</p>}
    </div>
  );
}
