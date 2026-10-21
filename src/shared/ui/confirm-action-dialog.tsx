"use client";

import { useState, type MouseEvent, type ReactElement } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/src/shared/ui/primitives";

type ConfirmActionDialogProps = Readonly<{
  trigger: ReactElement;
  title: string;
  description: string;
  confirmLabel: string;
  pendingLabel?: string;
  failureMessage?: string;
  onConfirm: () => boolean | Promise<boolean>;
}>;

/**
 * Destructive actions stay pending until the server-backed handler reports success.
 * A false result keeps the dialog open and never presents a local success state.
 */
export function ConfirmActionDialog({
  trigger,
  title,
  description,
  confirmLabel,
  pendingLabel = "处理中…",
  failureMessage = "操作未完成，资料没有改变。",
  onConfirm,
}: ConfirmActionDialogProps) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function confirm(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    setPending(true);
    setFailure(null);
    try {
      const succeeded = await onConfirm();
      if (succeeded) {
        setOpen(false);
      } else {
        setFailure(failureMessage);
      }
    } catch {
      setFailure(failureMessage);
    } finally {
      setPending(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={(nextOpen) => {
      if (!pending) {
        setOpen(nextOpen);
        if (!nextOpen) setFailure(null);
      }
    }}>
      <AlertDialogTrigger>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogTitle>{title}</AlertDialogTitle>
        <AlertDialogDescription>{description}</AlertDialogDescription>
        {failure ? <p className="sueno-alert-dialog-error" role="alert">{failure}</p> : null}
        <div className="sueno-alert-dialog-actions">
          <AlertDialogCancel disabled={pending}>取消</AlertDialogCancel>
          <AlertDialogAction disabled={pending} onClick={(event) => void confirm(event)}>
            {pending ? pendingLabel : confirmLabel}
          </AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
