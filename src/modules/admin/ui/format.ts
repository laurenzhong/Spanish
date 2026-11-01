/**
 * Pure formatting and label helpers for the owner regulatory console
 * (ACCT-ADMIN-001 slice U1).
 *
 * Everything here is deterministic and locale-independent on purpose:
 * server-rendered client components must produce identical markup on the
 * server and in the browser, so timestamps are always rendered in UTC with an
 * explicit suffix instead of the runtime's local time zone. The console is an
 * operational view: every number, ratio and cost is a metric, never a
 * learning-capability fact.
 */

import type {
  AdminCandidateStatus,
  AdminHealthStatus,
  AdminWindow,
  DiagnosticEventType,
  DiagnosticSeverity,
  DiagnosticStatus,
} from "../domain/admin-console";
import type { AdminAuditAction, AdminAuditTargetKind } from "../domain/admin-audit";

export const ADMIN_WINDOW_LABELS: Readonly<Record<AdminWindow, string>> = {
  "24h": "最近 24 小时",
  "7d": "最近 7 天",
  "30d": "最近 30 天",
};

export const ADMIN_WINDOW_MS: Readonly<Record<AdminWindow, number>> = {
  "24h": 24 * 60 * 60 * 1_000,
  "7d": 7 * 24 * 60 * 60 * 1_000,
  "30d": 30 * 24 * 60 * 60 * 1_000,
};

export const ADMIN_HEALTH_LABELS: Readonly<Record<AdminHealthStatus, string>> = {
  healthy: "运行正常",
  degraded: "需要关注",
  critical: "存在未处理告警",
};

export const ADMIN_ROLE_LABELS = {
  owner: "所有者",
  member: "成员",
} as const;

export const ADMIN_USER_STATUS_LABELS = {
  active: "正常",
  suspended: "已停用",
} as const;

export const ADMIN_INVITATION_STATUS_LABELS = {
  pending: "待兑换",
  redeeming: "兑换中",
  accepted: "已接受",
  expired: "已过期",
  revoked: "已撤销",
  failed: "失败",
} as const;

export const ADMIN_DIAGNOSTIC_STATUS_LABELS: Readonly<
  Record<DiagnosticStatus, string>
> = {
  open: "待处理",
  acknowledged: "已确认",
  resolved: "已解决",
};

export const ADMIN_DIAGNOSTIC_SEVERITY_LABELS: Readonly<
  Record<DiagnosticSeverity, string>
> = {
  warning: "警告",
  alert: "告警",
};

export const ADMIN_DIAGNOSTIC_EVENT_TYPE_LABELS: Readonly<
  Record<DiagnosticEventType, string>
> = {
  "conversation.stream_failed": "对话流失败",
  "evidence.duplicate": "学习证据重复",
  "memory.conflict": "关系记忆冲突",
  "privacy.storage_cleanup_failed": "Storage 清理失败",
};

export const ADMIN_AUDIT_ACTION_LABELS: Readonly<Record<AdminAuditAction, string>> = {
  "invitation.create": "创建邀请",
  "invitation.revoke": "撤销邀请",
  "user.suspend": "停用账号",
  "user.activate": "恢复账号",
  "user.delete": "注销账号",
  "user.sessions_revoke": "撤销会话",
  "diagnostic.acknowledge": "确认诊断事件",
  "diagnostic.resolve": "解决诊断事件",
};

export const ADMIN_AUDIT_TARGET_KIND_LABELS: Readonly<
  Record<AdminAuditTargetKind, string>
> = {
  user: "账号",
  invitation: "邀请",
  diagnostic_event: "诊断事件",
};

export const ADMIN_CANDIDATE_STATUS_LABELS: Readonly<
  Record<AdminCandidateStatus, string>
> = {
  discovered: "已发现",
  screened: "已初筛",
  acquiring: "采集中",
  processing: "处理中",
  review_ready: "等待审核",
  failed: "失败",
  rejected: "已拒绝",
};

const PROVIDER_TYPE_LABELS: Readonly<Record<string, string>> = {
  conversation: "对话生成",
  "conversation-reply": "对话生成",
  evaluation: "表达评估",
  "pronunciation-assessment": "发音评估",
  "word-explanation": "词语解释",
  translation: "翻译",
  asr: "语音转写",
  tts: "语音合成",
  embedding: "向量嵌入",
};

export function providerTypeLabel(providerType: string): string {
  return PROVIDER_TYPE_LABELS[providerType] ?? providerType;
}

/** UTC `YYYY-MM-DD HH:mm` with an explicit suffix; `—` for absent/invalid values. */
export function formatAdminDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return `${padAdminPart(date.getUTCFullYear(), 4)}-${padAdminPart(date.getUTCMonth() + 1)}-${padAdminPart(date.getUTCDate())} ${padAdminPart(date.getUTCHours())}:${padAdminPart(date.getUTCMinutes())} UTC`;
}

/** UTC `YYYY-MM-DD`; `—` for absent/invalid values. */
export function formatAdminDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return `${padAdminPart(date.getUTCFullYear(), 4)}-${padAdminPart(date.getUTCMonth() + 1)}-${padAdminPart(date.getUTCDate())}`;
}

/** ISO instant used by the AI-usage shortcuts and datetime inputs. */
export function toAdminIsoParam(value: Date): string {
  return value.toISOString();
}

export function formatAdminCount(value: number): string {
  return Number.isFinite(value) ? Math.trunc(value).toLocaleString("zh-CN") : "0";
}

/** Fraction (`0..1`) as a one-decimal percentage; `—` when there is no sample. */
export function formatAdminRatio(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(1)}%`;
}

export function formatAdminLatency(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${formatAdminCount(value)} ms`;
}

/**
 * Estimated provider cost in "micros of the billing currency". Cost is sparse
 * in `provider_calls`, so the caller always shows coverage next to it and this
 * formatter never implies completeness.
 */
export function formatAdminCostMicros(micros: number): string {
  if (!Number.isFinite(micros) || micros < 0) return "$0.0000";
  return `$${(Math.trunc(micros) / 1_000_000).toFixed(4)}`;
}

/** Relative width for the CSS bar charts; never above 100%. */
export function barWidthPercent(value: number, max: number): string {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0 || value <= 0) {
    return "0%";
  }
  const ratio = Math.min(value / max, 1);
  return `${(ratio * 100).toFixed(1)}%`;
}

/** Build a same-page query-string link, dropping empty values and `undefined`. */
export function buildAdminHref(
  pathname: string,
  params: Readonly<Record<string, string | number | boolean | null | undefined>>,
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === "" || value === false) continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `${pathname}?${query}` : pathname;
}

function padAdminPart(value: number, length = 2): string {
  return String(value).padStart(length, "0");
}
