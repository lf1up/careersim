import React, { useEffect } from 'react';
import clsx from 'clsx';

export interface RetroDialogProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}

export const RetroDialog: React.FC<RetroDialogProps> = ({ open, onClose, title, children, className, bodyClassName }) => {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  // Prevent background scrolling when dialog is open
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  if (!open) return null;

  const titleId = title ? 'retro-dialog-title' : undefined;
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} aria-hidden="true" />
      <div className="absolute inset-0 flex items-center justify-center p-4" onClick={onClose}>
        <div
          className={clsx('retro-card w-full max-w-lg max-h-[90vh] overflow-y-auto', className)}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          onClick={(e) => e.stopPropagation()}
        >
          {title && (
            <div className="px-6 py-4 border-b-2 border-black">
              <h3 id={titleId} className="text-xl font-semibold">{title}</h3>
            </div>
          )}
          <div className={clsx('p-6', bodyClassName)}>{children}</div>
        </div>
      </div>
    </div>
  );
};

export interface RetroTabsProps {
  tabs: { id: string; label: string; content: React.ReactNode }[];
  activeId: string;
  onChange: (id: string) => void;
  className?: string;
}

export const RetroTabs: React.FC<RetroTabsProps> = ({ tabs, activeId, onChange, className }) => {
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const idx = tabs.findIndex(t => t.id === activeId);
    if (e.key === 'ArrowRight') {
      const next = tabs[(idx + 1) % tabs.length];
      onChange(next.id);
    } else if (e.key === 'ArrowLeft') {
      const prev = tabs[(idx - 1 + tabs.length) % tabs.length];
      onChange(prev.id);
    }
  };
  return (
    <div className={clsx('retro-card', className)}>
      <div className="px-4 py-2 border-b-2 border-black flex gap-2 overflow-x-auto" role="tablist" onKeyDown={onKeyDown}>
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            className={clsx(
              'retro-btn-base text-sm px-3 py-1',
              activeId === t.id ? 'bg-yellow-300' : 'bg-white'
            )}
            aria-selected={activeId === t.id}
            role="tab"
            tabIndex={activeId === t.id ? 0 : -1}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="p-4" role="tabpanel">
        {tabs.find((t) => t.id === activeId)?.content}
      </div>
    </div>
  );
};
