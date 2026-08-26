"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { ThemeToggle } from "./theme-toggle";

export function AccountMenu() {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="account-menu" ref={menuRef}>
      <button
        className="account-menu__trigger"
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="打开账户菜单"
        onClick={() => setOpen((current) => !current)}
      >
        <span className="account-avatar" aria-hidden="true">你</span>
      </button>
      {open ? (
        <div className="account-menu__popover" role="menu" aria-label="账户菜单">
          <div className="account-menu__identity">
            <span className="eyebrow">当前账户</span>
            <strong>我的 Sueño</strong>
          </div>
          <Link href="/me" role="menuitem" onClick={() => setOpen(false)}>
            我的进步与隐私
          </Link>
          <ThemeToggle />
        </div>
      ) : null}
    </div>
  );
}
