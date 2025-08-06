import Title from "~/components/shared/title/title";
import classNames from "classnames";
import type { Route } from "./+types/home";
import appConfig from "~/config/config.json";
import PageLayoutFull from "~/components/shared/layout/page-layout-full";
import { useEffect, useMemo, useState } from "react";
import { getHostAddress } from "~/utils/url";
import ResourceMonitor from "~/components/shared/resource-monitor/resource-monitor";
import { useLoaderData } from "react-router";
import { loader, type RepositoryConfig } from "./loader";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Apt Mirror Main Page" },
    { name: "description", content: "Apt Mirror Main Page" },
  ];
}

export { loader };

export default function Home() {
  const [timer, setTimer] = useState<NodeJS.Timeout | null>(null);
  const [pagesAvalabilityState, setPagesAvalabilityState] = useState<{ [key: string]: boolean }>({});
  const { repositoryConfigs } = useLoaderData<typeof loader>();

  useEffect(() => {
    const checkPagesAvalability = async () => {
      const pages = appConfig.hosts;
      const pagesAvalabilityState = await Promise.all(pages.map(async (page) => {
        try {
          const response = await fetch(getHostAddress(page.address));
          return { [getHostAddress(page.address)]: response.ok };
        } catch (error) {
          return { [getHostAddress(page.address)]: false };
        }
      }));
      setPagesAvalabilityState(pagesAvalabilityState.reduce((acc, curr) => ({ ...acc, ...curr }), {}));
    };
    
    checkPagesAvalability();
    
    if (timer) {
      clearInterval(timer);
    }
    const interval = setInterval(checkPagesAvalability, 10000);
    setTimer(interval);

    return () => {
      if (timer) {
        clearInterval(timer);
      }
    };
  }, []);

  const mirrorAddress = getHostAddress(appConfig.hosts.find((host) => host.id === 'mirror')?.address || '');

  return (
    <PageLayoutFull>
      <Title title="Repository Configuration" />
      <div className="flex flex-row items-center md:gap-[32px] gap-[12px] flex-wrap px-[12px] md:px-0">
        {repositoryConfigs.map((config: RepositoryConfig, index: number) => (
          <div key={index} className="md:w-[calc(50%-18px)] w-full h-[148px] overflow-y-auto relative bg-gray-100 border border-gray-200 shadow-md rounded-md flex flex-col gap-[12px] p-[12px]">
            <div className="block text-[16px] flex-shrink-0 w-[calc(100%-48px)] whitespace-nowrap overflow-hidden text-ellipsis text-blue-500 font-semibold">
              {config.title}
            </div>
            {config.content.map((line: string, lineIndex: number) => (
              <div key={lineIndex} className="text-[12px] text-gray-500">
                {line}
              </div>
            ))}
          </div>
        ))}
      </div>

      <Title title="Services Status" />
      <div className="px-[12px] md:px-0">
        <ResourceMonitor />
      </div>
      <div className="flex flex-row items-center md:gap-[32px] gap-[12px] flex-wrap px-[12px] md:px-0">
        {appConfig.hosts.map((page) => (
          <div key={page.address} className={classNames("h-[120px] md:w-[calc(50%-18px)] w-full lg:w-[calc(33%-17px)] relative bg-gray-100 border border-gray-200 shadow-md rounded-md flex flex-col gap-[12px] p-[12px]", {
          })}>
            <a href={getHostAddress(page.address)} target="_blank" rel="noopener noreferrer" className={classNames("block text-[16px] w-[calc(100%-48px)] whitespace-nowrap overflow-hidden text-ellipsis text-blue-500 font-semibold", {
            })}>{`${page.name} (${getHostAddress(page.address)})`}</a>
            <div className="text-[12px] text-gray-500">
              {page.description}
            </div>
            <div className="absolute top-[12px] right-[12px] leading-none">
              {pagesAvalabilityState[getHostAddress(page.address)] ? <div className="font-semibold leading-[24px] text-[9px] text-green-500">Online</div> : <div className="font-semibold leading-[24px] text-[12px] text-red-500">Offline</div>}
            </div>
          </div>
        ))}
      </div>
    </PageLayoutFull>
  );
}
