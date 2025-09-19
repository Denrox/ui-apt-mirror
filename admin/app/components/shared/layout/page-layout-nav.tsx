import { type PropsWithChildren, type ReactElement } from 'react';

interface PageLayoutNavProps {
  readonly nav: readonly ReactElement[];
}

export default function PageLayoutNav({
  children,
  nav,
}: PropsWithChildren<PageLayoutNavProps>) {
  return (
    <div className="flex flex-col lg:flex-row h-full gap-[32px]">
      <div className="lg:hidden flex flex-row w-full h-auto overflow-x-auto border-b border-b-2 border-gray-200">
        <div className="flex flex-row w-max px-[12px] whitespace-nowrap overflow-hidden gap-[2px]">
          {nav}
        </div>
      </div>
      <div className="hidden lg:flex flex-col w-[200px] gap-[2px] max-h-[calc(100%-64px)] mt-[64px] rounded border border-gray-300 overflow-hidden h-fit">
        {nav}
      </div>
      <div className="flex flex-col gap-[32px] flex-1 h-full overflow-y-auto md:px-[0px] px-[12px]">
        {children}
      </div>
    </div>
  );
}
