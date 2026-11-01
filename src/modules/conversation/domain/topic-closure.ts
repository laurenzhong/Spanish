function normalize(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/gu, "").toLocaleLowerCase("es-ES");
}

/** Bounded explicit intent detection, not a semantic topic lifecycle or memory write. */
export function explicitlyClosesTopic(text: string): boolean {
  const value = normalize(text).replace(/[«“"].*?[»”"]/gu, "");
  if (/\b(?:traduce|traducir|como se dice|que significa)\b|翻译|怎么说|什么意思/u.test(value)) return false;
  const close = /\b(?:no (?:quiero|me apetece) (?:seguir )?(?:hablar|charlar)|prefiero (?:hablar|charlar) de otras? cosas?|cambiemos de tema|dejemos (?:ese|este|el) tema)\b|不想(?:再|继续)?聊|别再(?:说|聊)|换个话题/gu;
  const lastClose = [...value.matchAll(close)].at(-1)?.index;
  if (lastClose === undefined) return false;
  const reopen = /\b(?:ahora si|volvamos a|quiero retomar)\b|现在想聊|重新聊/gu;
  const lastReopen = [...value.matchAll(reopen)].at(-1)?.index;
  return lastReopen === undefined || lastReopen < lastClose;
}

/** Catch bounded continuation pressure, including unsolicited topic-selection questions. */
export function coaxesAfterTopicClosure(userMessage: string, reply: string): boolean {
  if (!explicitlyClosesTopic(userMessage)) return false;
  const value = normalize(reply);
  const asksForTopicHelp = /\b(?:sugiere(?:me)?|propone?me|elige|dame)\b.{0,40}\b(?:tema|temas)\b|\bde que (?:podemos|podriamos) hablar\b|推荐.*话题|帮我.*话题/u.test(normalize(userMessage));
  // A final, standalone closure clause supplies no new subject for a follow-up.
  // Keep this narrow: a subsequent sentence, contrast or question stays available
  // for normal conversation instead of guessing its topic from a hobby dictionary.
  const endsWithClosure = /(?:no (?:quiero|me apetece) (?:seguir )?(?:hablar|charlar)(?: (?:de|sobre) [\p{L} ]+)?|prefiero (?:hablar|charlar) de otras? cosas?|cambiemos de tema|dejemos (?:ese|este|el) tema)[.!\s]*$/u.test(normalize(userMessage))
    && !/\b(?:pero|aunque|ademas)\b/u.test(normalize(userMessage).split(/[.!?]/u).filter(part => part.trim()).at(-1) ?? "");
  const unsolicitedQuestion = endsWithClosure && /[?？]/u.test(reply);
  const replacementTopicQuestion = /\b(?:de que|sobre que|que)\s+(?:te apetece|quieres|prefieres|podemos)\s+(?:hablar|charlar)\b[^.!?\n]*\?/u.test(value)
    || /(?:想|想要|愿意)聊(?:点)?什么[^。！\n]*[?？]/u.test(value);
  return /\bno hace falta\b[^.!?\n]{0,100}\bpara (?:hablar|charlar)\b/u.test(value)
    || /\b(?:podemos|podriamos) (?:seguir |aun |todavia )?(?:hablar|charlar|hablando|charlando) (?:de (?:eso|ello|ellas|ellos)|sobre (?:eso|ello))\b/u.test(value)
    || /\b(?:por que no quieres|por que no te apetece) (?:hablar|charlar)\b/u.test(value)
    || /(?:还是|仍然|照样)可以(?:继续)?聊|为什么不想聊/u.test(value)
    || (!asksForTopicHelp && (replacementTopicQuestion || unsolicitedQuestion));
}
