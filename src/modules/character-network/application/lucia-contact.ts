import type { LuciaContactRecord, LuciaContactRepository } from "../repositories";

export async function getLuciaContact(input: Readonly<{ repository: LuciaContactRepository; userId: string }>): Promise<LuciaContactRecord> {
  return input.repository.get(input.userId);
}

export async function respondToLuciaContact(input: Readonly<{
  repository: LuciaContactRepository;
  userId: string;
  decision: "accept" | "decline";
}>): Promise<LuciaContactRecord> {
  return input.repository.transaction((repository) => repository.respond(input.userId, input.decision));
}
