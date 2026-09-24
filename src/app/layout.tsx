import type { Metadata } from "next";
import { DM_Sans, JetBrains_Mono } from "next/font/google";
import { BrowseFiltersProvider } from "@/components/BrowseFilters";
import { CreditsProvider } from "@/components/CreditsProvider";
import { Header } from "@/components/Header";
import "./globals.css";

const sans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "OddsLens",
  description: "Historical first and second half alternate totals for European football leagues",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${sans.className} ${mono.variable} antialiased`}>
        <CreditsProvider>
          <BrowseFiltersProvider>
            <Header />
            <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
          </BrowseFiltersProvider>
        </CreditsProvider>
      </body>
    </html>
  );
}
