"use client";

import { useEffect, useState } from "react";

type Offer = Readonly<{
  offerKey: string;
  targetCharacterKey: string;
  reasonText: string;
  reasonCode: string;
  shareableMemories?: readonly MemoryPreview[];
}>;

type LuciaContact = Readonly<{
  characterKey: "lucia";
  status: "pending" | "active" | "declined";
  relationshipStage: "new_contact" | "getting_to_know_you" | "familiar" | "close_friend";
  conversationId: string | null;
  source: Readonly<{ kind: "cultural-event"; city: "Madrid"; topic: "urban-photography" }>;
}>;

type MemoryPreview = Readonly<{
  id: string;
  category: string;
  content: string;
  sensitivity: "normal" | "sensitive";
  alreadyShared: boolean;
}>;

const names: Record<string, string> = { lucia: "Lucía Martín", mateo: "Mateo Ruiz", ines: "Inés García" };
type ReadStatus = "loading" | "ready" | "error";

async function readInbox<T>(url: string, signal: AbortSignal): Promise<T | undefined> {
  const response = await fetch(url, { cache: "no-store", signal });
  if (!response.ok) throw new Error("INTRODUCTIONS_UNAVAILABLE");
  const payload = await response.json() as { data?: T };
  return payload.data;
}

export function IntroductionInbox({ alwaysVisible = false, onIntroductionResolved, onLuciaContactChanged }: Readonly<{
  alwaysVisible?: boolean;
  onIntroductionResolved?: (decision: "accept" | "decline") => void;
  onLuciaContactChanged?: (contact: LuciaContact) => void;
}>) {
  const [offers, setOffers] = useState<readonly Offer[]>([]);
  const [luciaContact, setLuciaContact] = useState<LuciaContact | null>(null);
  const [selectedMemoryIds, setSelectedMemoryIds] = useState<Readonly<Record<string, readonly string[]>>>({});
  const [offersStatus, setOffersStatus] = useState<ReadStatus>("loading");
  const [contactStatus, setContactStatus] = useState<ReadStatus>("loading");
  const [reloadToken, setReloadToken] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    const offersRead = readInbox<{ offers?: Offer[] }>("/api/v1/character-network/introductions", controller.signal).then((data) => {
      if (!active) return;
      const nextOffers = data?.offers ?? [];
      setOffers(nextOffers);
      setSelectedMemoryIds((current) => Object.fromEntries(nextOffers.map((offer) => {
        const previous = current[offer.offerKey];
        const selected = (offer.shareableMemories ?? []).filter((memory) =>
          previous ? previous.includes(memory.id) : memory.alreadyShared);
        return [offer.offerKey, selected.map((memory) => memory.id)];
      })));
      setOffersStatus("ready");
    }).catch(() => {
      if (active) setOffersStatus("error");
    });
    const contactRead = readInbox<LuciaContact>("/api/v1/character-network/lucia-contact", controller.signal).then((contact) => {
      if (!active) return;
      setLuciaContact(contact ?? null);
      setContactStatus("ready");
    }).catch(() => {
      if (active) setContactStatus("error");
    });
    void Promise.all([offersRead, contactRead]).finally(() => window.clearTimeout(timeout));
    return () => {
      active = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [reloadToken]);

  function retry() {
    setOffersStatus("loading");
    setContactStatus("loading");
    setReloadToken((token) => token + 1);
  }

  async function respond(offerKey: string, decision: "accept" | "decline") {
    setBusy(offerKey);
    setMessage(null);
    try {
      const response = await fetch(`/api/v1/character-network/introductions/${encodeURIComponent(offerKey)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision, memoryIds: selectedMemoryIds[offerKey] ?? [] }),
      });
      if (!response.ok) throw new Error("INTRODUCTION_RESPONSE_FAILED");
      setOffers((current) => current.filter((offer) => offer.offerKey !== offerKey));
      setMessage(decision === "accept" ? "已同意介绍；新好友只会看到你明确分享的资料。" : "已暂不接受这次介绍。");
      onIntroductionResolved?.(decision);
    } catch {
      setMessage("暂时无法处理这次介绍，请稍后再试。");
    } finally {
      setBusy(null);
    }
  }

  async function respondToLucia(decision: "accept" | "decline") {
    setBusy("lucia");
    setMessage(null);
    try {
      const response = await fetch("/api/v1/character-network/lucia-contact", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      if (!response.ok) throw new Error("CONTACT_RESPONSE_FAILED");
      const payload = await response.json() as { data?: LuciaContact };
      if (!payload.data) throw new Error("CONTACT_RESPONSE_FAILED");
      setLuciaContact(payload.data);
      onLuciaContactChanged?.(payload.data);
      setMessage(decision === "accept" ? "已通过 Lucía 的好友申请，现在可以开始聊天了。" : "已暂不接受 Lucía 的好友申请。你之后仍可以重新考虑。");
    } catch {
      setMessage("暂时无法处理这次好友申请，请稍后再试。");
    } finally {
      setBusy(null);
    }
  }

  const loading = offersStatus === "loading" || contactStatus === "loading";
  const loadError = offersStatus === "error" && contactStatus === "error"
    ? "暂时无法读取好友申请和介绍。"
    : offersStatus === "error" ? "暂时无法读取好友介绍。"
      : contactStatus === "error" ? "暂时无法读取好友申请。" : null;
  const canReconsider = luciaContact?.status === "declined";
  const hasLuciaRequest = contactStatus === "ready" && (luciaContact?.status === "pending" || canReconsider);
  if (offers.length === 0 && !hasLuciaRequest && !message && !loading && !loadError && !alwaysVisible) return null;

  function toggleMemory(offerKey: string, memoryId: string, checked: boolean) {
    setSelectedMemoryIds((current) => {
      const selected = new Set(current[offerKey] ?? []);
      if (checked) selected.add(memoryId);
      else selected.delete(memoryId);
      return { ...current, [offerKey]: [...selected] };
    });
  }

  return (
    <section className="conversation-introductions" aria-labelledby="conversation-introductions-title">
      <div className="conversation-introductions__header">
        <p className="eyebrow eyebrow--accent">来自 Lucía 的介绍</p>
        <h2 id="conversation-introductions-title">认识一个新朋友</h2>
        <p>只有在聊天中出现真实理由时才会出现介绍。你可以先同意建立关系，之后再单独授权资料。</p>
      </div>
      {loading ? <p className="surface-state__message">正在读取好友申请与介绍……</p> : null}
      {!loading && !loadError && offers.length === 0 && !hasLuciaRequest && !message ? <p className="surface-state__message">目前没有新的介绍请求。</p> : null}
      {loadError ? (
        <div className="surface-state__message" role="alert">
          <p>{loadError}</p>
          <button type="button" className="button--quiet" onClick={retry} disabled={busy !== null}>
            重试
          </button>
        </div>
      ) : null}
      {hasLuciaRequest ? (
        <article className="introduction-card" data-testid="lucia-contact-request">
          <div>
            <h3>Lucía Martín</h3>
            <p>在 Lucía 的虚构故事设定里，你们曾在马德里的一场文化活动中聊到城市摄影。她记住了你提到的一句话，想在这里继续和你聊天。</p>
            <p className="introduction-card__hint">虚构背景：Madrid · 城市摄影（不代表真实活动或线下见面）</p>
            {canReconsider ? <p className="introduction-card__hint">你仍可以通过这项申请。</p> : null}
          </div>
          <div className="introduction-card__actions">
            <button type="button" onClick={() => void respondToLucia("accept")} disabled={busy !== null}>通过申请</button>
            {!canReconsider ? <button type="button" className="button--quiet" onClick={() => void respondToLucia("decline")} disabled={busy !== null}>暂不接受</button> : null}
          </div>
        </article>
      ) : null}
      {offersStatus === "ready" ? offers.map((offer) => (
        <article className="introduction-card" key={offer.offerKey}>
          <div>
            <h3>{names[offer.targetCharacterKey] ?? "新朋友"}</h3>
            <p>{offer.reasonText}</p>
            {(offer.shareableMemories ?? []).length > 0 ? (
              <fieldset className="introduction-card__memories">
                <legend>可以分享给对方的资料（可选）</legend>
                <p className="introduction-card__hint">不勾选就不会共享。私密记忆不会出现在这里。</p>
                {(offer.shareableMemories ?? []).map((memory) => {
                  const checked = (selectedMemoryIds[offer.offerKey] ?? []).includes(memory.id);
                  return (
                    <label className="introduction-card__memory" key={memory.id}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(event) => toggleMemory(offer.offerKey, memory.id, event.currentTarget.checked)}
                        disabled={busy !== null}
                      />
                      <span>
                        {memory.content}
                        {memory.sensitivity === "sensitive" ? <small>（敏感资料）</small> : null}
                      </span>
                    </label>
                  );
                })}
              </fieldset>
            ) : (
              <p className="introduction-card__hint">当前没有需要分享的资料；你仍然可以只建立关系。</p>
            )}
          </div>
          <div className="introduction-card__actions">
            <button type="button" onClick={() => void respond(offer.offerKey, "accept")} disabled={busy !== null}>
              同意介绍
            </button>
            <button type="button" className="button--quiet" onClick={() => void respond(offer.offerKey, "decline")} disabled={busy !== null}>
              先不认识
            </button>
          </div>
        </article>
      )) : null}
      {message ? <p className="surface-state__message" role="status">{message}</p> : null}
    </section>
  );
}
