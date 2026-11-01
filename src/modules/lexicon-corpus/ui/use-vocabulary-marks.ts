"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { normalizeSpanishSurface } from "../domain/spanish-token";

export type VocabularyMarkStatus = "familiar" | "learning" | "revisit" | "ignore";
type Marks = Record<string, VocabularyMarkStatus | null>;
type Snapshot = Readonly<{
  statuses: Record<string, VocabularyMarkStatus>;
  loading: boolean;
  pending: boolean;
  error: string;
  hasAnonymousMarks: boolean;
}>;
type Operation = { method: "GET" } | { method: "PUT"; word: string; status: VocabularyMarkStatus | null } | { method: "POST"; marks: Record<string, VocabularyMarkStatus>; anonymous: boolean };

const endpoint = "/api/v1/lexicon/vocabulary-marks";
const legacyPrefix = "sueno:vocabulary-status:v1:";
const changeEvent = "sueno:vocabulary-marks-saved";
const refreshPrefix = "sueno:vocabulary-marks-refresh:v1:";
const recoveryPrefix = "sueno:vocabulary-marks-recovered:v1:";
const migrationPrefix = "sueno:vocabulary-marks-migrated:v1:";
const timeoutMs = 15_000;

function isStatus(value: unknown): value is VocabularyMarkStatus {
  return value === "familiar" || value === "learning" || value === "revisit" || value === "ignore";
}

function readLocal(key: string): string | null {
  try { return window.localStorage.getItem(key); } catch { return null; }
}

