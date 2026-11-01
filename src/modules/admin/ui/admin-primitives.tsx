/**
 * Shared presentational primitives for the owner console (ADMIN-VISUAL-001).
 *
 * These are deliberately dumb: no state, no effects, no data access. Server
 * pages and client panels both compose them so the "Editorial Ops Desk" panels,
 * metric grids, segmented controls, badges and CSS charts stay one visual
 * system instead of one-off markup per page.
 */

import Link from "next/link";
import type { ReactNode } from "react";

import { AdminIcon, type AdminIconName } from "./admin-icons";

export type AdminTone = "neutral" | "positive" | "warning" | "danger" | "info" | "accent";

/* -------------------------------------------------------------------------- */
/* Page header + panels                                                       */
/* -------------------------------------------------------------------------- */

type AdminPageHeaderProps = Readonly<{
  kicker: string;
  title: string;
  description?: ReactNode;
  /** Context badge / window control rendered on the right of the header. */
  aside?: ReactNode;
}>;

export function AdminPageHeader({
  kicker,
  title,
  description,
  aside,
}: AdminPageHeaderProps) {
  return (
    <header className="admin-page__header">
      <div className="admin-page__intro">
        <p className="admin-kicker">{kicker}</p>
        <h1 className="admin-page__title">{title}</h1>
        {description ? <p className="admin-page__description">{description}</p> : null}
      </div>
      {aside ? <div className="admin-page__aside">{aside}</div> : null}
    </header>
  );
}

type AdminPanelProps = Readonly<{
  /** DOM id base; the heading receives `${id}-title`. Required for a11y. */
  id: string;
  title: string;
  kicker?: string;
  description?: ReactNode;
  /** Badge / meta rendered next to the panel title. */
  aside?: ReactNode;
  /** Buttons or links rendered under the panel header (inside the body top). */
  actions?: ReactNode;
  tone?: "default" | "danger";
  /** The single primary panel of a page (accent edge, larger rhythm). */
  hero?: boolean;
  /** Table-led panel: removes the body padding and the nested card edge. */
  flush?: boolean;
  className?: string;
  children: ReactNode;
}>;

