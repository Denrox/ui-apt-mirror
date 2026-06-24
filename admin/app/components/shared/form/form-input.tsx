interface FormInputProps {
  readonly value?: string;
  readonly onChange?: (value: string) => void;
  readonly placeholder?: string;
  readonly type?: string;
  readonly disabled?: boolean;
  readonly id?: string;
  readonly name?: string;
  readonly onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  readonly width?: string;
}

export default function FormInput({
  value,
  onChange,
  placeholder,
  type = 'text',
  disabled = false,
  id,
  name,
  onKeyDown,
  width,
}: FormInputProps) {
  return (
    <input
      id={id}
      type={type}
      name={name}
      value={value}
      onChange={onChange ? (e) => onChange(e.target.value) : undefined}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      disabled={disabled}
      style={width ? { width } : undefined}
      className="w-full h-[40px] px-[12px] bg-surface-container-lowest border border-outline-variant rounded-lg text-[14px] text-on-surface placeholder:text-on-surface-variant/50 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent disabled:opacity-50"
    />
  );
}
