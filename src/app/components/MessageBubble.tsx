import React from 'react';

interface MessageBubbleProps {
  role: 'assistant' | 'user';
  author: string;
  text: string;
  time: string;
}

export function MessageBubble({ role, author, text, time }: MessageBubbleProps) {
  return (
    <article className={`socratic-bubble socratic-bubble-${role}`}>
      <p>{text}</p>
    </article>
  );
}
