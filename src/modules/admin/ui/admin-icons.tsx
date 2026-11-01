/**
 * Inline SVG icon set for the owner console (ADMIN-VISUAL-001).
 *
 * The editorial ops desk deliberately ships zero icon/UI dependencies: every
 * glyph is a 24×24 stroked path in the same visual language as the consumer
 * `NavigationIcon` set (1.75 stroke, round caps, currentColor). Icons are
 * decorative by default (`aria-hidden`); the adjacent text label always carries
 * the meaning, so nothing here is a color-only or icon-only signal.
 */

export type AdminIconName =
  | "overview"
  | "users"
  | "invitations"
  | "ai-usage"
  | "content"
  | "diagnostics"
  | "audit"
  | "workflow"
  | "arrow-left"
  | "arrow-right"
  | "chevron-right"
  | "check"
  | "alert"
  | "copy"
  | "external"
  | "search"
  | "filter"
  | "close"
  | "clock"
  | "shield"
  | "lock"
  | "database"
  | "spark";

type AdminIconProps = Readonly<{
  name: AdminIconName;
  className?: string;
}>;

function paths(name: AdminIconName) {
  switch (name) {
    case "overview":
      return (
        <>
          <rect height="7" rx="1.5" width="7" x="3.5" y="4" />
          <rect height="4.5" rx="1.5" width="7" x="13.5" y="4" />
          <rect height="8" rx="1.5" width="7" x="13.5" y="12" />
          <rect height="5.5" rx="1.5" width="7" x="3.5" y="14.5" />
        </>
      );
    case "users":
      return (
        <>
          <circle cx="9" cy="8" r="3.2" />
          <path d="M3.5 20c.6-3.6 2.7-5.4 5.5-5.4s4.9 1.8 5.5 5.4" />
          <path d="M15.5 5.4a3.2 3.2 0 0 1 0 5.2M17.5 14.8c1.7.6 2.7 2.3 3 5.2" />
        </>
      );
    case "invitations":
      return (
        <>
          <rect height="13" rx="2.5" width="17" x="3.5" y="5.5" />
          <path d="m4.5 7.2 7.5 5.3 7.5-5.3" />
        </>
      );
    case "ai-usage":
      return (
        <>
          <path d="M3.5 12h3.8l2.4-6 4 12 2.4-6h4.4" />
          <path d="M19 4v3M20.5 5.5h-3" />
        </>
      );
    case "content":
      return (
        <>
          <rect height="14" rx="2.5" width="17" x="3.5" y="5" />
          <path d="m10.2 9.4 4.8 2.6-4.8 2.6z" />
        </>
      );
    case "diagnostics":
      return (
        <>
          <path d="M12 3.5 5 6.2v5.3c0 4 2.8 7.4 7 9 4.2-1.6 7-5 7-9V6.2L12 3.5Z" />
          <path d="M8.4 12h2.1l1.2-2.5 1.7 4.2 1.2-1.7h1.9" />
        </>
      );
    case "audit":
      return (
        <>
          <path d="M6 3.5h9.5L19 7v13.5H6z" />
          <path d="M9.5 9h6M9.5 12.5h6M9.5 16h4" />
        </>
      );
    case "workflow":
      return (
        <>
          <circle cx="6" cy="6" r="2.2" />
          <circle cx="18" cy="18" r="2.2" />
          <path d="M6 8.4V13a3 3 0 0 0 3 3h6.6" />
          <path d="m13.6 13.4 2.2 2.6-2.2 2.6" />
        </>
      );
    case "arrow-left":
      return <path d="M19 12H5M11 6l-6 6 6 6" />;
    case "arrow-right":
      return <path d="M5 12h14M13 6l6 6-6 6" />;
    case "chevron-right":
      return <path d="m9.5 6 6 6-6 6" />;
    case "check":
      return <path d="m5 12.5 4.5 4.5L19 7" />;
    case "alert":
      return (
        <>
          <path d="M12 4 21 20H3L12 4Z" />
          <path d="M12 10v4.2M12 17h.01" />
        </>
      );
    case "copy":
      return (
        <>
          <rect height="12" rx="2" width="12" x="8.5" y="8.5" />
          <path d="M15.5 8.5v-3a2 2 0 0 0-2-2h-8a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3" />
        </>
      );
    case "external":
      return (
        <>
          <path d="M14 4h6v6M20 4l-8.5 8.5" />
          <path d="M18 14v5.5H4.5V6H10" />
        </>
      );
    case "search":
      return (
        <>
          <circle cx="10.5" cy="10.5" r="6" />
          <path d="m15 15 4.5 4.5" />
        </>
      );
    case "filter":
      return <path d="M4 6h16M7 12h10M10 18h4" />;
    case "close":
      return <path d="m6 6 12 12M18 6 6 18" />;
    case "clock":
      return (
        <>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 7.5V12l3 2" />
        </>
      );
    case "shield":
      return <path d="M12 3.5 5 6.2v5.3c0 4 2.8 7.4 7 9 4.2-1.6 7-5 7-9V6.2L12 3.5Z" />;
    case "lock":
      return (
        <>
          <rect height="10" rx="2.5" width="14" x="5" y="10.5" />
          <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
        </>
      );
    case "database":
      return (
        <>
          <ellipse cx="12" cy="6" rx="7.5" ry="3" />
          <path d="M4.5 6v12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V6" />
          <path d="M4.5 12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3" />
        </>
      );
    case "spark":
      return (
        <>
          <path d="M12 4.5 13.7 9l4.8 1.7-4.8 1.8L12 17l-1.7-4.5-4.8-1.8L10.3 9 12 4.5Z" />
          <path d="M18.5 15.5v2.8M20 16.9h-3" />
        </>
      );
    default:
      return null;
  }
}

export function AdminIcon({ name, className }: AdminIconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className ? `admin-icon ${className}` : "admin-icon"}
      fill="none"
      height="18"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.75"
      viewBox="0 0 24 24"
      width="18"
    >
      {paths(name)}
    </svg>
  );
}
