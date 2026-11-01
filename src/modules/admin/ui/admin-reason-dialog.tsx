"use client";

import { useId, useState, type MouseEvent, type ReactElement } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/src/shared/ui/primitives";

export type AdminReasonDialogResult = Readonly<{ ok: boolean; message: string }>;

type AdminReasonDialogProps = Readonly<{
  trigger: ReactElement;
  title: string;
  description: string;
  confirmLabel: string;
  pendingLabel?: string;
  reasonLabel?: string;
  reasonPlaceholder?: string;
  /** Server account actions require a reason between 4 and 500 characters. */
  minReasonLength?: number;
  maxReasonLength?: number;
  /**
   * Optional "type this phrase to confirm" field for the most destructive
   * actions (account deletion). The confirm button stays disabled until the
   * typed phrase matches exactly; the audit reason is still required separately.
   */
  confirmationPhrase?: string;
  confirmationLabel?: string;
  danger?: boolean;
  /** Safe success sentence rendered on the page after the dialog closes. */
  onSuccess: (message: string) => void;
  /**
   * Run the server-backed write. A `{ ok: false }` result stays inside the
   * dialog with its safe message; the page only reports success on `ok: true`.
   */
  onConfirm: (reason: string) => Promise<AdminReasonDialogResult>;
}>;

/**
 * Reason-capturing confirmation dialog for owner-console management actions.
 *
 * It follows the shared `ConfirmActionDialog` contract (alert dialog, pending
 * label, error stays in the dialog, closing only on a confirmed server result)
 * and adds the mandatory `reason` field every audited admin action requires.
 * `ConfirmActionDialog` itself only accepts a static failure message and has no
 * field, which is why this scoped variant exists instead of duplicating the
 * destructive actions with un-auditable no-reason buttons.
 */
export function AdminReasonDialog({
  trigger,
  title,
  description,
  confirmLabel,
  pendingLabel = "正在提交…",
  reasonLabel = "操作原因（写入审计日志）",
  reasonPlaceholder = "例如：用户反馈无法登录，先停用核对",
  minReasonLength = 4,
  maxReasonLength = 500,
  confirmationPhrase,
  confirmationLabel,
  danger = false,
  onSuccess,
  onConfirm,
}: AdminReasonDialogProps) {
  const fieldId = useId();
  const confirmationId = useId();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const trimmed = reason.trim();
  const reasonValid =
    trimmed.length >= minReasonLength && trimmed.length <= maxReasonLength;
  const confirmationValid =
    confirmationPhrase === undefined ||
    confirmation.trim() === confirmationPhrase;
  const canConfirm = reasonValid && confirmationValid;

  async function confirm(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    if (!canConfirm || pending) return;
    setPending(true);
    setFailure(null);
    try {
      const result = await onConfirm(trimmed);
      if (result.ok) {
        setOpen(false);
        setReason("");
        setConfirmation("");
        onSuccess(result.message);
      } else {
        setFailure(result.message);
      }
    } catch {
      setFailure("操作未完成，请稍后重试；没有确认任何修改。");
    } finally {
      setPending(false);
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (pending) return;
        setOpen(nextOpen);
        if (!nextOpen) {
          setFailure(null);
          setConfirmation("");
        }
      }}
    >
      <AlertDialogTrigger>{trigger}</AlertDialogTrigger>
      <AlertDialogContent dismissible={!pending}>
        <AlertDialogTitle>{title}</AlertDialogTitle>
        <AlertDialogDescription>{description}</AlertDialogDescription>
        <div className="admin-dialog-field">
          <label htmlFor={fieldId}>{reasonLabel}</label>
          <textarea
            disabled={pending}
            id={fieldId}
            maxLength={maxReasonLength}
            onChange={(event) => setReason(event.target.value)}
            placeholder={reasonPlaceholder}
            rows={3}
            value={reason}
          />
          <small className="admin-muted">
            {trimmed.length}/{maxReasonLength} 字，至少 {minReasonLength} 字
          </small>
        </div>
        {confirmationPhrase ? (
          <div className="admin-dialog-field">
            <label htmlFor={confirmationId}>
              {confirmationLabel ?? `输入 ${confirmationPhrase} 以确认`}
            </label>
            <input
              autoComplete="off"
              disabled={pending}
              id={confirmationId}
              onChange={(event) => setConfirmation(event.target.value)}
              placeholder={confirmationPhrase}
              spellCheck={false}
              type="text"
              value={confirmation}
            />
          </div>
        ) : null}
        {failure ? (
          <p className="sueno-alert-dialog-error" role="alert">
            {failure}
          </p>
        ) : null}
        <div className="sueno-alert-dialog-actions">
          <AlertDialogCancel disabled={pending}>取消</AlertDialogCancel>
          <AlertDialogAction
            className={danger ? "admin-dialog-confirm--danger" : undefined}
            disabled={pending || !canConfirm}
            onClick={(event) => void confirm(event)}
          >
            {pending ? pendingLabel : confirmLabel}
          </AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
