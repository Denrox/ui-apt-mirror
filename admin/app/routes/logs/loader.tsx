import fs from 'fs/promises';
import appConfig from '~/config/config.json';
import type { Route } from './+types/logs';
import { requireAuthMiddleware } from '~/utils/auth-middleware';
import { readTail } from '~/utils/read-tail';

// Logs grow with every sync; sending them whole made the page tens of MB.
const LOG_TAIL_BYTES = 512 * 1024;

export async function loader({ request }: Route.LoaderArgs) {
  await requireAuthMiddleware(request);

  const logsDir = appConfig.mirrorLogsDir;

  let logs: string[] = [];

  try {
    logs = await fs.readdir(logsDir);
  } catch (error) {
    console.error(`Error reading logs directory ${logsDir}:`, error);
    logs = [];
  }

  const filteredLogs = logs.filter(
    (log) => log.endsWith('.log') || /\.log.+$/.exec(log),
  );

  const logsWithMtime = await Promise.all(
    filteredLogs.map(async (log) => {
      try {
        const stat = await fs.stat(`${logsDir}/${log}`);
        return { name: log, mtimeMs: stat.mtimeMs };
      } catch {
        return { name: log, mtimeMs: 0 };
      }
    }),
  );

  const groups = new Map<string, typeof logsWithMtime>();
  for (const entry of logsWithMtime) {
    const key = entry.name.split('.log')[0];
    const bucket = groups.get(key) ?? [];
    bucket.push(entry);
    groups.set(key, bucket);
  }

  const recentLogs = Array.from(groups.values())
    .flatMap((bucket) =>
      bucket.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, 3),
    )
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .map((l) => l.name);

  const logsContent = await Promise.all(
    recentLogs.map(async (log) => {
      try {
        const { content, size, truncated } = await readTail(`${logsDir}/${log}`, LOG_TAIL_BYTES);
        return { name: log, content, size, truncated };
      } catch (error) {
        console.error(`Error reading log file ${log}:`, error);
        return {
          name: log,
          content: `Error reading log file ${log}: ${error}`,
          size: 0,
          truncated: false,
        };
      }
    }),
  );

  return {
    logs: logsContent,
    tailBytes: LOG_TAIL_BYTES,
  };
}
