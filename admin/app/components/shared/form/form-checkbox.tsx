interface FormCheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
}

export default function FormCheckbox({ checked, onChange, label, disabled = false }: FormCheckboxProps) {
  return (
    <label className="flex items-center gap-[8px] cursor-pointer disabled:cursor-not-allowed">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        className="w-[16px] h-[16px] text-blue-600 border-gray-300 rounded focus:ring-blue-500 disabled:bg-gray-100"
      />
      {label && (
        <span className="text-[14px] text-gray-700 disabled:text-gray-500">{label}</span>
      )}
    </label>
  );
} 