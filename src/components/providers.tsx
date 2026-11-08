"use client";
import { ThemeProvider } from "next-themes";
import { useEffect } from "react";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register(`/sw.js?v=${process.env.NEXT_PUBLIC_SW_VERSION}`, { scope: "/" }).catch(() => undefined);
  }, []);
  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <TooltipProvider delay={300}>
        {children}
        <Toaster position="top-center" richColors closeButton />
        <ServiceWorker />
      </TooltipProvider>
    </ThemeProvider>
  );
}
