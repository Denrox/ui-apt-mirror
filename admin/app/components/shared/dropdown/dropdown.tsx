import { useState, useRef, useEffect, type ReactNode } from 'react';

interface DropdownProps {
  readonly trigger: ReactNode;
  readonly children: ReactNode;
  readonly disabled?: boolean;
}

export default function Dropdown({
  trigger,
  children,
  disabled = false,
}: DropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const handleTriggerClick = () => {
    if (!disabled) {
      setIsOpen(!isOpen);
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <div
        onClick={handleTriggerClick}
        className={
          disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
        }
      >
        {trigger}
      </div>
      {isOpen && !disabled && (
        <div className="absolute right-0 mt-2 w-48 bg-white rounded-md shadow-lg border border-gray-200 z-50">
          <div className="py-1">{children}</div>
        </div>
      )}
    </div>
  );
}
