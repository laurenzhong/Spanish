/**
 * Shared server-rendered page states for the owner console
 * (ACCT-ADMIN-001 slice U1, restyled by ADMIN-VISUAL-001).
 *
 * These never render data and never claim success: the console is a read model,
 * so an unconfigured/unavailable database or a stale filter link always produces
 * an explicit state with a recovery path. The layout keeps the shell (sidebar,
 * context bar) visible so the owner can navigate elsewhere without a full page
 * of dead end.
 */

import { AdminIcon } from "./admin-icons";

type AdminUnavailableProps = Readonly<{
  /** Extra sentence explaining what was *not* read or changed. */
  detail?: string;
  /** Non-JS retry link (a full navigation bypasses the RSC client cache). */
  retryHref: string;
}>;

export function AdminUnavailable({ detail, retryHref }: AdminUnavailableProps) {
  return (
    <div className="admin-page admin-page--narrow">
      <section
        aria-labelledby="admin-unavailable-title"
        className="admin-state admin-state--warning"
        role="status"
      >
        <span aria-hidden="true" className="admin-state__icon">
          <AdminIcon name="alert" />
        </span>
        <div className="admin-state__copy">
          <p className="admin-kicker">读取失败</p>
          <h1 className="admin-state__title" id="admin-unavailable-title">
            监管数据暂时不可用
          </h1>
          <p className="admin-state__description">
            {detail ??
              "数据库未配置或查询暂时失败，本页没有读取到任何监管数据，也没有执行任何写操作。"}
          </p>
          <p className="admin-state__note">
            监管计数只反映运营状态，不是学习能力事实；学习证据与评分不会因此改变。
          </p>
          <div className="admin-state__actions">
            <a className="admin-button admin-button--primary" href={retryHref}>
              重新读取
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}

type AdminFilterInvalidProps = Readonly<{
  detail?: string;
  /** Link that drops the stale search params (usually the bare page path). */
  resetHref: string;
}>;

export function AdminFilterInvalid({ detail, resetHref }: AdminFilterInvalidProps) {
  return (
    <div className="admin-page admin-page--narrow">
      <section
        aria-labelledby="admin-filter-invalid-title"
        className="admin-state admin-state--warning"
        role="status"
      >
        <span aria-hidden="true" className="admin-state__icon">
          <AdminIcon name="filter" />
        </span>
        <div className="admin-state__copy">
          <p className="admin-kicker">筛选条件</p>
          <h1 className="admin-state__title" id="admin-filter-invalid-title">
            筛选条件无效
          </h1>
          <p className="admin-state__description">
            {detail ??
              "当前 URL 里的筛选或分页参数已失效，为了避免展示不完整的数据，本页没有发起查询。"}
          </p>
          <div className="admin-state__actions">
            <a className="admin-button admin-button--primary" href={resetHref}>
              清除筛选并重新读取
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}

/**
 * Section-shaped loading placeholder used by the admin `loading.tsx` files.
 * The skeleton mirrors real table/panel geometry (not a spinner) so the layout
 * does not jump when the server data arrives.
 */
export function AdminPageLoading() {
  return (
    <div aria-live="polite" className="admin-page" role="status">
      <h1 className="admin-sr-only">正在读取监管数据</h1>
      <span className="admin-sr-only">正在读取监管数据…</span>
      <div aria-hidden="true" className="admin-skeleton">
        <div className="admin-skeleton__header">
          <span className="admin-skeleton__line admin-skeleton__line--kicker" />
          <span className="admin-skeleton__line admin-skeleton__line--title" />
          <span className="admin-skeleton__line admin-skeleton__line--description" />
        </div>
        <div className="admin-skeleton__panel">
          <span className="admin-skeleton__line admin-skeleton__line--panel-title" />
          {[0, 1, 2, 3, 4].map((row) => (
            <span className="admin-skeleton__row" key={row} />
          ))}
        </div>
      </div>
    </div>
  );
}
