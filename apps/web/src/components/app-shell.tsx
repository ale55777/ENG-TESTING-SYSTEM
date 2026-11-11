"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  BarChart3,
  BookOpenText,
  GraduationCap,
  History,
  Keyboard,
  LayoutDashboard,
  Loader2,
  LogOut,
  Menu,
  MessagesSquare,
  Mic2,
  Radio,
  Settings,
  Shield,
  Wind,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ThemeToggle } from "@/components/theme-toggle";
import { useAuth } from "@/lib/auth";
import { useRealtime } from "@/lib/realtime";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { section: "Practice" },
  { href: "/practice/reading", label: "Reading aloud", icon: BookOpenText },
  { href: "/practice/pronunciation", label: "Pronunciation", icon: Mic2 },
  { href: "/practice/tongue-twisters", label: "Tongue twisters", icon: Wind },
  { href: "/practice/speaking", label: "Speaking (IELTS-style)", icon: MessagesSquare },
  { href: "/practice/typing", label: "Typing", icon: Keyboard },
  { section: "Track" },
  { href: "/progress", label: "Progress", icon: BarChart3 },
  { href: "/history", label: "History", icon: History },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

function NavLinks({ onNavigate, isAdmin }: { onNavigate?: () => void; isAdmin: boolean }) {
  const pathname = usePathname();
  const items = [...NAV, ...(isAdmin ? ([{ section: "Admin" }, { href: "/admin", label: "Administration", icon: Shield }] as const) : [])];
  return (
    <nav aria-label="Main" className="flex flex-col gap-0.5">
      {items.map((item, i) =>
        "section" in item ? (
          <div key={i} className="px-3 pb-1 pt-4 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {item.section}
          </div>
        ) : (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={pathname.startsWith(item.href) ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-accent hover:text-accent-foreground",
              pathname.startsWith(item.href) && "bg-accent font-medium text-accent-foreground",
            )}
          >
            <item.icon className="size-4 shrink-0" aria-hidden />
            {item.label}
          </Link>
        ),
      )}
    </nav>
  );
}

function RealtimeBadge() {
  const { status } = useRealtime();
  if (status === "disabled") return null;
  const label = { connected: "Live updates connected", connecting: "Connecting live updates…", disconnected: "Live updates reconnecting…", failed: "Live updates unavailable — using polling" }[status];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs text-muted-foreground" role="status">
          <Radio className={cn("size-3.5", status === "connected" ? "text-green-600" : status === "failed" ? "text-destructive" : "animate-pulse")} aria-hidden />
          <span className="hidden sm:inline">{status === "connected" ? "Live" : status === "failed" ? "Offline" : "…"}</span>
          <span className="sr-only">{label}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function AppShell({ children, requireAdmin = false }: { children: React.ReactNode; requireAdmin?: boolean }) {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [loading, user, router, pathname]);

  if (loading || !user) {
    return (
      <div className="flex flex-1 items-center justify-center p-10" role="status">
        <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden />
        <span className="sr-only">Loading your account…</span>
      </div>
    );
  }
  if (requireAdmin && user.role !== "admin") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-10 text-center">
        <Shield className="size-8 text-muted-foreground" aria-hidden />
        <h1 className="text-xl font-semibold">Administrator access required</h1>
        <Button asChild variant="outline">
          <Link href="/dashboard">Back to dashboard</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex min-h-svh w-full">
      <aside className="sticky top-0 hidden h-svh w-64 shrink-0 flex-col border-r bg-sidebar p-3 lg:flex">
        <Link href="/dashboard" className="mb-2 flex items-center gap-2 px-3 py-2 font-semibold">
          <GraduationCap className="size-6 text-primary" aria-hidden /> LinguaPractice
        </Link>
        <div className="flex-1 overflow-y-auto">
          <NavLinks isAdmin={user.role === "admin"} />
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/85 px-3 backdrop-blur sm:px-6">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation">
                <Menu className="size-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 p-3">
              <SheetTitle className="flex items-center gap-2 px-3 py-2">
                <GraduationCap className="size-5 text-primary" aria-hidden /> LinguaPractice
              </SheetTitle>
              <NavLinks isAdmin={user.role === "admin"} onNavigate={() => setOpen(false)} />
            </SheetContent>
          </Sheet>
          <div className="flex-1" />
          <RealtimeBadge />
          <ThemeToggle />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="gap-2 px-2" aria-label="Account menu">
                <span className="flex size-7 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground" aria-hidden>
                  {user.display_name.slice(0, 1).toUpperCase()}
                </span>
                <span className="hidden max-w-32 truncate text-sm sm:inline">{user.display_name}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="truncate">{user.email}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => router.push("/settings")}>
                <Settings /> Settings
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={async () => {
                  await logout();
                  router.replace("/login");
                }}
              >
                <LogOut /> Log out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>
        <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
