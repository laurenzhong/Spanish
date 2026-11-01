"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { AdminIcon, type AdminIconName } from "./admin-icons";

export type AdminNavigationGroup = "概览" | "账号" | "内容" | "系统";

export type AdminNavigationItem = Readonly<{
  href: string;
  label: string;
  /** Detail pages keep their section current even though the href differs. */
  matchPrefix: string;
  group: AdminNavigationGroup;
  icon: AdminIconName;
  /**
   * A neighbouring owner tool hosted outside `/admin` (the candidate review
   * workflow). It is deliberately marked so the ops desk never pretends the
   * owner is still inside the regulatory console.
   */
  external?: boolean;
}>;

export const ADMIN_NAVIGATION_GROUPS: readonly AdminNavigationGroup[] = [
  "概览",
  "账号",
  "内容",
  "系统",
];

export const ADMIN_NAVIGATION_ITEMS: readonly AdminNavigationItem[] = [
  { href: "/admin", label: "总览", matchPrefix: "/admin", group: "概览", icon: "overview" },
  { href: "/admin/users", label: "用户", matchPrefix: "/admin/users", group: "账号", icon: "users" },
  {
    href: "/admin/invitations",
    label: "邀请",
    matchPrefix: "/admin/invitations",
    group: "账号",
    icon: "invitations",
  },
  {
    href: "/admin/content",
    label: "内容与采集",
    matchPrefix: "/admin/content",
    group: "内容",
    icon: "content",
  },
  {
    href: "/me/content-workflow",
    label: "内容工作流",
    matchPrefix: "/me/content-workflow",
    group: "内容",
    icon: "workflow",
    external: true,
  },
  {
    href: "/admin/ai-usage",
    label: "AI 用量",
    matchPrefix: "/admin/ai-usage",
    group: "系统",
    icon: "ai-usage",
  },
  {
    href: "/admin/diagnostics",
    label: "诊断",
    matchPrefix: "/admin/diagnostics",
    group: "系统",
    icon: "diagnostics",
  },
  {
    href: "/admin/audit",
    label: "审计",
    matchPrefix: "/admin/audit",
    group: "系统",
    icon: "audit",
  },
];

function isCurrentPath(pathname: string, item: AdminNavigationItem): boolean {
  if (item.href === "/admin") return pathname === "/admin";
  return pathname === item.href || pathname.startsWith(`${item.matchPrefix}/`);
}

/** The section a pathname belongs to; used for breadcrumbs and the topbar. */
export function findAdminSection(
  pathname: string,
): AdminNavigationItem | null {
  return ADMIN_NAVIGATION_ITEMS.find((item) => isCurrentPath(pathname, item)) ?? null;
}

/**
 * Section navigation for the owner console, rendered inside the admin shell.
 *
 * The nav keeps the E2E/unit-test contract: `nav[aria-label="监管后台分区"]`,
 * the section link names, and `aria-current="page"` on the active section. On
 * desktop it is a grouped sidebar; below 1100px the same markup becomes the
 * sticky horizontal navigation (the group labels are hidden visually only).
 *
 * `/admin` is still absent from the product navigation (ADR-0021 §6): the only
 * consumer entry is the owner tools card on `/me`.
 */
export function AdminSubnav() {
  const pathname = usePathname() ?? "/admin";
  return (
    <nav aria-label="监管后台分区" className="admin-nav">
      {ADMIN_NAVIGATION_GROUPS.map((group) => (
        <div className="admin-nav__group" key={group}>
          <p className="admin-nav__group-label">{group}</p>
          <ul className="admin-nav__list">
            {ADMIN_NAVIGATION_ITEMS.filter((item) => item.group === group).map(
              (item) => {
                const current = isCurrentPath(pathname, item);
                return (
                  <li className="admin-nav__item" key={item.href}>
                    <Link
                      aria-current={current ? "page" : undefined}
                      className={
                        current ? "admin-nav__link is-current" : "admin-nav__link"
                      }
                      href={item.href}
                    >
                      <AdminIcon className="admin-nav__icon" name={item.icon} />
                      <span className="admin-nav__label">{item.label}</span>
                      {item.external ? (
                        <AdminIcon
                          className="admin-nav__external"
                          name="external"
                        />
                      ) : null}
                    </Link>
                  </li>
                );
              },
            )}
          </ul>
        </div>
      ))}
    </nav>
  );
}
