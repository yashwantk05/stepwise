import React from 'react';
import { Play, Square } from 'lucide-react';

interface MessageBubbleProps {
  id: string;
  role: 'assistant' | 'user';
  author: string;
  avatar?: string;
  text: string;
  time: string;
  images?: { previewUrl: string }[];
  isPlaying?: boolean;
  onTogglePlay?: (messageId: string, text: string) => void;
}

export function MessageBubble({ id, role, author, avatar, text, time, images, isPlaying = false, onTogglePlay }: MessageBubbleProps) {
  return (
    <article className={`socratic-bubble socratic-bubble-${role}`}>
      {role === 'assistant' && text && onTogglePlay ? (
        <button
          type="button"
          className="socratic-bubble-play"
          onClick={() => onTogglePlay(id, text)}
          aria-label={isPlaying ? 'Stop assistant response' : 'Play assistant response'}
          title={isPlaying ? 'Stop' : 'Play response'}
        >
          {isPlaying ? <Square size={13} /> : <Play size={14} />}
        </button>
      ) : null}
      <div className="socratic-bubble-meta">
        {role === 'assistant' ? (
          <span className="socratic-bubble-avatar" aria-hidden="true">
            {avatar || 'AI'}
          </span>
        ) : null}
        <div className="socratic-bubble-meta-copy">
          <strong className="socratic-bubble-author">{author}</strong>
          <span className="socratic-bubble-time">{time}</span>
        </div>
      </div>
      {images && images.length > 0 && (
        <div className="socratic-bubble-images">
          {images.map((img, i) => (
            <img
              key={i}
              src={img.previewUrl}
              alt={`Attached ${i + 1}`}
              className="socratic-bubble-image"
              onClick={() => window.open(img.previewUrl, '_blank')}
            />
          ))}
        </div>
      )}
      {text && <p>{text}</p>}
    </article>
  );
}
