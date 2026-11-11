"use client";

import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/lib/auth";
import { RealtimeProvider } from "@/lib/realtime";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <AuthProvider>
        <RealtimeProvider>
          <TooltipProvider delayDuration={200}>
            {children}
            <Toaster richColors closeButton position="top-right" />
          </TooltipProvider>
        </RealtimeProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
