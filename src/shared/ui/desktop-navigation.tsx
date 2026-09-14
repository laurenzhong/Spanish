"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { AccountMenu } from "./account-menu";
import { NavigationIcon, navigationGroups } from "./bottom-navigation";

const NAVIGATION_STORAGE_KEY = "sueno-desktop-navigation-v1";
type NavigationState = "expanded" | "collapsed";

function readStoredState(): NavigationState | null {
  try {
    const value = window.localStorage.getItem(NAVIGATION_STORAGE_KEY);
    return value === "expanded" || value === "collapsed" ? value : null;
  } catch {
    return null;
  }
}

function defaultState(): NavigationState {
  return window.matchMedia("(min-width: 1280px)").matches ? "expanded" : "collapsed";
}

export function DesktopNavigation() {
  const pathname = usePathname();
  const [state, setState] = useState<NavigationState>("expanded");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setState(readStoredState() ?? defaultState());
    setReady(true);
  }, []);

  function toggle() {
    const next = state === "expanded" ? "collapsed" : "expanded";
    setState(next);
    try {
      window.localStorage.setItem(NAVIGATION_STORAGE_KEY, next);
    } catch {
      // Private browsing can deny storage; the current selection still applies.
    }
  }

  return (
    <nav
      aria-label="桌面主要导航"
      className="desktop-navigation"
      data-collapsed={state === "collapsed"}
      data-ready={ready}
    >
      <div className="desktop-navigation__brand">
        <Link className="desktop-navigation__wordmark" href="/" aria-label="Sueño 首页">
          <span className="desktop-navigation__mark" aria-hidden="true">S</span>
          <span className="desktop-navigation__word">Sue<span>ñ</span>o</span>
        </Link>
        <button
          aria-expanded={state === "expanded"}
          aria-label={state === "expanded" ? "收起侧边栏" : "展开侧边栏"}
          className="desktop-navigation__toggle"
          onClick={toggle}
          title={state === "expanded" ? "收起侧边栏" : "展开侧边栏"}
          type="button"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24"><path d={state === "expanded" ? "m14 5-7 7 7 7M20 5l-7 7 7 7" : "m10 5 7 7-7 7M4 5l7 7-7 7"} /></svg>
        </button>
      </div>

      <div className="desktop-navigation__groups">
        {navigationGroups.map((group) => (
          <div className="desktop-navigation__group" key={group.label}>
            <span className="desktop-navigation__group-label">{group.label}</span>
            <div className="desktop-navigation__items">
              {group.items.map((item) => {
                const isCurrent = pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <Link
                    aria-current={isCurrent ? "page" : undefined}
                    className="desktop-navigation__link"
                    href={item.href}
                    key={item.href}
                    title={item.label}
                  >
                    <span className="desktop-navigation__icon"><NavigationIcon name={item.icon} /></span>
                    <span className="desktop-navigation__label">{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="desktop-navigation__account"><AccountMenu /></div>
    </nav>
  );
}

export { NAVIGATION_STORAGE_KEY };
