import { useLoaderData, useRevalidator, useSearchParams } from 'react-router';
import type { Route } from './+types/logs';
import { useEffect, useState } from 'react';
import classNames from 'classnames';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faMagnifyingGlass } from '@fortawesome/free-solid-svg-icons';
import PageLayoutFull from '~/components/shared/layout/page-layout-full';
import LogPanel, {
  type LogLevelFilter,
} from '~/components/shared/log-panel/log-panel';
import { loader } from './loader';

export { loader };

export function meta({}: Route.MetaArgs) {
  return [
    { title: 'Apt Mirror Logs' },
    { name: 'description', content: 'Apt Mirror Logs' },
  ];
}

export default function LogsPage() {
  const { logs, selected, tailBytes } = useLoaderData<typeof loader>();
  const [, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [level, setLevel] = useState<LogLevelFilter>('ALL');
  const revalidator = useRevalidator();

  // Reload the selected log while the page is visible.
  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible' && revalidator.state === 'idle') {
        revalidator.revalidate();
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [revalidator]);

  const selectedLog = selected?.name ?? null;

  return (
    <PageLayoutFull>
      <div className="flex flex-col gap-1">
        <h1 className="font-heading text-2xl font-bold text-on-surface md:text-[30px]">
          System Logs
        </h1>
        <p className="text-sm text-on-surface-variant">
          Mirror sync, signing and nginx logs
        </p>
      </div>

      {logs.length > 0 ? (
        <>
          {/* Log sources */}
          <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
            {logs.map((name) => (
              <button
                key={name}
                onClick={() =>
                  setSearchParams({ log: name }, { replace: true, preventScrollReset: true })
                }
                className={classNames(
                  'whitespace-nowrap rounded-full border px-3 py-1.5 text-sm transition-colors',
                  selectedLog === name
                    ? 'border-primary/30 bg-primary/10 font-semibold text-primary'
                    : 'border-outline-variant bg-surface-container text-on-surface-variant hover:text-on-surface',
                )}
              >
                {name}
              </button>
            ))}
          </div>

          {/* Filters */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <FontAwesomeIcon
                icon={faMagnifyingGlass}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[14px] text-on-surface-variant/60"
              />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter log lines…"
                className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest py-2 pl-10 pr-4 text-sm text-on-surface placeholder:text-on-surface-variant/40 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <select
              value={level}
              onChange={(e) => setLevel(e.target.value as LogLevelFilter)}
              className="rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm text-on-surface focus:border-transparent focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="ALL">All levels</option>
              <option value="INFO">Info</option>
              <option value="WARN">Warning</option>
              <option value="ERROR">Error</option>
              <option value="DEBUG">Debug</option>
            </select>
          </div>

          {selected?.truncated && (
            <p className="text-xs text-on-surface-variant">
              Showing the last {tailBytes / 1024} KB of this{' '}
              {(selected.size / 1024 / 1024).toFixed(1)} MB log; filters apply to
              this part only.
            </p>
          )}

          <LogPanel
            content={selected?.content ?? ''}
            title={selectedLog ?? undefined}
            search={search}
            level={level}
            bodyClassName="max-h-[calc(100vh-340px)] min-h-[300px]"
          />
        </>
      ) : (
        <div className="rounded-xl border border-dashed border-outline-variant p-8 text-center text-on-surface-variant">
          No logs found
        </div>
      )}
    </PageLayoutFull>
  );
}
