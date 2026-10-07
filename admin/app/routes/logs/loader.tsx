import appConfig from '~/config/config.json';
import type { Route } from './+types/logs';
import { requireAuthMiddleware } from '~/utils/auth-middleware';
import { readTail } from '~/utils/read-tail';
import { listLogs, pickLog } from '~/utils/log-files';

// Logs grow with every sync; sending them whole made the page tens of MB.
const LOG_TAIL_BYTES = 512 * 1024;

export async function loader({ request }: Route.LoaderArgs) {
  await requireAuthMiddleware(request);

  const logs = await listLogs([
    { dir: appConfig.mirrorLogsDir, prefix: '' },
    { dir: appConfig.nginxLogsDir, prefix: 'nginx/' },
  ]);
  const selected = pickLog(logs, new URL(request.url).searchParams.get('log'));

  let content = '';
  let size = 0;
  let truncated = false;
  let firstLine = 1;
  if (selected) {
    try {
      ({ content, size, truncated, firstLine } = await readTail(selected.path, LOG_TAIL_BYTES));
    } catch (error) {
      console.error(`Error reading log file ${selected.name}:`, error);
      content = `Error reading log file ${selected.name}: ${error}`;
    }
  }

  return {
    logs: logs.map((log) => log.name),
    selected: selected ? { name: selected.name, content, size, truncated, firstLine } : null,
    tailBytes: LOG_TAIL_BYTES,
  };
}