export function AdminPanel({
  id,
  title,
  kicker,
  description,
  aside,
  actions,
  tone = "default",
  hero = false,
  flush = false,
  className,
  children,
}: AdminPanelProps) {
  return (
    <section
      aria-labelledby={`${id}-title`}
      className={`admin-panel${tone === "danger" ? " admin-panel--danger" : ""}${
        hero ? " admin-panel--hero" : ""
      }${flush ? " admin-panel--flush" : ""}${className ? ` ${className}` : ""}`}
      id={id}
    >
      <header className="admin-panel__header">
        <div className="admin-panel__heading">
          {kicker ? <p className="admin-kicker">{kicker}</p> : null}
          <h2 className="admin-panel__title" id={`${id}-title`}>
            {title}
          </h2>
          {description ? (
            <p className="admin-panel__description">{description}</p>
          ) : null}
        </div>
        {aside ? <div className="admin-panel__aside">{aside}</div> : null}
      </header>
      <div className="admin-panel__body">
        {actions ? <div className="admin-panel__actions">{actions}</div> : null}
        {children}
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Badges, status and metric grid                                             */
/* -------------------------------------------------------------------------- */

type AdminBadgeProps = Readonly<{
  tone?: AdminTone;
  dot?: boolean;
  children: ReactNode;
  className?: string;
}>;

export function AdminBadge({
  tone = "neutral",
  dot = false,
  children,
  className,
}: AdminBadgeProps) {
  return (
    <span
      className={`admin-badge admin-badge--${tone}${className ? ` ${className}` : ""}`}
    >
      {dot ? <span aria-hidden="true" className="admin-badge__dot" /> : null}
      {children}
    </span>
  );
}

type AdminMetricProps = Readonly<{
  label: string;
  value: string;
  hint?: ReactNode;
  tone?: "default" | "warning" | "danger" | "positive";
  /** Value expressed as a micro label instead of a large number. */
  compact?: boolean;
}>;

export function AdminMetricGrid({ children }: Readonly<{ children: ReactNode }>) {
  return <div className="admin-metrics">{children}</div>;
}

/**
 * The one "hero" metric of a metric area (36–46px). Every other metric on the
 * page is secondary. The hint/scope sit directly under the number (never pushed
 * to the far edge of a wide panel) so a big number is never read without its
 * window/unit.
 */
export function AdminKpiHero({
  label,
  value,
  hint,
  scope,
}: Readonly<{
  label: string;
  value: string;
  hint?: ReactNode;
  scope?: ReactNode;
}>) {
  return (
    <div className="admin-kpi-hero">
      <span className="admin-kpi-hero__label">{label}</span>
      <strong className="admin-kpi-hero__value">{value}</strong>
      {hint || scope ? (
        <div className="admin-kpi-hero__meta">
          {hint ? <span className="admin-kpi-hero__hint">{hint}</span> : null}
          {scope ? <span className="admin-kpi-hero__scope">{scope}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

export function AdminMetric({
  label,
  value,
  hint,
  tone = "default",
  compact = false,
}: AdminMetricProps) {
  return (
    <div className="admin-metric" data-tone={tone}>
      <span className="admin-metric__label">{label}</span>
      <strong
        className={
          compact ? "admin-metric__value admin-metric__value--compact" : "admin-metric__value"
        }
      >
        {value}
      </strong>
      {hint ? <span className="admin-metric__hint">{hint}</span> : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Segmented window control + filter chips                                    */
/* -------------------------------------------------------------------------- */

export type AdminSegmentedItem = Readonly<{
  label: string;
  href: string;
  current: boolean;
}>;

/**
 * Time-window / range control. Visually distinct from the section navigation
 * (outlined segmented control with a deep-ink active segment). The active link
 * keeps `aria-current="true"`, matching the pre-redesign contract.
 */
export function AdminSegmented({
  label,
  items,
}: Readonly<{ label: string; items: readonly AdminSegmentedItem[] }>) {
  return (
    <nav aria-label={label} className="admin-segmented">
      {items.map((item) => (
        <Link
          aria-current={item.current ? "true" : undefined}
          className={
            item.current
              ? "admin-segmented__item is-current"
              : "admin-segmented__item"
          }
          href={item.href}
          key={item.label}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

export type AdminFilterChip = Readonly<{
  label: string;
  /** Link that drops just this filter; omit for read-only applied state. */
  removeHref?: string;
}>;

/** "已应用筛选" summary with per-chip remove links and one clear-all action. */
export function AdminFilterChips({
  items,
  clearHref,
  clearLabel = "清除",
}: Readonly<{
  items: readonly AdminFilterChip[];
  clearHref?: string;
  clearLabel?: string;
}>) {
  if (items.length === 0) return null;
  return (
    <div className="admin-chips">
      <span className="admin-chips__label">已应用筛选</span>
      <ul className="admin-chips__list">
        {items.map((chip) => (
          <li key={chip.label}>
            {chip.removeHref ? (
              <Link className="admin-chip" href={chip.removeHref}>
                {chip.label}
                <AdminIcon className="admin-chip__x" name="close" />
                <span className="admin-sr-only">清除此筛选</span>
              </Link>
            ) : (
              <span className="admin-chip">{chip.label}</span>
            )}
          </li>
        ))}
      </ul>
      {clearHref ? (
        <a className="admin-chips__clear" href={clearHref}>
          {clearLabel}
        </a>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Bars (CSS only, no chart library)                                          */
/* -------------------------------------------------------------------------- */

export type AdminBarRow = Readonly<{
  label: string;
  value: string;
  /** 0–100; never the only encoding of the value (the text stays visible). */
  percent: number;
  tone?: "accent" | "info" | "success" | "warning" | "danger";
  hint?: string;
}>;

export function AdminBarList({
  label,
  rows,
  caption,
}: Readonly<{ label: string; rows: readonly AdminBarRow[]; caption?: string }>) {
  return (
    <div className="admin-bars">
      <div aria-label={label} className="admin-bars__rows" role="list">
        {rows.map((row) => (
          <div className="admin-bar" key={row.label} role="listitem">
            <div className="admin-bar__head">
              <span className="admin-bar__label">{row.label}</span>
              <span className="admin-bar__value">{row.value}</span>
            </div>
            <div aria-hidden="true" className="admin-bar__track">
              <span
                className="admin-bar__fill"
                data-tone={row.tone ?? "info"}
                style={{ width: `${Math.max(0, Math.min(100, row.percent))}%` }}
              />
            </div>
            {row.hint ? <span className="admin-bar__hint">{row.hint}</span> : null}
          </div>
        ))}
      </div>
      {caption ? <p className="admin-bars__caption">{caption}</p> : null}
    </div>
  );
}

export type AdminBarColumn = Readonly<{
  label: string;
  value: string;
  percent: number;
  /** Secondary visible note, e.g. the failed calls of that day. */
  note?: string;
  ariaLabel?: string;
}>;

/** Compact per-day CSS column chart; every column keeps a readable value+date. */
export function AdminBarChart({
  label,
  columns,
  caption,
}: Readonly<{
  label: string;
  columns: readonly AdminBarColumn[];
  caption?: string;
}>) {
  return (
    <figure className="admin-chart">
      <div aria-label={label} className="admin-chart__plot" role="list">
        {columns.map((column) => {
          const percent = Math.max(0, Math.min(100, column.percent));
          return (
            <div
              aria-label={column.ariaLabel ?? `${column.label}：${column.value}`}
              className="admin-chart__col"
              key={column.label}
              role="listitem"
            >
              <span aria-hidden="true" className="admin-chart__track">
                <span className="admin-chart__value" style={{ bottom: `${percent}%` }}>
                  {column.value}
                </span>
                {percent > 0 ? (
                  <span className="admin-chart__bar" style={{ height: `${percent}%` }} />
                ) : (
                  <span className="admin-chart__bar admin-chart__bar--empty" />
                )}
              </span>
              <span className="admin-chart__label">{column.label}</span>
              {column.note ? <span className="admin-chart__note">{column.note}</span> : null}
            </div>
          );
        })}
      </div>
      {caption ? <figcaption className="admin-chart__caption">{caption}</figcaption> : null}
    </figure>
  );
}

/* -------------------------------------------------------------------------- */
/* Empty / info states                                                        */
/* -------------------------------------------------------------------------- */

type AdminEmptyProps = Readonly<{
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  icon?: AdminIconName;
  tone?: "neutral" | "warning";
}>;

export function AdminEmpty({
  title,
  description,
  action,
  icon = "database",
  tone = "neutral",
}: AdminEmptyProps) {
  return (
    <div className="admin-empty" data-tone={tone}>
      <span aria-hidden="true" className="admin-empty__icon">
        <AdminIcon name={icon} />
      </span>
      <div className="admin-empty__copy">
        <p className="admin-empty__title">{title}</p>
        {description ? (
          <p className="admin-empty__description">{description}</p>
        ) : null}
        {action ? <div className="admin-empty__action">{action}</div> : null}
      </div>
    </div>
  );
}

/** Dense key/value list used for identity and health facts. */
export function AdminDefinitionList({
  items,
}: Readonly<{ items: readonly Readonly<{ term: string; value: ReactNode }>[] }>) {
  return (
    <dl className="admin-kv">
      {items.map((item) => (
        <div key={item.term}>
          <dt>{item.term}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Caption + data table wrapper with a density switch and optional tall scroll. */
export function AdminTable({
  caption,
  head,
  children,
  density = "default",
  tall = false,
}: Readonly<{
  caption: string;
  head: ReactNode;
  children: ReactNode;
  density?: "default" | "compact";
  /** Long log tables get their own vertical scroll so the header can be sticky. */
  tall?: boolean;
}>) {
  return (
    <div className={tall ? "admin-table-wrap admin-table-wrap--tall" : "admin-table-wrap"}>
      <table
        className={
          density === "compact"
            ? "admin-table admin-table--compact"
            : "admin-table"
        }
        data-density={density}
      >
        <caption className="admin-sr-only">{caption}</caption>
        <thead>{head}</thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Small inline pieces                                                        */
/* -------------------------------------------------------------------------- */

/** Monospace, copy-friendly identifier. */
export function AdminCode({ children }: Readonly<{ children: ReactNode }>) {
  return <code className="admin-code">{children}</code>;
}

/** Inline note / callout used for cost caveats and safety copy. */
export function AdminNote({
  children,
  tone = "neutral",
}: Readonly<{ children: ReactNode; tone?: "neutral" | "warning" | "accent" }>) {
  return (
    <p className="admin-note" data-tone={tone}>
      {children}
    </p>
  );
}

/** Masked email / provider / error-type code. */
export function AdminMono({ children }: Readonly<{ children: ReactNode }>) {
  return <span className="admin-mono">{children}</span>;
}
