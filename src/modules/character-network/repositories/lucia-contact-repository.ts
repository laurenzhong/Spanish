export type LuciaContactStatus = "pending" | "active" | "declined";

export type LuciaContactRecord = Readonly<{
  characterKey: "lucia";
  status: LuciaContactStatus;
  relationshipStage: "new_contact" | "getting_to_know_you" | "familiar" | "close_friend";
  relationshipSummary: string | null;
  conversationId: string | null;
  source: Readonly<{
    kind: "cultural-event";
    city: "Madrid";
    topic: "urban-photography";
  }>;
}>;

export type LuciaContactRepository = Readonly<{
  transaction<T>(work: (repository: LuciaContactRepository) => Promise<T>): Promise<T>;
  get(userId: string): Promise<LuciaContactRecord>;
  respond(userId: string, decision: "accept" | "decline"): Promise<LuciaContactRecord>;
  ensureAuthoredOpeningMessage(userId: string): Promise<void>;
}>;
