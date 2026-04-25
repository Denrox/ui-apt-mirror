import { useLoaderData } from 'react-router';
import type { Route } from './+types/logs';
import Title from '~/components/shared/title/title';
import { useEffect, useState, useMemo } from 'react';
import classNames from 'classnames';
import ContentBlock from '~/components/shared/content-block/content-block';
import PageLayoutFull from '~/components/shared/layout/page-layout-full';
import { loader } from './loader';

export { loader };

export function meta({}: Route.MetaArgs) {
  return [
    { title: 'Apt Mirror Logs' },
    { name: 'description', content: 'Apt Mirror Logs' },
  ];
}

export default function Downloader() {
  const { logs } = useLoaderData<typeof loader>();
  const [selectedLog, setSelectedLog] = useState<string | null>(null);

  const sortedLogs = useMemo(() => {
    return logs.sort((a, b) => (b.name > a.name ? 1 : -1));
  }, [logs]);

  useEffect(() => {
    if (sortedLogs.length > 0) {
      setSelectedLog(sortedLogs[0].name);
    }
  }, [sortedLogs]);

  const selectedLogContent = useMemo(() => {
    return sortedLogs.find((log) => log.name === selectedLog)?.content || '';
  }, [selectedLog, sortedLogs]);

  return (
    <PageLayoutFull>
      <Title title="Mirror Logs" />
      {sortedLogs.length > 0 && (
        <div className="flex flex-row justify-around align-center flex-wrap gap-[12px]">
          {sortedLogs.map((log) => (
            <div
              key={log.name}
              className={classNames(
                'text-[16px] h-[40px] flex items-center justify-center font-semibold px-[12px] rounded-md shadow-sm hover:bg-gray-200 cursor-pointer',
                {
                  'bg-blue-200': selectedLog === log.name,
                  'bg-gray-100': selectedLog !== log.name,
                },
              )}
              onClick={() => {
                setSelectedLog(log.name);
              }}
            >
              {log.name}
            </div>
          ))}
        </div>
      )}
      <ContentBlock className="flex-1">
        <pre className="whitespace-pre-wrap text-[14px]">
          {selectedLogContent || 'No logs found'}
        </pre>
      </ContentBlock>
    </PageLayoutFull>
  );
}
