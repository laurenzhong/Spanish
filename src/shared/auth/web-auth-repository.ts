"use client";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createSupabaseBrowserClient } from "./browser";

export interface WebAuthRepository {
  requestEmailOtp(email: string): Promise<void>;
  signInWithPassword(email: string, password: string): Promise<void>;
  verifyEmailOtp(email: string, token: string): Promise<void>;
}

export function normalizeEmailAddress(email: string) {
  return email.trim().toLowerCase();
}

export class SupabaseWebAuthRepository implements WebAuthRepository {
  constructor(private readonly client: SupabaseClient) {}

  async requestEmailOtp(email: string) {
    const { error } = await this.client.auth.signInWithOtp({
      email: normalizeEmailAddress(email),
      // Free registration (ADR-0022): an unknown email creates a Supabase Auth
      // user on the first OTP request. The database trigger provisions the
      // profile/preferences as `member/active`; owner-created invitations remain
      // an optional pre-provisioning channel rather than a login requirement.
      options: { shouldCreateUser: true },
    });
    if (error) throw error;
  }

  async verifyEmailOtp(email: string, token: string) {
    const { error } = await this.client.auth.verifyOtp({
      email: normalizeEmailAddress(email),
      token,
      type: "email",
    });
    if (error) throw error;
  }

  async signInWithPassword(email: string, password: string) {
    const { error } = await this.client.auth.signInWithPassword({
      email,
      password,
    });
    if (error) throw error;
  }
}

export function createWebAuthRepository(): WebAuthRepository | null {
  const client = createSupabaseBrowserClient();
  return client ? new SupabaseWebAuthRepository(client) : null;
}
