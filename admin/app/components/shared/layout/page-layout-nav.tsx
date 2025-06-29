import React, { type PropsWithChildren } from "react"

interface PageLayoutNavProps {
  nav: React.ReactElement;
}

export default function PageLayoutNav({ children, nav }: PropsWithChildren<PageLayoutNavProps>) {
  return (
    <div className="flex flex-col lg:flex-row h-full gap-[32px]">
      <div className="lg:hidden flex flex-row w-full h-auto overflow-x-auto border-b border-b-2 border-gray-200">
        <div className="flex flex-row w-max whitespace-nowrap overflow-hidden gap-[2px]">
          {nav}
        </div>
      </div>      
      <div className="hidden lg:flex flex-col w-[200px] gap-[2px] h-full">
        {nav}
      </div>
      <div className="flex flex-col gap-[32px] flex-1 h-full overflow-y-auto px-4 lg:px-0">
        {children}
      </div>
    </div>
  );
}