import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Side sheet for details. Enters from the right on the iOS drawer curve and
 * leaves faster than it came. Escape and the scrim close it; focus moves in
 * on open and returns to the opener on close.
 */
export function Drawer({ open, onClose, label, children }: { open: boolean; onClose: () => void; label: string; children: ReactNode }) {
  const reduce = useReducedMotion();
  const panelRef = useRef<HTMLDivElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    returnTo.current = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => panelRef.current?.focus(), 0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      // Keep Tab inside the sheet while it is open, as a modal dialog should.
      if (e.key !== 'Tab' || !panelRef.current) return;
      const items = [
        ...panelRef.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])'),
      ].filter((el) => el.offsetParent !== null);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === panelRef.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener('keydown', onKey);
      returnTo.current?.focus?.();
    };
  }, [open, onClose]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="drawer" role="presentation">
          <motion.div
            className="drawer__scrim"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.16 } }}
            transition={{ duration: 0.24 }}
          />
          <motion.div
            ref={panelRef}
            className="drawer__panel"
            role="dialog"
            aria-modal="true"
            aria-label={label}
            tabIndex={-1}
            initial={reduce ? { opacity: 0 } : { transform: 'translateX(100%)' }}
            animate={reduce ? { opacity: 1 } : { transform: 'translateX(0%)' }}
            exit={reduce ? { opacity: 0 } : { transform: 'translateX(100%)', transition: { duration: 0.2, ease: [0.23, 1, 0.32, 1] } }}
            transition={{ duration: 0.32, ease: [0.32, 0.72, 0, 1] }}
          >
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
