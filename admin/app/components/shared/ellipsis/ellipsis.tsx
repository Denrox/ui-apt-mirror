import React, { useState, useRef, useEffect } from 'react';

interface EllipsisProps {
  readonly children: React.ReactNode;
  readonly className?: string;
}

export default function Ellipsis({ children, className = '' }: EllipsisProps) {
  const [showTooltip, setShowTooltip] = useState(false);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const elementRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const checkOverflow = () => {
      if (elementRef.current) {
        const element = elementRef.current;
        setIsOverflowing(element.scrollWidth > element.clientWidth);
      }
    };

    checkOverflow();
    window.addEventListener('resize', checkOverflow);

    return () => {
      window.removeEventListener('resize', checkOverflow);
    };
  }, [children]);

  const handleMouseEnter = () => {
    if (isOverflowing) {
      setShowTooltip(true);
    }
  };

  const handleMouseLeave = () => {
    setShowTooltip(false);
  };

  return (
    <div className="relative inline-block w-full">
      <span
        ref={elementRef}
        className={`block w-full max-w-full overflow-hidden text-ellipsis whitespace-nowrap ${className}`}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {children}
      </span>
      {showTooltip && isOverflowing && (
        <div className="absolute z-50 px-2 py-1 text-sm text-white bg-gray-900 rounded shadow-lg whitespace-nowrap -top-8 left-0">
          {children}
          <div className="absolute w-2 h-2 bg-gray-900 transform rotate-45 -bottom-1 left-2"></div>
        </div>
      )}
    </div>
  );
}
