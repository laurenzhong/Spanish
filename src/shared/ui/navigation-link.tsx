"use client";

import Link, { useLinkStatus, type LinkProps } from "next/link";
import type { AnchorHTMLAttributes, MouseEventHandler, ReactNode } from "react";

type NavigationLinkProps = LinkProps & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "onClick" | "children"> & Readonly<{
  children: ReactNode;
  className?: string;
  onClick?: MouseEventHandler<HTMLAnchorElement>;
}>;

function LinkPendingIndicator() {
  const { pending } = useLinkStatus();
  return <span className="navigation-link__pending-indicator" data-pending={pending ? "true" : undefined} aria-hidden="true" />;
}

/**
 * Keeps the existing client-side transition while exposing Next's precise
 * pending state. The indicator is intentionally nested in Link because
 * useLinkStatus reads the status of its nearest Link boundary.
 */
export function NavigationLink({ children, className, ...props }: NavigationLinkProps) {
  return (
    <Link className={className} {...props}>
      {children}
      <LinkPendingIndicator />
    </Link>
  );
}
