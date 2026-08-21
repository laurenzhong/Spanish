import { z } from "zod";

export const stableKeySchema = z
  .string()
  .trim()
  .min(3)
  .max(160)
  .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u);

export const localeSchema = z
  .string()
  .trim()
  .regex(/^[a-z]{2,3}(?:-[A-Z]{2})?$/u);

export const localizedTextSchema = z
  .record(localeSchema, z.string().trim().min(1).max(4_000))
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one localized value is required.",
  });

export const contentStatusSchema = z.enum([
  "draft",
  "review",
  "approved",
  "published",
  "archived",
]);

export const reviewStatusSchema = z.enum([
  "pending",
  "approved",
  "changes_requested",
]);

export const cefrLevelSchema = z.enum(["A1", "A2", "B1", "B2", "C1", "C2"]);

export const sourceLicenseSchema = z.enum([
  "original",
  "public_domain",
  "creative_commons",
  "licensed",
  "short_quote",
]);

export const copyrightStatusSchema = z.enum([
  "unverified",
  "cleared",
  "restricted",
]);

export const positiveVersionSchema = z.number().int().positive();
export const positionSchema = z.number().int().nonnegative();
export const dateTimeSchema = z.iso.datetime({ offset: true });

export const jsonObjectSchema = z.record(z.string(), z.json());
