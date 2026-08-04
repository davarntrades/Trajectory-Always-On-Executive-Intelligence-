import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Trajectory",
  description:
    "Persistent executive intelligence. Observes, remembers, reasons, recommends.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en-GB" className="h-full antialiased">
      <body className="trajectory-shell min-h-full">{children}</body>
    </html>
  );
}
