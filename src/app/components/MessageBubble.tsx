import React from 'react';
import { Play, Square } from 'lucide-react';
import katex from 'katex';
import 'katex/dist/katex.min.css';

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

const LATEX_SEGMENT_PATTERN =
  /(\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\$[^$\n]+?\$)/g;
const INLINE_MARKDOWN_PATTERN = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g;
const MULTILINE_MATH_BLOCK_PATTERN =
  /(\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\))/g;

const normalizeMathBlocks = (value: string) =>
  String(value || '').replace(MULTILINE_MATH_BLOCK_PATTERN, (segment) => {
    if (!segment.includes('\n') && !segment.includes('\r')) return segment;

    let open = '';
    let close = '';
    let body = segment;

    if (segment.startsWith('$$') && segment.endsWith('$$')) {
      open = '$$';
      close = '$$';
      body = segment.slice(2, -2);
    } else if (segment.startsWith('\\[') && segment.endsWith('\\]')) {
      open = '\\[';
      close = '\\]';
      body = segment.slice(2, -2);
    } else if (segment.startsWith('\\(') && segment.endsWith('\\)')) {
      open = '\\(';
      close = '\\)';
      body = segment.slice(2, -2);
    }

    const compactBody = body
      .replace(/\r\n/g, '\n')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .join(' ');

    return `${open}${compactBody}${close}`;
  });

const renderMathSegment = (segment: string) => {
  let expression = segment;
  let displayMode = false;

  if (segment.startsWith('$$') && segment.endsWith('$$')) {
    expression = segment.slice(2, -2);
    displayMode = true;
  } else if (segment.startsWith('\\[') && segment.endsWith('\\]')) {
    expression = segment.slice(2, -2);
    displayMode = true;
  } else if (segment.startsWith('\\(') && segment.endsWith('\\)')) {
    expression = segment.slice(2, -2);
  } else if (segment.startsWith('$') && segment.endsWith('$')) {
    expression = segment.slice(1, -1);
  }

  try {
    return katex.renderToString(expression.trim(), {
      displayMode,
      throwOnError: false,
      strict: 'ignore',
    });
  } catch {
    return segment;
  }
};

const renderInlineMarkdown = (value: string, keyPrefix: string) => {
  const source = String(value || '');
  const nodes: React.ReactNode[] = [];
  let cursor = 0;

  for (const match of source.matchAll(INLINE_MARKDOWN_PATTERN)) {
    const segment = match[0];
    const index = match.index ?? 0;

    if (index > cursor) {
      nodes.push(<React.Fragment key={`${keyPrefix}-txt-${cursor}`}>{source.slice(cursor, index)}</React.Fragment>);
    }

    if (segment.startsWith('**') && segment.endsWith('**')) {
      nodes.push(<strong key={`${keyPrefix}-b-${index}`}>{segment.slice(2, -2)}</strong>);
    } else if (segment.startsWith('`') && segment.endsWith('`')) {
      nodes.push(<code key={`${keyPrefix}-c-${index}`}>{segment.slice(1, -1)}</code>);
    } else if (segment.startsWith('*') && segment.endsWith('*')) {
      nodes.push(<em key={`${keyPrefix}-i-${index}`}>{segment.slice(1, -1)}</em>);
    } else {
      nodes.push(<React.Fragment key={`${keyPrefix}-raw-${index}`}>{segment}</React.Fragment>);
    }
    cursor = index + segment.length;
  }

  if (cursor < source.length) {
    nodes.push(<React.Fragment key={`${keyPrefix}-tail-${cursor}`}>{source.slice(cursor)}</React.Fragment>);
  }

  return nodes.length > 0 ? nodes : [source];
};

const renderInlineContent = (value: string, keyPrefix: string) => {
  const source = String(value || '');
  const nodes: React.ReactNode[] = [];
  let cursor = 0;

  for (const match of source.matchAll(LATEX_SEGMENT_PATTERN)) {
    const segment = match[0];
    const index = match.index ?? 0;

    if (index > cursor) {
      nodes.push(...renderInlineMarkdown(source.slice(cursor, index), `${keyPrefix}-md-${index}`));
    }

    nodes.push(
      <span key={`${keyPrefix}-math-${index}`} dangerouslySetInnerHTML={{ __html: renderMathSegment(segment) }} />,
    );
    cursor = index + segment.length;
  }

  if (cursor < source.length) {
    nodes.push(...renderInlineMarkdown(source.slice(cursor), `${keyPrefix}-md-tail-${cursor}`));
  }

  return nodes.length > 0 ? nodes : [source];
};

const renderMultilineInline = (value: string, keyPrefix: string) => {
  const lines = String(value || '').split('\n');
  return lines.flatMap((line, index) => {
    const row = renderInlineContent(line, `${keyPrefix}-line-${index}`);
    if (index === lines.length - 1) return row;
    return [...row, <br key={`${keyPrefix}-br-${index}`} />];
  });
};

const renderMessageMarkdown = (value: string) => {
  const lines = normalizeMathBlocks(value).replace(/\r\n/g, '\n').split('\n');
  const blocks: React.ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const current = lines[index];
    if (!current.trim()) {
      index += 1;
      continue;
    }

    if (/^\d+\.\s+/.test(current)) {
      const items: string[] = [];
      while (index < lines.length && /^\d+\.\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\d+\.\s+/, '').trim());
        index += 1;
      }
      blocks.push(
        <ol key={`ol-${index}`}>
          {items.map((item, itemIndex) => (
            <li key={`ol-${index}-${itemIndex}`}>{renderMultilineInline(item, `ol-${index}-${itemIndex}`)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    if (/^[-*]\s+/.test(current)) {
      const items: string[] = [];
      while (index < lines.length && /^[-*]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^[-*]\s+/, '').trim());
        index += 1;
      }
      blocks.push(
        <ul key={`ul-${index}`}>
          {items.map((item, itemIndex) => (
            <li key={`ul-${index}-${itemIndex}`}>{renderMultilineInline(item, `ul-${index}-${itemIndex}`)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    const paragraphLines: string[] = [];
    while (index < lines.length && lines[index].trim() && !/^\d+\.\s+/.test(lines[index]) && !/^[-*]\s+/.test(lines[index])) {
      paragraphLines.push(lines[index]);
      index += 1;
    }
    blocks.push(
      <p key={`p-${index}`}>
        {renderMultilineInline(paragraphLines.join('\n'), `p-${index}`)}
      </p>,
    );
  }

  return blocks;
};

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
      {text && <div className="socratic-bubble-markdown">{renderMessageMarkdown(text)}</div>}
    </article>
  );
}
