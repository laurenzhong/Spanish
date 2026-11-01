import { createClient } from "@supabase/supabase-js";

import {
  AccountProvisioningError,
  type AccountProvisioner,
  type CreatedAuthUser,
} from "./account-provisioner";

/**
 * Supabase Admin adapter for the `AccountProvisioner` port.
 *
 * The service-role/secret key is read only from server environment variables
 * (`SUPABASE_SECRET_KEY`, falling back to `SUPABASE_SERVICE_ROLE_KEY`) and this
 * module is imported exclusively by Route Handlers / application code. Missing
 * configuration fails closed by returning `null`, which callers map to
 * `ACCOUNT_PROVISIONING_FAILED`; nothing is sent to Supabase in that case.
 */
export type SupabaseAdminCredentials = Readonly<{
  url: string;
  secretKey: string;
}>;

export function readSupabaseAdminCredentials(
  environment: NodeJS.ProcessEnv = process.env,
): SupabaseAdminCredentials | null {
  const url = environment.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const secretKey = (
    environment.SUPABASE_SECRET_KEY ?? environment.SUPABASE_SERVICE_ROLE_KEY
  )?.trim();
  if (!url || !secretKey) return null;
  return { url, secretKey };
}

function isMissingUserError(error: { message?: string; status?: number } | null): boolean {
  if (!error) return false;
  if (error.status === 404) return true;
  return /not found|does not exist/iu.test(error.message ?? "");
}

export function createSupabaseAccountProvisioner(
  environment: NodeJS.ProcessEnv = process.env,
): AccountProvisioner | null {
  const credentials = readSupabaseAdminCredentials(environment);
  if (!credentials) return null;
  const client = createClient(credentials.url, credentials.secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  async function updateBanState(
    userId: string,
    banDuration: string,
  ): Promise<void> {
    const { error } = await client.auth.admin.updateUserById(userId, {
      ban_duration: banDuration,
    });
    if (error) throw new AccountProvisioningError();
  }

  return {
    async createConfirmedUser(input: { email: string }): Promise<CreatedAuthUser> {
      const { data, error } = await client.auth.admin.createUser({
        email: input.email,
        email_confirm: true,
      });
      if (error || !data.user) throw new AccountProvisioningError();
      return { userId: data.user.id };
    },

    async deleteUser(userId: string): Promise<void> {
      const { error } = await client.auth.admin.deleteUser(userId);
      // Deleting a missing Auth user is the desired end state; treat it as
      // success so account deletion stays idempotent and retryable.
      if (error && !isMissingUserError(error)) throw new AccountProvisioningError();
    },

    async banUser(userId: string): Promise<void> {
      // ~100 years: the product uses explicit unban, not a temporary cooldown.
      await updateBanState(userId, "876000h");
    },

    async unbanUser(userId: string): Promise<void> {
      await updateBanState(userId, "none");
    },
  };
}
