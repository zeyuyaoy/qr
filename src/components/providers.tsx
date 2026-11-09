"use client";
import {ThemeProvider, useTheme} from "next-themes";
import {useEffect} from "react";
import {Toaster} from "sonner";

function ServiceWorker() {
    useEffect(() => {
        if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
        navigator.serviceWorker.register(`/sw.js?v=${process.env.NEXT_PUBLIC_SW_VERSION}`, {scope: "/"}).catch(() => undefined);
    }, []);
    return null;
}

export function Providers({children}: { children: React.ReactNode }) {
    return (
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
            {children}
            <ThemeChrome/>
            <ServiceWorker/>
        </ThemeProvider>
    );
}

function ThemeChrome() {
    const {resolvedTheme} = useTheme();

    useEffect(() => {
        if (resolvedTheme) {
            document.querySelector('meta[name="theme-color"]')
                ?.setAttribute("content", resolvedTheme === "dark" ? "#141a16" : "#d8dfcf");
        }
    }, [resolvedTheme]);

    return <Toaster theme={resolvedTheme === "dark" ? "dark" : "light"} position="top-center" richColors closeButton/>;
}
