/** Detect structural corruption, not Spanish fluency. Never trim a leaked reasoning prefix and publish the remainder. */
export function hasProviderOutputContamination(text: string): boolean {
  const protocol = /<\/?(?:mm:)?(?:think(?:ing)?|analysis|reasoning)\b|<\|(?:analysis|thinking|reasoning)\|>/iu;
  const planning = /(?:^|\n)\s*(?:Need clean\s*:|Need no (?:English|Chinese)\b|Let's (?:formulate|think)\b)/iu;
  // Retry10 R04: visible English planning text was fused into a Spanish reply.
  const leakedPlanningPhrase = /speech\s+seems\s+fine|no\s+reply\s+yet|need\s+wait/iu;
  // Retry20 R04: an internal title placeholder leaked into a visible reply.
  const internalPlaceholder = /\b(?:o_)?special:posible_title\b/iu;
  // Retry23 R04: the provider exposed an English-only instruction fragment.
  const leakedLanguageInstruction = /\bno\s+matter\.\s*spanish\s+only\b/iu;
  // Retry25 R04: a duplicated internal question marker leaked into visible text.
  const leakedQuestionMarker = /\bquestions?question\s*\d+\b/iu;
  // Retry26 R04: visible unfinished self-correction from provider drafting.
  const leakedSelfCorrection = /[¡!]?\s*no\s*,\s*otra\s*[.!?]?/iu;
  // Retry11 R04: two unfinished drafts were joined by a visible pipe.
  const fusedDraftSeparator = /\p{L}\|\p{L}/u;
  // Broken inline glyph from the observed baseline; preserve ordinary emoji/emoticons and maths.
  const brokenInline = /\p{L}\^\)(?=\s+\p{L})/u;
  const invalidCharacters = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffd]/u;
  // Preserve neither URL-style encoding residue nor an unfinished arrow/edit
  // marker. Both appeared in visible Flash candidates and are not ordinary
  // Spanish chat punctuation.
  const encodedResidue = /%[0-9a-f]{2}/iu;
  const unfinishedEdit = /(?:\(|\[)?\s*[-=]>\s*(?:\)|\])?/u;
  const truncatedConnector = /\b(?:que|porque|aunque)\s*[-–—]\s*$/iu;
  return protocol.test(text) || planning.test(text) || leakedPlanningPhrase.test(text) || internalPlaceholder.test(text) || leakedLanguageInstruction.test(text) || leakedQuestionMarker.test(text) || leakedSelfCorrection.test(text) || fusedDraftSeparator.test(text) || brokenInline.test(text) || invalidCharacters.test(text) || encodedResidue.test(text) || unfinishedEdit.test(text) || truncatedConnector.test(text);
}
