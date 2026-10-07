import { useEffect, useId, useRef, type PropsWithChildren } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Open dialogs, innermost last: only that one answers Esc and Tab.
const openDialogs: HTMLElement[] = [];

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

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => previous?.focus?.();
  }, [isOpen]);

  // Content swapped under the focused element (a followed link, Back) drops
  // focus to <body>; bring it back into the dialog after every render.
  useEffect(() => {
    const dialog = dialogRef.current;
    const active = document.activeElement;
    if (!isOpen || !dialog || openDialogs[openDialogs.length - 1] !== dialog) return;
    // Browsers move focus off a removed element lazily, so check isConnected too.
    if (!active || active === document.body || !active.isConnected) dialog.focus();
  });

  // Esc closes only the innermost dialog; Tab stays inside it. Listened for on
  // the document, so they still work when focus has fallen out of the dialog.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!isOpen || !dialog) return;
    openDialogs.push(dialog);
    const handleKeyDown = (e: KeyboardEvent) => {
      if (openDialogs[openDialogs.length - 1] !== dialog || e.defaultPrevented) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = dialog.querySelectorAll<HTMLElement>(FOCUSABLE);
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (!first) {
        e.preventDefault();
        dialog.focus();
      } else if (!dialog.contains(active)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && (active === first || active === dialog)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      const i = openDialogs.indexOf(dialog);
      if (i !== -1) openDialogs.splice(i, 1);
    };
  }, [isOpen]);

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
