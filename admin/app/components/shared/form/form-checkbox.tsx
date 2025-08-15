interface FormCheckboxProps {
  id: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  description?: string;
}

export default function FormCheckbox({ 
  id, 
  label, 
  checked, 
  onChange, 
  disabled = false,
  description 
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
          className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 focus:ring-2"
        />
      </div>
      <div className="ml-3 text-sm">
        <label 
          htmlFor={id} 
          className={`font-medium ${disabled ? 'text-gray-400' : 'text-gray-700'}`}
        >
          {label}
        </label>
        {description && (
          <p className="text-gray-500 mt-1">{description}</p>
        )}
      </div>
    </div>
  );
} 