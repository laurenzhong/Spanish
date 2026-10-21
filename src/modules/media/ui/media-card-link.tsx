"use client";

import Link, { useLinkStatus } from "next/link";
import { useRouter } from "next/navigation";
import type { PrefetchKind } from "next/dist/client/components/router-reducer/router-reducer-types";
import { useEffect, useRef, type ReactNode } from "react";

/**
 * How long a pointer has to rest on a card before the destination route is
 * warmed. A horizontal sweep across the grid never reaches the delay, so it
 * cannot fire one prefetch per card; the card the pointer stops on does.
 */
const INTENT_DELAY_MS = 100;

/**
 * The app router context is absent while a client component is server-rendered
 * and in unit tests. `next/link` already tolerates a missing router; the
 * optional warm-up below does the same instead of failing the whole card.
 */
function useOptionalRouter(): ReturnType<typeof useRouter> | null {
  try {
    return useRouter();
  } catch {
    return null;
  }
}

function MediaCardPending() {
  const { pending } = useLinkStatus();
  return (
    <>
      <span aria-hidden="true" className="media-card__pending" data-pending={pending ? "true" : undefined} />
      {/* An inline live region, not a `role="status"`, so a grid of cards does
          not add many extra status landmarks to the page. */}
      <span aria-live="polite" className="sr-only">{pending ? "正在打开…" : ""}</span>
    </>
  );
}

export type MediaCardLinkProps = Readonly<{
  href: string;
  className?: string;
  children: ReactNode;
}>;

/**
 * Card entry link with intent prefetching.
 *
 * `Link` keeps its default (prefetch on viewport in production) behaviour; this
 * wrapper only adds an earlier, explicit warm-up when the user shows intent
 * (hover, focus, touch), because the dev server disables Next's automatic
 * prefetching and a click before the destination route is warm would otherwise
 * render the `/learn` route fallback.
 *
 * `router.prefetch(href)` uses the default `auto` strategy: it warms the route
 * up to the destination loading boundary, not the dynamic page data. A `full`
 * prefetch would cache per-user progress under the static stale window, which
 * is exactly the kind of stale data we do not want on a media card.
 */
export function MediaCardLink({ href, className, children }: MediaCardLinkProps) {
  const router = useOptionalRouter();
  const warmedHref = useRef<string | null>(null);
  const intentTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // A new href (list refresh, recycled card) starts with a clean slate.
    warmedHref.current = null;
    return () => {
      if (intentTimer.current !== null) {
        clearTimeout(intentTimer.current);
        intentTimer.current = null;
      }
    };
  }, [href]);

  const cancelIntent = () => {
    if (intentTimer.current !== null) {
      clearTimeout(intentTimer.current);
      intentTimer.current = null;
    }
  };

  const warm = () => {
    cancelIntent();
    if (!router || warmedHref.current === href) return;
    warmedHref.current = href;
    // `kind: "auto"` is the documented default; it is stated explicitly so a
    // future refactor cannot silently upgrade cards to a full prefetch.
    router.prefetch(href, {
      kind: "auto" as PrefetchKind,
      onInvalidate: () => {
        // The cached entry went stale; let the next intent warm it again.
        if (warmedHref.current === href) warmedHref.current = null;
      },
    });
  };

  const scheduleIntent = () => {
    cancelIntent();
    if (!router || warmedHref.current === href) return;
    intentTimer.current = setTimeout(() => {
      intentTimer.current = null;
      warm();
    }, INTENT_DELAY_MS);
  };

  return (
    <Link
      className={className}
      href={href}
      onFocus={warm}
      onPointerEnter={scheduleIntent}
      onPointerLeave={cancelIntent}
      onTouchStart={warm}
    >
      {children}
      <MediaCardPending />
    </Link>
  );
}
