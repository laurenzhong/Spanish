/**
 * Provider port for creating/removing/banning Supabase Auth users during
 * invitation redemption and account management (ACCT-ADMIN-001, ADR-0021).
 *
 * Application use cases depend only on this interface so tests never call the
 * real Supabase Admin API. The Supabase adapter resolves the server-only secret
 * key and fails closed when it is not configured; the key is never imported by
 * client code.
 */
export type CreatedAuthUser = Readonly<{ userId: string }>;

export interface AccountProvisioner {
  /** Create an already-confirmed Auth user (no email is sent by our code). */
  createConfirmedUser(input: { email: string }): Promise<CreatedAuthUser>;
  /** Idempotent: a missing Auth user counts as success. */
  deleteUser(userId: string): Promise<void>;
  /** Idempotent account ban used when an account is suspended. */
  banUser(userId: string): Promise<void>;
  /** Idempotent account unban used when an account is reactivated. */
  unbanUser(userId: string): Promise<void>;
}

/**
 * Safe provider failure. Messages never contain the email address, provider
 * request bodies or credentials; the Route Handler maps it to
 * `ACCOUNT_PROVISIONING_FAILED`.
 */
export class AccountProvisioningError extends Error {
  constructor(message = "Account provisioning is temporarily unavailable.") {
    super(message);
    this.name = "AccountProvisioningError";
  }
}
