import { type JSX, type ReactElement } from 'react';

interface TitleProps {
  readonly title: string | JSX.Element;
  readonly action?: ReactElement;
  readonly noCenter?: boolean;
}

export default function Title({ title, action, noCenter }: TitleProps) {
  return (
    <div
      className={`flex items-center ${noCenter ? '' : 'justify-center'} gap-[16px]`}
    >
      <div className="text-[20px] font-semibold leading-[42px]">{title}</div>
      {action && <div className="flex items-center">{action}</div>}
    </div>
  );
}
