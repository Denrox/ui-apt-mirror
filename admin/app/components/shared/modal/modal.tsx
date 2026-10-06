import { useEffect, useId, useRef, type KeyboardEvent, type PropsWithChildren } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface ModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly title?: string;
  readonly maxWidth?:
    | 'sm'
    | 'md'
    | 'lg'
    | 'xl'
    | '2xl'
    | '4xl'
    | '6xl'
    | 'custom-1000';
}

export default function Modal({
  children,
  isOpen,
  onClose,
  title,
  maxWidth = 'md',
}: PropsWithChildren<ModalProps>) {
  const getMaxWidthClass = (width: string) => {
    switch (width) {
      case 'sm':
        return 'max-w-sm';
      case 'md':
        return 'max-w-md';
      case 'lg':
        return 'max-w-lg';
      case 'xl':
        return 'max-w-xl';
      case '2xl':
        return 'max-w-2xl';
      case '4xl':
        return 'max-w-4xl';
      case '6xl':
        return 'max-w-6xl';
      case 'custom-1000':
        return 'max-w-[1000px]';
      default:
        return 'max-w-md';
    }
  };

  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!isOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => previous?.focus?.();
  }, [isOpen]);

  // Esc closes only the innermost dialog; Tab stays inside it.
  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== 'Tab' || !dialogRef.current) return;
    const items = dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE);
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (!first) {
      e.preventDefault();
    } else if (e.shiftKey && (active === first || active === dialogRef.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />

      {/* Modal Content */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className={`relative focus:outline-none bg-surface-container border border-outline-variant rounded-xl shadow-2xl ${getMaxWidthClass(maxWidth)} w-full mx-4 max-h-[90vh] overflow-y-auto`}
      >
        {/* Header */}
        {title && (
          <div className="flex items-center justify-between p-4 border-b border-outline-variant">
            <h3 id={titleId} className="font-heading text-lg font-semibold text-on-surface">
              {title}
            </h3>
            <button
              onClick={onClose}
              className="text-on-surface-variant hover:text-on-surface focus:outline-none cursor-pointer"
            >
              <span className="sr-only">Close</span>
              <svg
                className="h-6 w-6"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        )}

        {/* Body */}
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}
