import React from 'react';
import { MessageBubble } from './MessageBubble';

interface ChatMessage {
  id: string;
  role: 'assistant' | 'user';
  text: string;
  time: string;
  tutorId?: 'vaani' | 'saarthi';
  images?: { previewUrl: string }[];
}

type TutorMode = 'saarthi' | 'vaani';

const tutorMeta = {
  vaani: { author: 'Vaani', avatar: '👩' },
  saarthi: { author: 'Saarthi', avatar: '👨' },
} as const;

export function SocraticChat({
  messages,
  tutorMode,
  playingAssistantMessageId,
  onToggleAssistantMessageAudio,
}: {
  messages: ChatMessage[];
  tutorMode: TutorMode;
  playingAssistantMessageId?: string | null;
  onToggleAssistantMessageAudio?: (messageId: string, text: string) => void;
}) {
  return (
    <section className="socratic-chat-shell">
      {messages.map((message) => {
        const assistantTutorId = message.tutorId || tutorMode;
        return (
        <MessageBubble
          key={message.id}
          id={message.id}
          role={message.role}
          author={message.role === 'assistant' ? tutorMeta[assistantTutorId].author : 'You'}
          avatar={message.role === 'assistant' ? tutorMeta[assistantTutorId].avatar : undefined}
          text={message.text}
          time={message.time}
          images={message.images}
          isPlaying={message.role === 'assistant' && playingAssistantMessageId === message.id}
          onTogglePlay={onToggleAssistantMessageAudio}
        />
        );
      })}
    </section>
  );
}
