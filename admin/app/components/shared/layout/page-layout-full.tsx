import type { PropsWithChildren } from 'react';

export default function PageLayoutFull({ children }: PropsWithChildren<{}>) {
  return <div className="flex flex-col gap-stack-lg">{children}</div>;
}
