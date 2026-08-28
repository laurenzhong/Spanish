import type { LuciaContactRecord, LuciaContactRepository } from "../repositories";

export async function getLuciaContact(input: Readonly<{ repository: LuciaContactRepository; userId: string }>): Promise<LuciaContactRecord> {
  return input.repository.transaction(async (repository) => {
    const contact = await repository.get(input.userId);
    if (contact.status === "active") {
      await repository.ensureAuthoredOpeningMessage(input.userId);
      return repository.get(input.userId);
    }
    return contact;
  });
}

export async function respondToLuciaContact(input: Readonly<{
  repository: LuciaContactRepository;
  userId: string;
  decision: "accept" | "decline";
}>): Promise<LuciaContactRecord> {
  return input.repository.transaction(async (repository) => {
    const result = await repository.respond(input.userId, input.decision);
    if (input.decision === "accept" && result.status === "active") {
      await repository.ensureAuthoredOpeningMessage(input.userId);
    }
    return result;
  });
}
