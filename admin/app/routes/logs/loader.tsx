import fs from 'fs/promises';
import appConfig from '~/config/config.json';
import type { Route } from './+types/logs';

export async function loader({ params }: Route.LoaderArgs) {
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

  const logsContent = await Promise.all(
    logs
      .filter((log) => log.endsWith('.log') || /\.log.+$/.exec(log))
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
