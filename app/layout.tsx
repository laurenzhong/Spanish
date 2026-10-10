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
          dangerouslySetInnerHTML={{
            __html: `(() => { try { const storedTheme = window.localStorage.getItem("spanish-theme"); document.documentElement.dataset.theme = storedTheme === "dark" || storedTheme === "light" ? storedTheme : "light"; } catch { document.documentElement.dataset.theme = "light"; } })();`,
          }}
        />
      </head>
      <body>
        {children}
      </body>
    </html>
  );
}
