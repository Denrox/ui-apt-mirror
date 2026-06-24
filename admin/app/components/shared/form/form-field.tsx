import type { PropsWithChildren } from 'react';

interface FormFieldProps {
  readonly label: string;
  readonly required?: boolean;
  readonly error?: string;
}

export default function FormField({
  children,
  label,
  required = false,
  error,
}: PropsWithChildren<FormFieldProps>) {
  return (
    <div className="flex flex-col gap-[8px]">
      <label className="text-[14px] font-semibold text-on-surface-variant">
        {label}
        {required && <span className="text-error ml-[4px]">*</span>}
      </label>
      {children}
      {error && <div className="text-[12px] text-error">{error}</div>}
    </div>
  );
}
