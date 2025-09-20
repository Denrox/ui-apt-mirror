interface FormCheckboxProps {
  readonly id: string;
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly disabled?: boolean;
  readonly description?: string;
}

export default function FormCheckbox({
  id,
  label,
  checked,
  onChange,
  disabled = false,
  description,
}: FormCheckboxProps) {
  return (
    <div className="flex items-start">
      <div className="flex items-center h-5">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          disabled={disabled}
          className="w-4 h-4 text-gray-600 bg-gray-100 border-gray-300 rounded focus:ring-gray-400 focus:ring-2"
        />
      </div>
      <div className="ml-3 text-sm">
        <label
          htmlFor={id}
          className={`font-medium ${disabled ? 'text-gray-400' : 'text-gray-700'}`}
        >
          {label}
        </label>
        {description && <p className="text-gray-500 mt-1">{description}</p>}
      </div>
    </div>
  );
}
