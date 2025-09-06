import type { PropsWithChildren } from 'react';

interface PageLayoutFullProps {
  readonly children: React.ReactNode;
  readonly title?: string;
  readonly subtitle?: string;
  readonly actions?: React.ReactNode;
}

export default function PageLayoutFull({ children }: PropsWithChildren<{}>) {
  return (
    <div className="flex flex-col justify-start h-full gap-[32px]">
      {children}
    </div>
  );
}
