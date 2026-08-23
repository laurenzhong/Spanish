import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { ThemeInitializer } from "@/src/shared/ui/theme-initializer";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Sueño",
    template: "%s | Sueño",
  },
  description: "A speaking-first Spanish learning experience.",
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
      <body>
        <ThemeInitializer />
        {children}
      </body>
    </html>
  );
}
