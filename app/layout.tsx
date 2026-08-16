import type { Metadata, Viewport } from "next";
import { ServiceWorker } from "../components/service-worker";
import "./globals.css";

export const metadata: Metadata = {
  title: "Balkania Check-in",
  description: "Balkania employee attendance and leave portal",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Balkania" },
};

export const viewport: Viewport = { themeColor: "#175cd3" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><ServiceWorker />{children}</body></html>;
}
