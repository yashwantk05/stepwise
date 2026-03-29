import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Gamepad2, Sparkles, TimerReset } from 'lucide-react';
import { Game2048 } from '../components/Game2048';
import { GameCard } from '../components/GameCard';
import { GameContainer } from '../components/GameContainer';
import { LockOverlay } from '../components/LockOverlay';
import { RewardPopup } from '../components/RewardPopup';
import { Sudoku } from '../components/Sudoku';
import { TimerDisplay } from '../components/TimerDisplay';
import { trackEvent } from '../services/analytics';
import { getLearningActivity } from '../services/storage';

type GameId = 'sudoku' | '2048' | null;

const INITIAL_BONUS_SECONDS = 300;
const REWARD_SECONDS = 300;
const STUDY_BLOCK_SECONDS = 1800;
const STORAGE_PREFIX = 'stepwise_refresh_zone';

const readNumber = (key: string, fallback: number) => {
  const raw = localStorage.getItem(key);
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const getTotalStudySeconds = () =>
  Object.values(getLearningActivity() || {}).reduce((sum, value) => sum + Number(value || 0), 0);

export function RefreshZonePage() {
  const [studySecondsSnapshot, setStudySecondsSnapshot] = useState(() => getTotalStudySeconds());
  const [activeGame, setActiveGame] = useState<GameId>(null);
  const [usedSeconds, setUsedSeconds] = useState(() => readNumber(`${STORAGE_PREFIX}:used`, 0));
  const [claimedStudyBlocks, setClaimedStudyBlocks] = useState(() =>
    readNumber(`${STORAGE_PREFIX}:claimedStudyBlocks`, 0),
  );
  const [rewardOpen, setRewardOpen] = useState(false);
  const sessionSpentRef = useRef(0);
  const exhaustedRef = useRef(false);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setStudySecondsSnapshot(getTotalStudySeconds());
    }, 15000);
    return () => window.clearInterval(interval);
  }, []);

  const totalStudySeconds = studySecondsSnapshot;
  const earnedStudyBlocks = Math.floor(totalStudySeconds / STUDY_BLOCK_SECONDS);
  const totalEntitlement = INITIAL_BONUS_SECONDS + earnedStudyBlocks * REWARD_SECONDS;
  const availableTime = Math.max(0, totalEntitlement - usedSeconds);
  const isLocked = availableTime <= 0;
  const isPlaying = !isLocked && activeGame !== null;

  useEffect(() => {
    trackEvent('refresh_zone_opened', { totalStudySeconds, availableTime });
    const initialBonusGranted = localStorage.getItem(`${STORAGE_PREFIX}:initialBonusGranted`);
    if (!initialBonusGranted) {
      localStorage.setItem(`${STORAGE_PREFIX}:initialBonusGranted`, 'true');
      trackEvent('initial_reward_granted', { seconds: INITIAL_BONUS_SECONDS });
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(`${STORAGE_PREFIX}:used`, String(usedSeconds));
  }, [usedSeconds]);

  useEffect(() => {
    if (earnedStudyBlocks > claimedStudyBlocks) {
      const delta = earnedStudyBlocks - claimedStudyBlocks;
      setClaimedStudyBlocks(earnedStudyBlocks);
      localStorage.setItem(`${STORAGE_PREFIX}:claimedStudyBlocks`, String(earnedStudyBlocks));
      setRewardOpen(true);
      trackEvent('reward_earned', { blocks: delta, seconds: delta * REWARD_SECONDS });
    }
  }, [claimedStudyBlocks, earnedStudyBlocks]);

  useEffect(() => {
    if (!isPlaying) return;

    const interval = window.setInterval(() => {
      setUsedSeconds((previous) => previous + 1);
      sessionSpentRef.current += 1;
    }, 1000);

    return () => window.clearInterval(interval);
  }, [isPlaying]);

  useEffect(() => {
    return () => {
      if (sessionSpentRef.current > 0) {
        trackEvent('break_time_used', { seconds: sessionSpentRef.current });
      }
    };
  }, []);

  useEffect(() => {
    if (availableTime === 0 && !exhaustedRef.current) {
      exhaustedRef.current = true;
      if (sessionSpentRef.current > 0) {
        trackEvent('break_time_used', { seconds: sessionSpentRef.current });
        sessionSpentRef.current = 0;
      }
      trackEvent('break_time_exhausted');
      window.setTimeout(() => {
        window.alert('⏳ Break time over — back to learning!');
      }, 100);
      setActiveGame(null);
      return;
    }
    if (availableTime > 0) {
      exhaustedRef.current = false;
    }
  }, [availableTime]);

  const handleGameStart = (game: Exclude<GameId, null>) => {
    if (isLocked) return;
    setActiveGame(game);
    trackEvent('game_started', { game });
  };

  const handleBackToGames = () => {
    if (sessionSpentRef.current > 0) {
      trackEvent('break_time_used', { seconds: sessionSpentRef.current, game: activeGame });
      sessionSpentRef.current = 0;
    }
    setActiveGame(null);
  };

  const handleGameComplete = (game: Exclude<GameId, null>) => {
    trackEvent('game_completed', { game });
  };

  const summary = useMemo(() => {
    const nextRewardAt = (earnedStudyBlocks + 1) * STUDY_BLOCK_SECONDS;
    const remainingStudyForNextReward = Math.max(0, nextRewardAt - totalStudySeconds);
    return {
      earnedMinutes: Math.floor(totalEntitlement / 60),
      spentMinutes: Math.floor(usedSeconds / 60),
      nextRewardMinutes: Math.ceil(remainingStudyForNextReward / 60),
    };
  }, [earnedStudyBlocks, totalEntitlement, totalStudySeconds, usedSeconds]);

  return (
    <section className="refresh-zone-page">
      <div className="refresh-zone-header">
        <div>
          <span className="weak-kicker"><Gamepad2 size={16} /> Refresh Zone</span>
          <h1>Refresh Zone</h1>
          <p>Earn break time by studying, then spend it intentionally on a short reset.</p>
        </div>
        <TimerDisplay seconds={availableTime} />
      </div>

      <div className={`refresh-zone-shell ${!isLocked ? 'unlocked' : 'locked'}`}>
        {isLocked && <LockOverlay />}

        <div className="refresh-zone-summary">
          <div className="refresh-stat-card">
            <Sparkles size={18} />
            <div>
              <strong>{summary.earnedMinutes} mins earned</strong>
              <span>Initial reward + study rewards stacked over time</span>
            </div>
          </div>
          <div className="refresh-stat-card">
            <TimerReset size={18} />
            <div>
              <strong>{summary.nextRewardMinutes} mins to next reward</strong>
              <span>Every 30 minutes of study adds 5 more break minutes</span>
            </div>
          </div>
        </div>

        {activeGame === null ? (
          <div className="refresh-zone-grid">
            <GameCard
              title="Sudoku"
              description="Choose your difficulty and fill the 9×9 board one focused step at a time."
              accent="linear-gradient(135deg, #60a5fa, #7c3aed)"
              onClick={() => handleGameStart('sudoku')}
            />
            <GameCard
              title="2048"
              description="Merge tiles with arrow keys and chase the 2048 target before your break ends."
              accent="linear-gradient(135deg, #f59e0b, #f97316)"
              onClick={() => handleGameStart('2048')}
            />
          </div>
        ) : null}

        {activeGame === 'sudoku' ? (
          <GameContainer title="Sudoku" subtitle="Easy, medium, or hard depending on how much challenge you want." onBack={handleBackToGames}>
            <Sudoku onComplete={() => handleGameComplete('sudoku')} />
          </GameContainer>
        ) : null}

        {activeGame === '2048' ? (
          <GameContainer title="2048" subtitle="Use arrow keys to merge tiles and build up to 2048." onBack={handleBackToGames}>
            <Game2048 onComplete={() => handleGameComplete('2048')} />
          </GameContainer>
        ) : null}

      </div>

      <RewardPopup
        open={rewardOpen}
        onClose={() => {
          setRewardOpen(false);
          setActiveGame(null);
        }}
      />
    </section>
  );
}
