import type { ProfileEvidence } from "./profile-overview";

export type CapabilityGroupKey = "lexical" | "communication" | "voice" | "shadowing";
export type CapabilityEvidencePolicy = "typing" | "speech" | "any";

export type CapabilityGroupDefinition = Readonly<{
  key: CapabilityGroupKey;
  label: string;
  description: string;
  prefixes: readonly string[];
  evidencePolicy: CapabilityEvidencePolicy;
}>;

export const CAPABILITY_GROUP_DEFINITIONS: readonly CapabilityGroupDefinition[] = [
  { key: "lexical", label: "词汇与短语", description: "识别、理解并主动调用词汇、搭配和实用短语。", prefixes: ["lexical.", "chunk."], evidencePolicy: "typing" },
  { key: "communication", label: "交流运用", description: "在真实对话中完成沟通目标，调整策略并接住对方。", prefixes: ["communication.", "conversation.", "task.", "pragmatics.", "grammar.", "accuracy.", "interaction.", "transfer.", "reaction.", "oral.reaction"], evidencePolicy: "any" },
  { key: "voice", label: "语音表达", description: "用清晰、连贯的语音表达自己的意思。", prefixes: ["pronunciation.", "fluency.", "reaction.", "oral.", "oral.reaction"], evidencePolicy: "speech" },
  { key: "shadowing", label: "跟读表现", description: "在明确的跟读练习中保持完整度、清晰度和节奏。", prefixes: ["shadowing.", "follow-reading.", "read-aloud."], evidencePolicy: "speech" },
];

export function capabilityDefinition(key: CapabilityGroupKey): CapabilityGroupDefinition {
  return CAPABILITY_GROUP_DEFINITIONS.find((definition) => definition.key === key)!;
}

export function skillBelongsToCapability(skillKey: string, definition: CapabilityGroupDefinition): boolean {
  return definition.prefixes.some((prefix) => skillKey.startsWith(prefix));
}

export function evidenceMatchesCapability(evidence: ProfileEvidence, definition: CapabilityGroupDefinition): boolean {
  if (!skillBelongsToCapability(evidence.skillKey, definition)) return false;
  if (definition.evidencePolicy === "any") return true;
  return evidence.modality === definition.evidencePolicy;
}
