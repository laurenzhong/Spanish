"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { ThemeToggle } from "@/src/shared/ui/theme-toggle";
import { AdminIcon } from "./admin-icons";
import { AdminSubnav, findAdminSection } from "./admin-subnav";

type AdminShellProps = Readonly<{
  children: ReactNode;
}>;

/**
 * Full-screen owner workspace shell for `/admin/**` (ADMIN-VISUAL-001).
 *
 * The console left the consumer `(product)` route group on purpose: an internal
 * operations desk is not a product page. This shell owns the whole viewport with
 * a deep-ink sidebar, a warm-paper canvas and a thin context bar.
 *
 * Hierarchy contract: the page's own title is the single `h1`
 * (`AdminPageHeader` / state panels); the brand lockup uses plain text and panel
 * titles are `h2`. The context bar is breadcrumb-only.
 *
 * Below 1100px the same markup becomes the sticky horizontal section nav plus a
 * compact context bar; below 760px everything collapses to one column.
 */
export function AdminShell({ children }: AdminShellProps) {
  const pathname = usePathname() ?? "/admin";
  const section = findAdminSection(pathname);
  const sectionLabel = section?.label ?? "总览";

  return (
    <div className="admin-shell">
      <a className="skip-link admin-shell__skip" href="#admin-main">
        跳到主要内容
      </a>

      <aside className="admin-sidebar">
        <div className="admin-sidebar__brandrow">
          <Link className="admin-brand" href="/admin" aria-label="Sueño Ops 监管后台首页">
            <span aria-hidden="true" className="admin-brand__mark">
              S<span>ñ</span>o
            </span>
            <span className="admin-brand__text">
              <span className="admin-brand__wordmark">
                Sueño <span className="admin-brand__tag">Ops</span>
              </span>
              <p className="admin-brand__title">监管后台</p>
            </span>
          </Link>
          <span className="admin-owner-chip">
            <span aria-hidden="true" className="admin-owner-chip__dot" />
            仅所有者
          </span>
        </div>

        <AdminSubnav />

        <div className="admin-sidebar__footer">
          <Link className="admin-sidebar__return" href="/learn">
            <AdminIcon name="arrow-left" />
            返回学习
          </Link>
          <div className="admin-sidebar__theme">
            <ThemeToggle />
          </div>
        </div>
      </aside>

      <div className="admin-canvas">
        <header className="admin-topbar">
          <div
            aria-label="当前位置"
            className="admin-topbar__context"
            role="group"
          >
            <p className="admin-topbar__kicker">Sueño Ops · 编辑式运营工作台</p>
            <div className="admin-topbar__breadcrumb">
              <Link className="admin-topbar__crumb" href="/admin">
                监管后台
              </Link>
              <AdminIcon className="admin-topbar__chevron" name="chevron-right" />
              <p className="admin-topbar__section">{sectionLabel}</p>
            </div>
          </div>

          <div className="admin-topbar__actions">
            <span className="admin-topbar__readonly">
              <AdminIcon name="shield" />
              所有者运营视图 · 写操作记入审计
            </span>
            <div className="admin-topbar__mobile">
              <Link className="admin-topbar__return" href="/learn">
                <AdminIcon name="arrow-left" />
                返回学习
              </Link>
              <ThemeToggle compact />
            </div>
          </div>
        </header>

        <main className="admin-main" id="admin-main">
          {children}
        </main>

        <footer className="admin-footer">
          <p>Sueño Ops · 仅项目所有者使用</p>
          <p>
            这里的计数、时长与成本是运营指标，不是学习能力事实；页面不读取聊天正文、录音、转写或关系记忆。
          </p>
        </footer>
      </div>
    </div>
  );
}
