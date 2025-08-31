import classNames from 'classnames';

export default function ContentBlock({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
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
