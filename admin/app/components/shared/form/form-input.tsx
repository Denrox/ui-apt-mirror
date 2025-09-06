interface FormInputProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly placeholder?: string;
  readonly type?: string;
  readonly disabled?: boolean;
  readonly id?: string;
}

export default function FormInput({
  value,
  onChange,
  placeholder,
  type = 'text',
  disabled = false,
  id,
}: FormInputProps) {
  return (
    <input
      id={id}
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      className="w-full h-[40px] px-[12px] border border-gray-300 rounded-md text-[14px] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 disabled:text-gray-500"
    />
  );
}
