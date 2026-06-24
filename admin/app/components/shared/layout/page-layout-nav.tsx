import { type PropsWithChildren, type ReactElement } from 'react';

interface PageLayoutNavProps {
  readonly nav: readonly ReactElement[];
}

export default function PageLayoutNav({
  children,
  nav,
}: PropsWithChildren<PageLayoutNavProps>) {
  return (
    <div className="flex flex-col lg:flex-row gap-stack-lg">
      <div className="no-scrollbar lg:hidden flex flex-row w-full h-auto overflow-x-auto border-b-2 border-outline-variant">
        <div className="flex flex-row w-max whitespace-nowrap overflow-hidden gap-[2px]">
          {nav}
        </div>
      </div>
      <div className="hidden lg:flex flex-col w-[200px] gap-[2px] rounded-xl border border-outline-variant overflow-hidden h-fit">
        {nav}
      </div>
      <div className="flex flex-col gap-stack-lg flex-1">{children}</div>
    </div>
  );
}
