"use client";

import { createBrowserClient } from "@supabase/ssr";

import { readSupabasePublicConfig } from "./config";

export function createSupabaseBrowserClient() {
  const config = readSupabasePublicConfig();
  if (!config) {
    return null;
  }

  return createBrowserClient(config.url, config.publishableKey);
}
