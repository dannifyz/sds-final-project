import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Event Ticket",
  description: "Issue and verify signed QR event tickets",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
        <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <nav className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
            <Link href="/" className="font-semibold tracking-tight">
              🎟️ Event Ticket
            </Link>
            <div className="flex gap-4 text-sm text-zinc-600 dark:text-zinc-400">
              <Link href="/" className="hover:text-zinc-900 dark:hover:text-white">
                Scan
              </Link>
              <Link href="/admin" className="hover:text-zinc-900 dark:hover:text-white">
                Admin
              </Link>
            </div>
          </nav>
        </header>
        <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">{children}</main>
      </body>
    </html>
  );
}
