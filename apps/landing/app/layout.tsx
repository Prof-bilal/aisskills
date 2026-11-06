import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Skills — The capability layer for AI agents",
  description:
    "Install skills once. Let every agent discover the right context and tools when the task needs them.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
