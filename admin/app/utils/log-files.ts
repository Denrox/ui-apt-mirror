import fs from 'fs/promises';
import path from 'path';

export interface LogSource {
  dir: string;
  /** Prepended to file names, e.g. "nginx/". */
  prefix: string;
}

export interface LogFile {
  name: string;
  path: string;
  mtimeMs: number;
  size: number;
}

/** The sync log, which the dashboard follows and the Logs page opens first. */
export const SYNC_LOG = 'apt-mirror.log';

const LOG_FILE_RE = /\.log(\.\d+)?$/;

/** Rotations (".log.1") and daily files ("-2026-10-06.log") of one log share a group. */
export function logGroup(name: string): string {
  return name.replace(/(-\d{4}-\d{2}-\d{2})?\.log(\.\d+)?$/, '');
}

/** Log files of each source, grouped by log, keeping the newest `perGroup` of a group. */
export async function listLogs(
  sources: LogSource[],
  perGroup = 3,
): Promise<LogFile[]> {
  const result: LogFile[] = [];
  for (const { dir, prefix } of sources) {
    let names: string[];
    try {
      names = await fs.readdir(dir);
    } catch (error) {
      console.error(`Error reading logs directory ${dir}:`, error);
      continue;
    }
    const files = await Promise.all(
      names
        .filter((name) => LOG_FILE_RE.test(name))
        .map(async (name): Promise<LogFile | null> => {
          const file = path.join(dir, name);
          try {
            const stat = await fs.stat(file);
            return stat.isFile()
              ? {
                  name: prefix + name,
                  path: file,
                  mtimeMs: stat.mtimeMs,
                  size: stat.size,
                }
              : null;
          } catch {
            return null;
          }
        }),
    );
    const groups = new Map<string, LogFile[]>();
    for (const file of files) {
      if (!file) continue;
      const key = logGroup(file.name);
      groups.set(key, [...(groups.get(key) ?? []), file]);
    }
    for (const key of [...groups.keys()].sort()) {
      result.push(
        ...groups
          .get(key)!
          .sort((a, b) => b.mtimeMs - a.mtimeMs)
          .slice(0, perGroup),
      );
    }
  }
  return result;
}

/** The requested log if listed, else the sync log, else the newest one. */
export function pickLog(
  logs: LogFile[],
  requested: string | null,
): LogFile | undefined {
  return (
    logs.find((log) => log.name === requested) ??
    logs.find((log) => log.name === SYNC_LOG) ??
    [...logs].sort((a, b) => b.mtimeMs - a.mtimeMs)[0]
  );
}
