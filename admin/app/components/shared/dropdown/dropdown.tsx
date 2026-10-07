import {
  cloneElement,
  isValidElement,
  useState,
  useRef,
  useEffect,
  useCallback,
  useId,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';

interface DropdownProps {
  readonly trigger: ReactNode;
  readonly children: ReactNode;
  readonly disabled?: boolean;
  /** Shown on the trigger while it is disabled: why it can't be used now. */
  readonly disabledReason?: string;
}

const enabledItems = (menu: HTMLElement | null) =>
  Array.from(menu?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);

/**
 * A button that shows a list of actions below it (a disclosure: the trigger
 * says whether it is expanded). Esc, choosing an item, a click outside or
 * moving focus out of it closes the list; arrow keys move between items.
 * After Esc or an item, focus goes back to the trigger (and a dialog the item
 * opened returns it there). A disabled dropdown disables its trigger too.
 */
export default function Dropdown({
  trigger,
  children,
  disabled = false,
  disabledReason,
}: DropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [dropdownPosition, setDropdownPosition] = useState({
    top: 0,
    left: 0,
    alignRight: true,
  });
  const dropdownRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

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
      alignRight,
    });
  }, []);

  const close = useCallback((refocus: boolean) => {
    setIsOpen(false);
    if (refocus) triggerRef.current?.querySelector<HTMLElement>('button, [tabindex]')?.focus();
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close(dropdownRef.current?.contains(document.activeElement) ?? false);
      }
    };
    const handleResize = () => calculateDropdownPosition();

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', handleResize);
    window.addEventListener('scroll', handleResize);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('scroll', handleResize);
    };
  }, [isOpen, calculateDropdownPosition, close]);

  // A disabled dropdown (an action started) never stays open.
  useEffect(() => {
    if (disabled) setIsOpen(false);
  }, [disabled]);

  const handleTriggerClick = () => {
    if (!disabled) {
      if (!isOpen) {
        calculateDropdownPosition();
      }
      setIsOpen(!isOpen);
    }
  };

  // Tabbing (or clicking) out of the trigger and the list closes it.
  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget as Node | null;
    if (next && !dropdownRef.current?.contains(next)) setIsOpen(false);
  };

  // An item was chosen: it may open a dialog, which must not have the list under it.
  // The item goes away with the list, so focus on it moves to the trigger; a
  // dialog opened by the item renders after this and returns focus there.
  const handleMenuClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    const item = (event.target as Element).closest('button');
    if (item && !item.disabled) close(menuRef.current?.contains(document.activeElement) ?? false);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!isOpen || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const items = enabledItems(menuRef.current);
    if (!items.length) return;
    event.preventDefault();
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : event.key === 'ArrowDown'
            ? (at + 1) % items.length
            : at <= 0
              ? items.length - 1
              : at - 1;
    items[next].focus();
  };

  const state = { expanded: isOpen && !disabled, controls: isOpen ? menuId : undefined };
  const triggerElement = isValidElement<Record<string, unknown>>(trigger)
    ? typeof trigger.type === 'string'
      ? cloneElement(trigger, {
          'aria-expanded': state.expanded,
          'aria-controls': state.controls,
          disabled: disabled || trigger.props.disabled,
        })
      : cloneElement(trigger, {
          ariaExpanded: state.expanded,
          ariaControls: state.controls,
          disabled: disabled || trigger.props.disabled,
        })
    : trigger;

  return (
    <div className="relative" ref={dropdownRef} onBlur={handleBlur} onKeyDown={handleKeyDown}>
      <div
        ref={triggerRef}
        onClick={handleTriggerClick}
        title={disabled ? disabledReason : undefined}
        className={
          disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
        }
      >
        {triggerElement}
      </div>
      {isOpen && !disabled && (
        <div
          id={menuId}
          ref={menuRef}
          onClick={handleMenuClick}
          className="fixed w-48 bg-surface-container border border-outline-variant rounded-lg shadow-2xl z-50"
          style={{
            top: `${dropdownPosition.top}px`,
            left: `${dropdownPosition.left}px`,
          }}
        >
          <div className="py-1">{children}</div>
        </div>
      )}
    </div>
  );
}