/** Legacy values remain intact as a recovery backup, never as current account truth. */
function legacyMarks(scope: string): Record<string, VocabularyMarkStatus> {
  try {
    const value: unknown = JSON.parse(readLocal(`${legacyPrefix}${scope}`) ?? "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const entries = Object.entries(value).filter(([word, status]) => word.trim().length > 0 && word.length <= 120 && isStatus(status)).slice(0, 10_000);
    return Object.fromEntries(entries.map(([word, status]) => [normalizeSpanishSurface(word.trim()), status as VocabularyMarkStatus]));
  } catch { return {}; }
}

function decodeMarks(payload: unknown): Marks {
  if (!payload || typeof payload !== "object" || !("data" in payload)) throw new Error("INVALID_MARKS");
  const data = payload.data;
  if (!data || typeof data !== "object" || !("marks" in data)) throw new Error("INVALID_MARKS");
  const marks = data.marks;
  if (!marks || typeof marks !== "object" || Array.isArray(marks)) throw new Error("INVALID_MARKS");
  for (const [word, status] of Object.entries(marks)) {
    if (!word || word.length > 120 || (status !== null && !isStatus(status))) throw new Error("INVALID_MARKS");
  }
  return marks as Marks;
}

/** One cancellable controller per mounted account. No cross-account process cache. */
class VocabularyMarksStore {
  private snapshot: Snapshot = { statuses: {}, loading: true, pending: false, error: "", hasAnonymousMarks: false };
  private readonly initialSnapshot = this.snapshot;
  private listeners = new Set<() => void>();
  private generation = 0;
  private controller: AbortController | null = null;
  private connected = false;
  private ready = false;
  private failedOperation: Operation | null = null;
  private refreshQueued = false;

  constructor(private readonly scope: string) {}

  getSnapshot = () => this.snapshot;
  getServerSnapshot = () => this.initialSnapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };

  private update(patch: Partial<Snapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((listener) => listener());
  }

  connect = () => {
    this.connected = true;
    if (!this.scope || this.scope === "anonymous") {
      this.update({ loading: false, error: "登录状态暂时不可用，请重新登录后读取个人标记。" });
      return () => { this.connected = false; };
    }
    this.update({ hasAnonymousMarks: Object.keys(legacyMarks("anonymous")).length > 0 && readLocal(`${recoveryPrefix}${this.scope}`) !== "1" });
    void this.run({ method: "GET" });
    const refresh = () => {
      if (document.visibilityState === "hidden") return;
      if (this.snapshot.pending) { this.refreshQueued = true; return; }
      // Preserve the exact desired state after an ambiguous write failure until retry.
      if (this.failedOperation && this.failedOperation.method !== "GET") return;
      void this.run({ method: "GET" });
    };
    const changed = (event: Event) => {
      const detail = (event as CustomEvent<{ scope: string; source: VocabularyMarksStore }>).detail;
      if (detail?.scope === this.scope && detail.source !== this) refresh();
    };
    const storageChanged = (event: StorageEvent) => { if (event.key === `${refreshPrefix}${this.scope}`) refresh(); };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener(changeEvent, changed);
    window.addEventListener("storage", storageChanged);
    return () => {
      this.connected = false;
      this.generation += 1;
      this.controller?.abort();
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener(changeEvent, changed);
      window.removeEventListener("storage", storageChanged);
    };
  };

  private notifySaved() {
    window.dispatchEvent(new CustomEvent(changeEvent, { detail: { scope: this.scope, source: this } }));
    try { window.localStorage.setItem(`${refreshPrefix}${this.scope}`, `${Date.now()}:${Math.random()}`); } catch { /* Focus still refreshes when storage is disabled. */ }
  }

  private async request(operation: Operation, signal: AbortSignal): Promise<Marks> {
    const response = await fetch(endpoint, {
      method: operation.method,
      credentials: "same-origin",
      cache: "no-store",
      signal,
      // The server compares this expectation to its authenticated identity. A
      // stale tab must never import user A's browser backup into user B's session.
      headers: { "x-vocabulary-user-id": this.scope, ...(operation.method !== "GET" ? { "content-type": "application/json" } : {}) },
      ...(operation.method !== "GET" ? {
        body: JSON.stringify(operation.method === "PUT" ? { word: operation.word, status: operation.status } : { marks: operation.marks }),
      } : {}),
    });
    if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? "AUTH_REQUIRED" : "MARKS_UNAVAILABLE");
    return decodeMarks(await response.json());
  }

  private async run(operation: Operation) {
    if (!this.connected || !this.scope || this.scope === "anonymous") return;
    const generation = ++this.generation;
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    const isCurrent = () => this.connected && this.generation === generation;
    this.update({ loading: !this.ready, pending: operation.method !== "GET", error: "" });
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abortListener: (() => void) | undefined;
    try {
      // Bound response-body parsing too; do not rely on a transport respecting abort.
      const aborted = new Promise<never>((_, reject) => {
        abortListener = () => reject(new Error("MARKS_ABORTED"));
        controller.signal.addEventListener("abort", abortListener, { once: true });
        timer = setTimeout(() => controller.abort(), timeoutMs);
      });
      let marks = await Promise.race([this.request(operation, controller.signal), aborted]);
      if (!isCurrent()) return;
      let imported = false;
      if (operation.method === "GET" && readLocal(`${migrationPrefix}${this.scope}`) !== "1") {
        const legacy = legacyMarks(this.scope);
        const missing = Object.fromEntries(Object.entries(legacy).filter(([word]) => !Object.hasOwn(marks, word)));
        if (Object.keys(missing).length > 0) {
          this.update({ pending: true });
          marks = await Promise.race([this.request({ method: "POST", marks: missing, anonymous: false }, controller.signal), aborted]);
          if (!isCurrent()) return;
          imported = true;
        }
        if (Object.keys(legacy).length > 0) {
          // Acknowledged imports (including a server refusal to resurrect deleted
          // data) and complete cloud coverage finish this browser's migration.
          // Keep the original backup; this receipt only prevents repeat attempts.
          try { window.localStorage.setItem(`${migrationPrefix}${this.scope}`, "1"); } catch { /* The server's import guard still protects deletion when storage is blocked. */ }
        }
      }
      this.ready = true;
      this.failedOperation = null;
      const statuses = Object.fromEntries(Object.entries(marks).filter((entry): entry is [string, VocabularyMarkStatus] => entry[1] !== null));
      const recovered = operation.method === "POST" && operation.anonymous;
      if (recovered) {
        try { window.localStorage.setItem(`${recoveryPrefix}${this.scope}`, "1"); } catch { /* The database acknowledgement is authoritative. */ }
      }
      this.update({ statuses, loading: false, pending: false, error: "", ...(recovered ? { hasAnonymousMarks: false } : {}) });
      if (operation.method !== "GET" || imported) this.notifySaved();
    } catch (error: unknown) {
      if (!isCurrent()) return;
      this.failedOperation = operation;
      const authRequired = error instanceof Error && error.message === "AUTH_REQUIRED";
      if (authRequired) this.ready = false;
      this.update({ loading: false, pending: false, ...(authRequired ? { statuses: {} } : {}), error: authRequired
        ? "登录已失效，请重新登录后读取和保存个人标记。"
        : operation.method === "GET" ? "个人标记暂时无法同步，请重试。" : "标记尚未确认保存，请重试。" });
    } finally {
      if (timer) clearTimeout(timer);
      if (abortListener) controller.signal.removeEventListener("abort", abortListener);
      if (isCurrent() && this.refreshQueued && !this.failedOperation) {
        this.refreshQueued = false;
        void this.run({ method: "GET" });
      }
    }
  }

  toggle = (word: string, status: VocabularyMarkStatus) => {
    if (!this.ready || this.snapshot.pending || this.snapshot.loading) return;
    const normalized = normalizeSpanishSurface(word.trim());
    if (!normalized || normalized.length > 120 || !isStatus(status)) return;
    void this.run({ method: "PUT", word: normalized, status: this.snapshot.statuses[normalized] === status ? null : status });
  };

  retry = () => {
    if (this.snapshot.pending) return;
    void this.run(this.failedOperation ?? { method: "GET" });
  };

  importAnonymous = () => {
    if (!this.ready || this.snapshot.pending || this.snapshot.loading || !this.snapshot.hasAnonymousMarks) return;
    void this.run({ method: "POST", marks: legacyMarks("anonymous"), anonymous: true });
  };
}

export function useVocabularyMarks(scope: string) {
  const store = useMemo(() => new VocabularyMarksStore(scope), [scope]);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  useEffect(() => store.connect(), [store]);
  return { ...snapshot, toggle: store.toggle, retry: store.retry, importAnonymous: store.importAnonymous };
}
