import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Sueño",
    template: "%s | Sueño",
  },
  description: "A speaking-first Spanish learning experience.",
  applicationName: "Sueño",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Sueño",
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#F6F3ED",
};

type RootLayoutProps = Readonly<{
  children: ReactNode;
}>;

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script
          id="theme-initializer"
          // Only an explicit choice is written. Leaving the attribute unset lets
          // the public home follow `prefers-color-scheme`, while the signed-in
          // shell keeps its light default and the toggle writes the attribute on
          // mount as before.
          dangerouslySetInnerHTML={{
            __html: `(() => { try { const stored = window.localStorage.getItem("spanish-theme"); if (stored === "dark" || stored === "light") document.documentElement.dataset.theme = stored; } catch { /* no storage: leave the attribute unset */ } })();`,
          }}
        />
      </head>
      <body>
        {children}
      </body>
    </html>
  );
}
