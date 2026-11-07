import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Skills — The right skills for every AI coding task",
  description:
    "A free CLI for Claude Code, Codex, OpenCode and Gemini CLI. Keep a library of agent skills and give each task only the ones it needs.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
