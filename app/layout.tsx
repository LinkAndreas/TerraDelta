import type { Metadata, Viewport } from "next";
import "./globals.css";
import Providers from "@/components/Providers";

export const metadata: Metadata = {
  title: "TerraDelta — Orthophoto Change Analyzer",
  description:
    "TerraDelta detects and highlights semantic changes between two aerial orthophotos using AI.",
};

// Without this, mobile browsers assume a ~980px desktop-width layout and
// render the whole page zoomed out to fit — the app "looks tiny" on a
// phone even though every component already has real mobile breakpoints.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de" suppressHydrationWarning>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
