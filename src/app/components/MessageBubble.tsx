import React from 'react';

interface MessageBubbleProps {
  role: 'assistant' | 'user';
  author: string;
  text: string;
  time: string;
  images?: { previewUrl: string }[];
}

export function MessageBubble({ role, author, text, time, images }: MessageBubbleProps) {
  return (
    <article className={`socratic-bubble socratic-bubble-${role}`}>
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
