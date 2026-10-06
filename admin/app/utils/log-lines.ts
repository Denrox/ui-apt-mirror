export type LogLevel = 'ERROR' | 'WARN' | 'INFO' | 'DEBUG';
export type LogLevelFilter = 'ALL' | LogLevel;

export interface LogLine {
  text: string;
  level: LogLevel | null;
  n: number;
}

const LEVEL_RE =
  /\b(ERROR|ERR|FATAL|CRIT(?:ICAL)?|WARN(?:ING)?|INFO|NOTICE|OK|DEBUG|TRACE)\b/i;

/** Classify a log line by the first level keyword it contains. */
export function detectLevel(line: string): LogLevel | null {
  const match = LEVEL_RE.exec(line);
  if (!match) return null;
  const token = match[1].toUpperCase();
  if (token.startsWith('ERR') || token === 'FATAL' || token.startsWith('CRIT'))
    return 'ERROR';
  if (token.startsWith('WARN')) return 'WARN';
  if (token === 'DEBUG' || token === 'TRACE') return 'DEBUG';
  return 'INFO';
}

/** Lines of a log; the final newline does not start another line. */
export function splitLogLines(content: string): string[] {
  if (content === '') return [];
  return content.replace(/\r?\n$/, '').split(/\r?\n/);
}

/** Lines matching the level (unlabelled lines count as INFO) and the case-insensitive search. */
export function filterLogLines(
  content: string,
  search: string,
  level: LogLevelFilter,
): LogLine[] {
  const needle = search.trim().toLowerCase();
  return splitLogLines(content)
    .map((text, i) => ({ text, level: detectLevel(text), n: i + 1 }))
    .filter((l) => level === 'ALL' || (l.level ?? 'INFO') === level)
    .filter((l) => !needle || l.text.toLowerCase().includes(needle));
}
