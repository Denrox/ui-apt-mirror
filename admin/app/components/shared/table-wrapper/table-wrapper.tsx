interface TableWrapperProps {
  readonly children: React.ReactNode;
}

export default function TableWrapper({ children }: TableWrapperProps) {
  return (
    <div className="divide-y divide-outline-variant/40 w-full overflow-x-auto">
      {children}
    </div>
  );
}
