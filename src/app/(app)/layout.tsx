import { BrowseFiltersProvider } from "@/components/BrowseFilters";
import { CreditsProvider } from "@/components/CreditsProvider";
import { Header } from "@/components/Header";

export default function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <CreditsProvider>
      <BrowseFiltersProvider>
        <Header />
        <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
      </BrowseFiltersProvider>
    </CreditsProvider>
  );
}
