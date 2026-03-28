import React from 'react';
import Lottie from 'lottie-react';
import trophyAnimation from '../assets/Trophy.json';

export function RewardPopup({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  if (!open) return null;

  return (
    <div className="refresh-reward-popup-backdrop">
      <div className="refresh-reward-popup">
        <div className="refresh-reward-animation">
          <Lottie animationData={trophyAnimation} loop={false} />
        </div>
        <h2>Great job!</h2>
        <p>You've earned 5 minutes of break time. Take a moment to relax and play.</p>
        <button type="button" className="btn-primary" onClick={onClose}>
          Enter Refresh Zone
        </button>
      </div>
    </div>
  );
}
