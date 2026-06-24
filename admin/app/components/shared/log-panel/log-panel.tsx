import { useMemo } from 'react';
import classNames from 'classnames';

export type LogLevel = 'ERROR' | 'WARN' | 'INFO' | 'DEBUG';
export type LogLevelFilter = 'ALL' | LogLevel;

interface LogPanelProps {
  readonly content: string;
  /** Shown in the terminal title bar (e.g. the file name). */
  readonly title?: string;
  /** Case-insensitive substring filter. */
  readonly search?: string;
  /** Only show lines of this level (ALL = no level filter). */
  readonly level?: LogLevelFilter;
  /** Height utility for the scroll body, e.g. "max-h-[60vh]". */
  readonly bodyClassName?: string;
  readonly className?: string;
}

const LEVEL_RE =
  /\b(ERROR|ERR|FATAL|CRIT(?:ICAL)?|WARN(?:ING)?|INFO|NOTICE|OK|DEBUG|TRACE)\b/i;

/** Classify a log line by the first level keyword it contains. */
function detectLevel(line: string): LogLevel | null {
  const match = LEVEL_RE.exec(line);
  if (!match) return null;
  const token = match[1].toUpperCase();
  if (token.startsWith('ERR') || token === 'FATAL' || token.startsWith('CRIT'))
    return 'ERROR';
  if (token.startsWith('WARN')) return 'WARN';
  if (token === 'DEBUG' || token === 'TRACE') return 'DEBUG';
  return 'INFO';
}

const LEVEL_TEXT: Record<LogLevel, string> = {
  ERROR: 'text-error',
  WARN: 'text-tertiary',
  INFO: 'text-on-surface',
  DEBUG: 'text-on-surface-variant/70',
};

/** Render at most this many (trailing) lines to keep the DOM light. */
const MAX_LINES = 1500;

/**
 * Terminal-style log viewer with per-line level coloring and client-side
 * search/level filtering. Reused by the Logs page and (later) the dashboard.
 */
export default function LogPanel({
  content,
  title,
  search = '',
  level = 'ALL',
  bodyClassName = 'max-h-[60vh]',
  className,
}: LogPanelProps) {
  const { lines, truncated, total } = useMemo(() => {
    const all = content.split('\n');
    const needle = search.trim().toLowerCase();
    const filtered = all
      .map((text, i) => ({ text, level: detectLevel(text), n: i + 1 }))
      .filter((l) => (level === 'ALL' ? true : l.level === level))
      .filter((l) => (needle ? l.text.toLowerCase().includes(needle) : true));
    const truncated = filtered.length > MAX_LINES;
    return {
      lines: truncated ? filtered.slice(-MAX_LINES) : filtered,
      truncated,
      total: filtered.length,
    };
  }, [content, search, level]);

  return (
    <div
      className={classNames(
        'overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest shadow-2xl',
        className,
      )}
    >
      {/* Terminal title bar */}
      <div className="flex items-center gap-3 border-b border-outline-variant bg-surface-container-high px-4 py-2">
        <div className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-error/50" />
          <span className="h-2.5 w-2.5 rounded-full bg-tertiary/50" />
          <span className="h-2.5 w-2.5 rounded-full bg-primary/50" />
        </div>
        {title && (
          <span className="truncate font-mono text-xs text-on-surface-variant">
            {title}
          </span>
        )}
        <span className="ml-auto font-mono text-[11px] text-on-surface-variant/60">
          {total} line{total === 1 ? '' : 's'}
        </span>
      </div>

      {/* Body */}
      <div className={classNames('overflow-auto p-3', bodyClassName)}>
        {lines.length === 0 ? (
          <div className="px-1 py-2 font-mono text-xs text-on-surface-variant">
            No matching log lines
          </div>
        ) : (
          <div className="font-mono text-[13px] leading-5">
            {truncated && (
              <div className="mb-1 text-[11px] italic text-on-surface-variant/60">
                Showing last {MAX_LINES} of {total} matching lines
              </div>
            )}
            {lines.map((line) => (
              <div
                key={line.n}
                className={classNames(
                  'flex gap-3 whitespace-pre-wrap break-all px-1',
                  line.level === 'ERROR' &&
                    'border-l-2 border-error bg-error/5',
                  LEVEL_TEXT[line.level ?? 'INFO'] ?? 'text-on-surface-variant',
                )}
              >
                <span className="select-none text-on-surface-variant/30">
                  {line.n}
                </span>
                <span className="flex-1">{line.text || ' '}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
