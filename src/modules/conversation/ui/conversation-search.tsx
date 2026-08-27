"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type SearchResult = Readonly<{
  messageId: string;
  characterKey: string;
  characterName: string;
  role: "user" | "character";
  snippet: string;
  createdAt: string;
}>;

export function ConversationSearch({ compact = false }: Readonly<{ compact?: boolean }>) {
  const [value, setValue] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [results, setResults] = useState<readonly SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setSubmittedQuery(value), 350);
    return () => window.clearTimeout(timer);
  }, [value]);

  useEffect(() => {
    const query = submittedQuery.trim();
    if (!query) {
      return;
    }
    const controller = new AbortController();
    void fetch(`/api/v1/conversations/search?q=${encodeURIComponent(query)}`, { signal: controller.signal, cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("SEARCH_FAILED");
        return response.json() as Promise<{ data?: { results?: SearchResult[] } }>;
      })
      .then((payload) => setResults(payload.data?.results ?? []))
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setResults([]);
        setError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [submittedQuery]);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setResults([]);
    setError(false);
    setLoading(Boolean(value.trim()));
    setSubmittedQuery(value);
  }

  return (
    <div className={`conversation-search ${compact ? "conversation-search--compact" : ""}`}>
      <form className="conversation-search__form" onSubmit={submit} role="search">
        <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="11" cy="11" r="6" /><path d="m16 16 4 4" /></svg>
        <input
          aria-label="搜索对话"
          onChange={(event) => setValue(event.target.value)}
          placeholder="搜索对话"
          type="search"
          value={value}
        />
        {value ? <button aria-label="清空对话搜索" className="conversation-search__clear" onClick={() => { setValue(""); setSubmittedQuery(""); setResults([]); setError(false); }} type="button">×</button> : null}
        <button aria-label="提交对话搜索" className="conversation-search__submit" type="submit">
          <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m5 12 5 5L19 8" /></svg>
        </button>
      </form>
      {submittedQuery ? (
        <div className="conversation-search__results" aria-live="polite">
          {loading ? <p className="conversation-search__state">正在搜索……</p> : null}
          {!loading && error ? <p className="conversation-search__state" role="alert">暂时无法搜索聊天记录。</p> : null}
          {!loading && !error && results.length === 0 ? <p className="conversation-search__state">没有找到匹配的消息。</p> : null}
          {!loading && !error ? results.map((result) => (
            <Link
              className="conversation-search__result"
              href={`/chat/${encodeURIComponent(result.characterKey)}?message=${encodeURIComponent(result.messageId)}`}
              key={`${result.characterKey}-${result.messageId}`}
            >
              <span className="conversation-search__result-meta">{result.characterName} · {result.role === "user" ? "你" : "对方"} · {formatSearchTime(result.createdAt)}</span>
              <span>{result.snippet}</span>
            </Link>
          )) : null}
        </div>
      ) : null}
    </div>
  );
}

function formatSearchTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}
