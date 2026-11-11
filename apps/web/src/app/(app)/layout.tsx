import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import { AppShell } from "@/components/app-shell";

function ShellFallback() {
  return (
    <div className="flex flex-1 items-center justify-center p-10" role="status">
      <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden />
      <span className="sr-only">Loading…</span>
    </div>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  // AppShell reads the URL (usePathname/useParams); with Cache Components it must stream inside Suspense.
  return (
    <Suspense fallback={<ShellFallback />}>
      <AppShell>{children}</AppShell>
    </Suspense>
  );
}
