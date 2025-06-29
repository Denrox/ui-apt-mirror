import React, { type JSX } from "react";

interface TitleProps {
  title: string | JSX.Element;
  description?: string | JSX.Element;
  action?: React.ReactElement;
}

export default function Title({ title, action }: TitleProps) {
  return (
    <div className="flex items-center justify-center gap-[16px]">
      <div className="text-[20px] font-semibold">
        {title}
      </div>
      {action && (
        <div className="flex items-center">
          {action}
        </div>
      )}
    </div>
  );
}