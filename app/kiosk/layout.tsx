import type { Metadata, Viewport } from "next";

// The kiosk is installed on shared tablets and must relaunch straight back
// into kiosk mode. The root manifest's start_url is "/" (the employee
// sign-in), so installing from this page would otherwise reopen to a login
// prompt instead of the kiosk. Overriding the manifest here points the
// installed app at /kiosk, scoped so it stays there.
export const metadata: Metadata = {
  title: "Balkania Kiosk",
  description: "Shared attendance kiosk for clocking in and out",
  manifest: "/kiosk.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Balkania Kiosk" },
};

export const viewport: Viewport = { themeColor: "#f7f4ed" };

export default function KioskLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
