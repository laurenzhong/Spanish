import { NextResponse } from "next/server";

import {
  API_VERSION,
  type PageInfo,
} from "@/src/shared/contracts/v1/api-contract";

/**
 * Cursor-list success envelope for `/api/v1/admin/*`.
 *
 * Mirrors the existing versioned success envelope (`apiVersion` + `data`) and
 * adds the shared `page: { nextCursor, hasMore }` block required by every admin
 * list (design §5.4), with the same private/no-store caching contract as
 * `adminSuccess`.
 */
export function adminPageSuccess(
  data: unknown,
  page: PageInfo,
  requestId: string,
  status = 200,
): NextResponse {
  return NextResponse.json(
    { apiVersion: API_VERSION, data, page },
    {
      status,
      headers: {
        "cache-control": "private, no-store",
        "x-request-id": requestId,
      },
    },
  );
}
