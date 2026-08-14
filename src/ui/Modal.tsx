import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useLanguage } from '@/providers/LanguageProvider';

export type ModalProps = {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
};

const sizeClasses = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
};

// Animation duration for the exit transition, kept in sync with the CSS below.
const EXIT_MS = 160;

export function Modal({ open, onClose, title, description, children, footer, size = 'md' }: ModalProps) {
  const { t } = useLanguage();
  // Keep the modal mounted briefly after `open` flips to false so the
  // closing animation can play instead of the dialog vanishing instantly.
  const [rendered, setRendered] = useState(open);
  const [closing, setClosing] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setRendered(true);
      setClosing(false);
    } else if (rendered) {
      setClosing(true);
      const timer = setTimeout(() => {
        setRendered(false);
        setClosing(false);
      }, EXIT_MS);
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    // Focus the dialog panel for keyboard/screen-reader users on open.
    contentRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!rendered) return null;

  // Rendered through a Portal directly into document.body — NOT inline in
  // the calling page's tree. A Modal is opened from dozens of different
  // pages/cards across the app, and any one of those ancestors having
  // `overflow-hidden`, or an active `transform`/`filter`/`backdrop-filter`
  // (which creates a new containing block for `position: fixed`
  // descendants), would silently clip or mis-position this overlay instead
  // of it covering the full viewport. Portaling to body makes the Modal
  // immune to all of that, regardless of where `<Modal>` is written in JSX.
  //
  // App-wide overlay layering (highest wins): Dropdown/Popover/Notification
  // z-40 < Modal/Dialog z-50 (here) < Toast z-100 < Command bar z-200.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className={`absolute inset-0 bg-slate-900/50 backdrop-blur-sm ${closing ? 'animate-fade-out' : 'animate-fade-in'}`}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={contentRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        className={`relative w-full ${sizeClasses[size]} rounded-xl border border-slate-200 bg-white shadow-popover outline-none dark:border-slate-800 dark:bg-slate-900 ${
          closing ? 'animate-scale-out' : 'animate-scale-in'
        }`}
      >
        <div className="flex items-start justify-between border-b border-slate-100 px-5 py-4 dark:border-slate-800">
          <div>
            {title && <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">{title}</h2>}
            {description && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{description}</p>}
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
            aria-label={t('common.close')}
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4 dark:border-slate-800">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
