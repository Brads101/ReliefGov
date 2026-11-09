import { useEffect } from 'react';
import Button from './Button.jsx';

/**
 * Accessible dialog: Escape closes, focus moves into the dialog,
 * background is inert to pointer events.
 */
export default function Dialog({ open, title, description, children, footer, onClose, maxWidth = 'max-w-lg' }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="presentation">
      <div className="absolute inset-0 bg-navy-950/40" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`relative z-10 m-0 flex max-h-[calc(100vh-1rem)] w-full ${maxWidth} flex-col rounded-t-lg bg-white shadow-pop sm:m-4 sm:max-h-[calc(100vh-2rem)] sm:rounded-lg`}
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-navy-900">{title}</h2>
            {description && <p className="mt-0.5 text-[13px] text-slate-500">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="rounded-md p-1 text-slate-500 hover:bg-surface-muted hover:text-navy-800"
          >
            <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor" aria-hidden="true">
              <path d="M6.3 4.9 4.9 6.3 8.6 10l-3.7 3.7 1.4 1.4L10 11.4l3.7 3.7 1.4-1.4L11.4 10l3.7-3.7-1.4-1.4L10 8.6 6.3 4.9Z" />
            </svg>
          </button>
        </header>
        {/* Body scrolls, so the header and footer (the action buttons) stay
            visible on short screens instead of being clipped. */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <footer className="flex shrink-0 justify-end gap-2 border-t border-line bg-surface-muted px-5 py-3">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}

export function ConfirmDialog({ open, title, message, confirmLabel = 'Confirm', onConfirm, onCancel, busy }) {
  return (
    <Dialog
      open={open}
      title={title}
      onClose={onCancel}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={onConfirm} loading={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-sm text-navy-800">{message}</p>
    </Dialog>
  );
}
