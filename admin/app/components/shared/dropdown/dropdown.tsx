import { useState, useRef, useEffect, useCallback, type ReactNode } from 'react';

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
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0, alignRight: true });
  const dropdownRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);

  const calculateDropdownPosition = useCallback(() => {
    if (!triggerRef.current) return;
    
    const triggerRect = triggerRef.current.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const dropdownWidth = 192;
    
    const distanceFromLeft = triggerRect.left;
    const distanceFromRight = viewportWidth - triggerRect.right;
    
    const alignRight = distanceFromLeft >= distanceFromRight;
    let left: number;
    if (alignRight) {
      // Align dropdown's right edge to trigger's right edge
      left = triggerRect.right - dropdownWidth;
    } else {
      // Align dropdown's left edge to trigger's left edge
      left = triggerRect.left;
    }
    
    // Ensure dropdown doesn't go off-screen
    if (left < 0) left = 0;
    if (left + dropdownWidth > viewportWidth) {
      left = viewportWidth - dropdownWidth;
    }
    
    setDropdownPosition({
      top: triggerRect.bottom + 8,
      left,
      alignRight
    });
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    const handleResize = () => {
      if (isOpen) {
        calculateDropdownPosition();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('resize', handleResize);
    window.addEventListener('scroll', handleResize);
    
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('scroll', handleResize);
    };
  }, [isOpen, calculateDropdownPosition]);

  const handleTriggerClick = () => {
    if (!disabled) {
      if (!isOpen) {
        calculateDropdownPosition();
      }
      setIsOpen(!isOpen);
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <div
        ref={triggerRef}
        onClick={handleTriggerClick}
        className={
          disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
        }
      >
        {trigger}
      </div>
      {isOpen && !disabled && (
        <div 
          className="fixed w-48 bg-white rounded-md shadow-lg border border-gray-200 z-50"
          style={{
            top: `${dropdownPosition.top}px`,
            left: `${dropdownPosition.left}px`
          }}
        >
          <div className="py-1">{children}</div>
        </div>
      )}
    </div>
  );
}
