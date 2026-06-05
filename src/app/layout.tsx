import type { Metadata } from "next";
import { SiteCredits } from "@/components/SiteCredits";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cutoff Lens",
  description: "Counselling cutoff explorer for Indian entrance exams.",
  icons: {
    icon: "/logo.svg",
    shortcut: "/logo.svg",
    apple: "/logo.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        {children}
        <SiteCredits />
      </body>
    </html>
  );
}
