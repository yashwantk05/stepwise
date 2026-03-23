import React from 'react';
import { MessageBubble } from './MessageBubble';

interface ChatMessage {
  id: string;
  role: 'assistant' | 'user';
  text: string;
  time: string;
  images?: { previewUrl: string }[];
}

export function SocraticChat({ messages }: { messages: ChatMessage[] }) {
  return (
    <section className="socratic-chat-shell">
      {messages.map((message) => (
        <MessageBubble
          key={message.id}
          role={message.role}
          author={message.role === 'assistant' ? 'Socratic Tutor' : 'You'}
          text={message.text}
          time={message.time}
          images={message.images}
        />
      ))}
    </section>
  );
}
