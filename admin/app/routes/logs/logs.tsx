import { useLoaderData, useParams } from "react-router";
import type { Route } from "./+types/logs";
import Title from "~/components/shared/title/title";
import { useEffect, useState, useMemo } from "react";
import classNames from "classnames";
import ContentBlock from "~/components/shared/content-block/content-block";
import PageLayoutNav from "~/components/shared/layout/page-layout-nav";
import NavLink from "~/components/shared/nav/nav-link";
import { loader } from "./loader";

export { loader };

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Apt Mirror Logs" },
    { name: "description", content: "Apt Mirror Logs" },
  ];
}

const sections = [
  { id: "mirror", linkName: "Mirror", title: "Mirror Logs" },
  { id: "nginx", linkName: "Nginx", title: "Nginx Logs" }
];

export default function Downloader() {
  const { logs } = useLoaderData<typeof loader>();
  const [selectedLog, setSelectedLog] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const { log } = useParams();

  useEffect(() => {
    if (log) {
      setActiveSection(log);
    }
  }, [log]);

  const sortedLogs = useMemo(() => {
    return logs.sort((a, b) => b.name > a.name ? 1 : -1);
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
    <PageLayoutNav
      nav={sections.map((section) => (
        <NavLink
          key={section.id}
          to={`/logs/${section.id}`}
          isActive={activeSection === section.id}
        >
          {section.linkName}
        </NavLink>
      ))}
    >
      <>
        <Title title={sections.find((section) => section.id === activeSection)?.title || ""} />
        {sortedLogs.length > 0 && (
          <div className="flex flex-row justify-around align-center flex-wrap gap-[12px]">
            {sortedLogs.map((log) => (
              <div className={classNames("text-[16px] h-[40px] flex items-center justify-center font-semibold px-[12px] rounded-md shadow-sm hover:bg-gray-200 cursor-pointer", {
                "bg-blue-200": selectedLog === log.name,
                "bg-gray-100": selectedLog !== log.name
              })} onClick={() => {
                setSelectedLog(log.name);
              }}>{log.name}</div>
            ))}
          </div>
        )}
        <ContentBlock className="flex-1">
          <pre className="whitespace-pre-wrap text-[14px]">{selectedLogContent || "No logs found"}</pre>
        </ContentBlock>
      </>
    </PageLayoutNav>
  );
}