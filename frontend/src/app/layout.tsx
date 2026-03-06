import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { StoreProvider } from "@/store/provider";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Debate Arena",
  description: "Real-time gamified debate platform – argue with humans or AI",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className={inter.className} suppressHydrationWarning>
        <StoreProvider>
          <main className="min-h-screen">{children}</main>
        </StoreProvider>
      </body>
    </html>
  );
}
