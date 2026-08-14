import type { ReactNode } from 'react';

export type DialogProps = {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
  variant?: 'default' | 'danger';
  loading?: boolean;
};

import { Modal } from './Modal';
import { Button } from './Button';

export function Dialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
  children,
  variant = 'default',
  loading,
}: DialogProps) {
  return (
    <Modal open={open} onClose={onCancel} title={title} description={description} size="sm">
      {children}
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel} disabled={loading}>
          {cancelLabel}
        </Button>
        <Button variant={variant === 'danger' ? 'danger' : 'primary'} onClick={onConfirm} loading={loading}>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
