import classNames from 'classnames';

interface ContentBlockProps {
  readonly children: React.ReactNode;
  readonly className?: string;
}

export default function ContentBlock({
  children,
  className,
}: ContentBlockProps) {
  return (
    <div
      className={classNames(
        'w-full overflow-y-auto md:p-[24px] p-[12px] border-[1px] border-gray-200 shadow-md rounded-md flex-1 flex flex-col',
        className,
      )}
    >
      {children}
    </div>
  );
}
