"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import {
  vocabularyRecallProgressResponseSchema,
  vocabularyRecallProgressWriteSchema,
  type VocabularyRecallProgress,
  type VocabularyRecallProgressEntry,
  type VocabularyRecallProgressResponse,
  type VocabularyRecallProgressWrite,
} from "../schemas/vocabulary-recall-progress";

export type { VocabularyRecallProgress, VocabularyRecallProgressEntry } from "../domain/vocabulary-recall-progress";
type Snapshot = Readonly<{
  epoch: string | null;
  progress: readonly VocabularyRecallProgress[];
  loading: boolean;
  pending: boolean;
  error: string;
  conflict: boolean;
  acknowledgedAttemptId: string | null;
  lastSavedEntries: readonly VocabularyRecallProgressEntry[];
}>;
type Operation = Readonly<{ method: "GET" }> | Readonly<{ method: "POST"; body: VocabularyRecallProgressWrite }>;

const endpoint = "/api/v1/lexicon/vocabulary-recall-progress";
const refreshPrefix = "sueno:vocabulary-recall-refresh:v1:";
const changeEvent = "sueno:vocabulary-recall-progress-saved";
const timeoutMs = 15_000;
const conflictMessage = "默写进度已变化，已重新同步。请退出本轮后重新开始，避免覆盖其他设备或清除后的进度。";

function decode(payload: unknown): VocabularyRecallProgressResponse {
  if (!payload || typeof payload !== "object" || !("data" in payload)) throw new Error("INVALID_PROGRESS");
  const data = vocabularyRecallProgressResponseSchema.parse(payload.data);
  if (new Set(data.progress.map(({ word, mode }) => JSON.stringify([word, mode]))).size !== data.progress.length) {
    throw new Error("INVALID_PROGRESS");
  }
  return data;
}

/** Account-local transport state. Only acknowledged self-check progress survives a request. */
class VocabularyRecallProgressStore {
  private snapshot: Snapshot = {
    epoch: null, progress: [], loading: true, pending: false, error: "", conflict: false,
    acknowledgedAttemptId: null, lastSavedEntries: [],
  };
  private readonly initialSnapshot = this.snapshot;
  private listeners = new Set<() => void>();
  private generation = 0;
  private controller: AbortController | null = null;
  private connected = false;
  private ready = false;
  private epoch: string | null = null;
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
      this.update({ loading: false, error: "请登录后读取和保存默写进度。" });
      return () => { this.connected = false; };
    }
    void this.run({ method: "GET" });
    const refresh = () => {
      if (document.visibilityState === "hidden" || this.snapshot.conflict) return;
      this.refresh();
    };
    const changed = (event: Event) => {
      const detail = (event as CustomEvent<{ scope: string; source: VocabularyRecallProgressStore }>).detail;
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
    try { window.localStorage.setItem(`${refreshPrefix}${this.scope}`, `${Date.now()}:${Math.random()}`); }
    catch { /* No practice answers or progress are stored locally. Focus still refreshes. */ }
  }

  private async request(operation: Operation, signal: AbortSignal) {
    const response = await fetch(endpoint, {
      method: operation.method, credentials: "same-origin", cache: "no-store", signal,
      headers: { "x-vocabulary-user-id": this.scope, ...(operation.method === "POST" ? { "content-type": "application/json" } : {}) },
      ...(operation.method === "POST" ? { body: JSON.stringify(operation.body) } : {}),
    });
    if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? "AUTH_REQUIRED"
      : response.status === 409 ? "CONFLICT" : "PROGRESS_UNAVAILABLE");
    return decode(await response.json());
  }

  private async run(operation: Operation, afterConflict = false): Promise<boolean> {
    if (!this.connected || !this.scope || this.scope === "anonymous") return false;
    const generation = ++this.generation;
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    const isCurrent = () => this.connected && this.generation === generation;
    this.update({ loading: !this.ready, pending: operation.method === "POST", error: "", conflict: afterConflict });
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abortListener: (() => void) | undefined;
    try {
      const aborted = new Promise<never>((_, reject) => {
        abortListener = () => reject(new Error("PROGRESS_ABORTED"));
        controller.signal.addEventListener("abort", abortListener, { once: true });
        timer = setTimeout(() => controller.abort(), timeoutMs);
      });
      const data = await Promise.race([this.request(operation, controller.signal), aborted]);
      if (!isCurrent()) return false;
      this.epoch = data.epoch;
      this.ready = true;
      this.failedOperation = null;
      this.update({
        epoch: data.epoch, progress: data.progress, loading: false, pending: false,
        error: afterConflict ? conflictMessage : "", conflict: afterConflict,
        ...(operation.method === "POST" ? {
          acknowledgedAttemptId: operation.body.attemptId, lastSavedEntries: operation.body.entries,
        } : {}),
      });
      if (operation.method === "POST") this.notifySaved();
      return true;
    } catch (error: unknown) {
      if (!isCurrent()) return false;
      if (error instanceof Error && error.message === "CONFLICT") {
        this.failedOperation = null;
        this.refreshQueued = false;
        this.ready = false;
        await this.run({ method: "GET" }, true);
        return false;
      }
      this.failedOperation = operation;
      const authRequired = error instanceof Error && error.message === "AUTH_REQUIRED";
      if (authRequired) { this.ready = false; this.epoch = null; this.failedOperation = null; }
      this.update({
        loading: false, pending: false, conflict: afterConflict,
        ...(authRequired ? { epoch: null, progress: [], acknowledgedAttemptId: null, lastSavedEntries: [] } : {}),
        error: authRequired ? "登录已失效，请重新登录后读取和保存默写进度。"
          : operation.method === "POST" ? "默写进度尚未确认保存，请重试；退出前请确认保存成功。"
            : afterConflict ? "默写进度已变化，但重新同步失败。请重试并重新开始本轮。" : "默写进度暂时无法同步，请重试。",
      });
      return false;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      if (abortListener) controller.signal.removeEventListener("abort", abortListener);
      if (isCurrent() && this.refreshQueued && !this.failedOperation && !this.snapshot.conflict) {
        this.refreshQueued = false;
        void this.run({ method: "GET" });
      }
    }
  }

  save = (entries: readonly VocabularyRecallProgressEntry[], expectedEpoch?: string): Promise<boolean> => {
    if (!this.ready || !this.epoch || this.snapshot.pending || this.snapshot.loading || this.snapshot.error || this.failedOperation) return Promise.resolve(false);
    // A background refresh may have observed a privacy clear since this round began.
    if (expectedEpoch !== undefined && expectedEpoch !== this.epoch) {
      this.update({ conflict: true, error: conflictMessage });
      return Promise.resolve(false);
    }
    const body = vocabularyRecallProgressWriteSchema.safeParse({ epoch: this.epoch, attemptId: crypto.randomUUID(), entries });
    if (!body.success) return Promise.resolve(false);
    return this.run({ method: "POST", body: body.data });
  };

  retry = () => {
    if (this.snapshot.pending) return;
    void this.run(this.failedOperation ?? { method: "GET" });
  };

  refresh = () => {
    if (this.snapshot.pending) { this.refreshQueued = true; return; }
    // A failed write may already have committed. Only its exact attempt may resolve it.
    if (this.failedOperation?.method === "POST") return;
    void this.run({ method: "GET" });
  };
}

export function useVocabularyRecallProgress(scope: string) {
  const store = useMemo(() => new VocabularyRecallProgressStore(scope), [scope]);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  useEffect(() => store.connect(), [store]);
  return { ...snapshot, save: store.save, retry: store.retry, refresh: store.refresh };
}
