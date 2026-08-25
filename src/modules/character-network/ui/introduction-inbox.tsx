"use client";

import { useEffect, useState } from "react";

type Offer = Readonly<{
  offerKey: string;
  targetCharacterKey: string;
  reasonText: string;
  reasonCode: string;
  shareableMemories?: readonly MemoryPreview[];
}>;

type MemoryPreview = Readonly<{
  id: string;
  category: string;
  content: string;
  sensitivity: "normal" | "sensitive";
  alreadyShared: boolean;
}>;

const names: Record<string, string> = { mateo: "Mateo Ruiz", ines: "Inés García" };

export function IntroductionInbox() {
  const [offers, setOffers] = useState<readonly Offer[]>([]);
  const [selectedMemoryIds, setSelectedMemoryIds] = useState<Readonly<Record<string, readonly string[]>>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void fetch("/api/v1/character-network/introductions", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : { data: { offers: [] } })
      .then((payload: { data?: { offers?: Offer[] } }) => {
        if (!active) return;
        const nextOffers = payload.data?.offers ?? [];
        setOffers(nextOffers);
        setSelectedMemoryIds(Object.fromEntries(nextOffers.map((offer) => [
          offer.offerKey,
          (offer.shareableMemories ?? []).filter((memory) => memory.alreadyShared).map((memory) => memory.id),
        ])));
      })
      .catch(() => {
        if (active) setOffers([]);
      });
    return () => { active = false; };
  }, []);

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
    } catch {
      setMessage("暂时无法处理这次介绍，请稍后再试。");
    } finally {
      setBusy(null);
    }
  }

  if (offers.length === 0 && !message) return null;

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
      {offers.map((offer) => (
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
      ))}
      {message ? <p className="surface-state__message" role="status">{message}</p> : null}
    </section>
  );
}
