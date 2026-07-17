import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "DeltaDotta · Team Launchpad", template: "%s · DeltaDotta" },
  description: "Build a portable, evidence-backed team operating system in minutes.",
  applicationName: "DeltaDotta",
  icons: { icon: "/deltadotta-mark.svg" },
  openGraph: { title: "DeltaDotta", description: "Portable, evidence-backed team operating systems.", type: "website" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
