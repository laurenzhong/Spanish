import { z } from "zod";

export const readlangLinksPolicySchema = z.object({
  policyVersion: z.string().trim().min(1).max(120),
  sourceUrl: z.url().startsWith("https://"),
  authorization: z.object({
    status: z.literal("owner-authorized"),
    evidenceUrl: z.url().startsWith("https://"),
  }).passthrough(),
  allowlist: z.object({
    hosts: z.array(z.string().trim().min(1).max(255)).min(1).max(200),
    urls: z.array(z.url().startsWith("https://")).min(1).max(500),
    urlPrefixes: z.array(z.url().startsWith("https://")).min(1).max(500),
  }).passthrough(),
  contentMode: z.literal("full_text"),
  license: z.enum(["licensed", "original", "public_domain", "creative_commons", "owner-authorized"]),
  attribution: z.string().trim().min(1).max(1_000),
  automatedPublication: z.object({
    enabled: z.boolean(),
    policyVersion: z.string().trim().min(1).max(120),
    dailyLimit: z.number().int().positive().max(50),
  }).passthrough(),
}).passthrough();

export type ReadlangLinksPolicy = z.infer<typeof readlangLinksPolicySchema>;

export function isReadlangAllowlistedUrl(value: string, policy: ReadlangLinksPolicy): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  if (!policy.allowlist.hosts.some((allowed) => allowed.toLowerCase() === host)) return false;
  if (host === "readlang.com") {
    return policy.allowlist.urlPrefixes.some((prefix) => {
      const normalizedPrefix = prefix.endsWith("/") ? prefix : `${prefix}/`;
      return value === prefix || value.startsWith(normalizedPrefix);
    });
  }
  return policy.allowlist.urls.some((allowed) => {
    const allowedUrl = new URL(allowed);
    return allowedUrl.origin === url.origin
      && allowedUrl.pathname === url.pathname
      && allowedUrl.search === url.search;
  });
}

export function normalizeReadlangLink(value: string, policy: ReadlangLinksPolicy): string | null {
  if (!isReadlangAllowlistedUrl(value, policy)) return null;
  const url = new URL(value);
  url.hash = "";
  return url.toString();
}
