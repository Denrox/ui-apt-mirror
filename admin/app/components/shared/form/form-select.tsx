interface FormSelectProps {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly options: readonly {
    readonly value: string;
    readonly label: string;
  }[];
  readonly disabled?: boolean;
  readonly placeholder?: string;
}

export default function FormSelect({
  id,
  label,
  value,
  onChange,
  options,
  disabled = false,
  placeholder,
}: FormSelectProps) {
  return (
    <div>
      <label
        htmlFor={id}
        className="block text-sm font-medium text-on-surface-variant mb-1"
      >
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w-full px-3 py-2 bg-surface-container-lowest border border-outline-variant text-on-surface rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {placeholder && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
