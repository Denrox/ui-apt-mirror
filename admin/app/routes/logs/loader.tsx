import fs from 'fs/promises';
import appConfig from '~/config/config.json';
import type { Route } from './+types/logs';
import { requireAuthMiddleware } from '~/utils/auth-middleware';

export async function loader({ params, request }: Route.LoaderArgs) {
  await requireAuthMiddleware(request);

  const log = (params as { log: string }).log;

  let logs: string[] = [];
  let logsDir: string = '';

  if (log === 'mirror') {
    logsDir = appConfig.mirrorLogsDir;
  } else if (log === 'nginx') {
    logsDir = appConfig.nginxLogsDir;
  }

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

  const recentLogs = logsWithMtime
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, 3)
    .map((l) => l.name);

  const logsContent = await Promise.all(
    recentLogs
      .map(async (log) => {
        try {
          const logContent = await fs.readFile(`${logsDir}/${log}`, 'utf-8');
          return {
            name: log,
            content: logContent,
          };
        } catch (error) {
          console.error(`Error reading log file ${log}:`, error);
          return {
            name: log,
            content: `Error reading log file ${log}: ${error}`,
          };
        }
      }),
  );

  return {
    logs: logsContent,
  };
}
