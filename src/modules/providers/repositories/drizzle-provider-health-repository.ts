import { sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import * as schema from "@/src/shared/db/schema";
import { providerCapabilities, type ProviderCapability } from "../routing/provider-registry";
import type { ProviderHealthRepository } from "./provider-health-repository";

type ProviderDatabase<TResult extends PgQueryResultHKT> = PgDatabase<TResult, typeof schema>;
const capabilitySet = new Set<string>(providerCapabilities);

export function createDrizzleProviderHealthRepository<TResult extends PgQueryResultHKT>(
  database: ProviderDatabase<TResult>,
): ProviderHealthRepository {
  return {
    async listObservationSummaries() {
      const rows = await database
        .select({
          capability: schema.providerCalls.providerType,
          providerKey: schema.providerCalls.provider,
          lastSuccessAt: sql<Date | null>`max(${schema.providerCalls.completedAt}) filter (where ${schema.providerCalls.status} = 'succeeded')`,
          lastFailureAt: sql<Date | null>`max(${schema.providerCalls.completedAt}) filter (where ${schema.providerCalls.status} = 'failed')`,
        })
        .from(schema.providerCalls)
        .groupBy(schema.providerCalls.providerType, schema.providerCalls.provider);
      return rows.flatMap((row) => capabilitySet.has(row.capability)
        ? [{
            capability: row.capability as ProviderCapability,
            providerKey: row.providerKey,
            lastSuccessAt: toDate(row.lastSuccessAt),
            lastFailureAt: toDate(row.lastFailureAt),
          }]
        : []);
    },
  };
}

function toDate(value: Date | string | null): Date | null {
  if (!value) return null;
  return value instanceof Date ? value : new Date(value);
}
