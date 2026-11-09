"use client";
import {
    BarChart3,
    CloudOff,
    FolderOpen,
    Layers,
    LayoutTemplate,
    Loader2,
    Monitor,
    Moon,
    MoreHorizontal,
    QrCode,
    ScanLine,
    Settings,
    Sun,
    TriangleAlert,
    WifiOff
} from "lucide-react";
import Link from "next/link";
import {usePathname} from "next/navigation";
import {useTheme} from "next-themes";
import {useEffect, useState} from "react";
import {Button} from "@/components/ui/button";
import {DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger} from "@/components/ui/dropdown-menu";
import {Recovery} from "@/components/recovery";
import {InstallHint} from "@/components/install-hint";
import type {StatusData} from "@/lib/client/api";
import {startSync} from "@/lib/client/offline";
import {SealingContext, useOnline, usePending, useStatus} from "@/lib/client/hooks";
import {cn} from "@/lib/utils";

const PRIMARY = [
    {href: "/", label: "Create", icon: QrCode},
    {href: "/library", label: "Library", icon: FolderOpen},
    {href: "/scan", label: "Scan", icon: ScanLine},
] as const;
const SECONDARY = [
    {href: "/templates", label: "Templates", icon: LayoutTemplate},
    {href: "/bulk", label: "Bulk", icon: Layers},
    {href: "/analytics", label: "Analytics", icon: BarChart3},
    {href: "/settings", label: "Settings", icon: Settings},
] as const;

const isActive = (path: string, href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`));

function ThemeToggle() {
    const {theme, setTheme} = useTheme();
    const [mounted, setMounted] = useState(false);
    useEffect(() => setMounted(true), []);
    const next = !mounted ? "light" : theme === "light" ? "dark" : theme === "dark" ? "system" : "light";
    const Icon = !mounted ? Monitor : theme === "light" ? Sun : theme === "dark" ? Moon : Monitor;
    return (
        <Button variant="ghost" size="icon" className="tap" onClick={() => setTheme(next)}
                aria-label={`Theme: ${mounted ? theme : "system"}. Switch to ${next}`}>
            <Icon/>
        </Button>
    );
}

function SyncBadge() {
    const online = useOnline();
    const {pending, failed, syncing} = usePending();
    if (!online)
        return (
            <span role="status"
                  className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-medium text-amber-700 dark:text-amber-300">
        <WifiOff className="size-3.5"/> Offline{pending ? ` · ${pending} pending` : ""}
      </span>
        );
    if (syncing || pending)
        return (
            <span role="status"
                  className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs font-medium">
        <Loader2 className={cn("size-3.5", syncing && "animate-spin")}/> {syncing ? "Syncing…" : `${pending} pending`}
      </span>
        );
    if (failed)
        return (
            <Link href="/library?status=pending"
                  className="inline-flex items-center gap-1.5 rounded-full bg-destructive/10 px-2.5 py-1 text-xs font-medium text-destructive">
                <TriangleAlert className="size-3.5"/> {failed} need attention
            </Link>
        );
    return null;
}

function Banner({tone, children}: { tone: "warn" | "error"; children: React.ReactNode }) {
    return (
        <div role={tone === "error" ? "alert" : "status"}
             className={cn("mb-4 flex items-start gap-2 rounded-xl border px-3 py-2 text-sm", tone === "error" ? "border-destructive/30 bg-destructive/10 text-destructive" : "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200")}>
            <TriangleAlert className="mt-0.5 size-4 shrink-0"/>
            <div>{children}</div>
        </div>
    );
}

function Notices({data}: { data: StatusData | undefined }) {
    if (!data) return null;
    return (
        <>
            {data.config.issues?.length ? <Banner tone="warn">Server configuration needs
                attention: {data.config.issues.join("; ")}.</Banner> : null}
            {!data.redis.ok &&
                <Banner tone="error">The database is unreachable right now. You can still generate and export codes;
                    saving will be queued and retried.</Banner>}
            {data.storage.warn &&
                <Banner tone="warn">Redis storage is {Math.round((data.storage.usedPct ?? 0) * 100)}% full (the free
                    tier is ~30 MB and is shared with other sites). Archive or delete old codes.</Banner>}
        </>
    );
}

function BackupNotice({data}: { data: StatusData | undefined }) {
    const path = usePathname();
    if (!data?.initialized || (data.backup.configured && data.backup.freshness.state !== "stale")) return null;
    const LinkToBackup = path === "/settings" ? "a" : Link;
    const href = path === "/settings" ? "#backup" : "/settings#backup";
    return (
        <div className="mt-6 text-xs [&>div]:mb-0">
            {!data.backup.configured ? (
                <Banner tone="warn">
                    Backups are not configured, so saved data is <strong>not protected</strong> against Redis data
                    loss.{" "}
                    <LinkToBackup className="underline" href={href}>Set up backups</LinkToBackup>
                </Banner>
            ) : (
                <Banner tone="warn">Your last successful backup
                    is {Math.round(data.backup.freshness.ageHours ?? 0)} hours old. <LinkToBackup className="underline"
                                                                                                  href={href}>Check
                        backups</LinkToBackup></Banner>
            )}
        </div>
    );
}

function Gate({children}: { children: React.ReactNode }) {
    const {data, loading, refresh} = useStatus();
    if (data?.recovery.needed) return <Recovery status={data} onDone={refresh}/>;
    return (
        <>
            {loading && !data ? null : <Notices data={data}/>}
            <SealingContext value={data?.sealing}>{children}</SealingContext>
            <BackupNotice data={data}/>
        </>
    );
}

export function AppShell({children, email}: { children: React.ReactNode; email: string }) {
    const path = usePathname();
    useEffect(() => startSync(), []);
    useEffect(() => {
        if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
            void navigator.serviceWorker.ready.then((r) => r.active?.postMessage({type: "cache-private"}));
        }
    }, []);
    const online = useOnline();

    return (
        <div className="min-h-dvh md:grid md:grid-cols-[168px_minmax(0,1fr)] lg:grid-cols-[188px_minmax(0,1fr)]">
            <aside
                className="no-print sticky top-0 hidden h-dvh overflow-y-auto flex-col border-r bg-sidebar p-3 md:flex"
                aria-label="Primary">
                <div className="mb-4 flex items-center gap-2 px-2 pt-1">
                    <span
                        className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground"><QrCode
                        className="size-4"/></span>
                    <span className="font-semibold tracking-tight">QR Studio</span>
                </div>
                <nav aria-label="Primary" className="flex flex-col gap-0.5">
                    {PRIMARY.map(({href, label, icon: Icon}) => (
                        <Link key={href} href={href} aria-current={isActive(path, href) ? "page" : undefined}
                              className={cn("flex min-h-11 items-center gap-2.5 rounded-md px-2.5 text-sm font-semibold text-muted-foreground transition-colors duration-[120ms] hover:bg-sidebar-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring", isActive(path, href) && "bg-sidebar-accent text-primary ring-1 ring-primary/25 ring-inset")}>
                            <Icon className="size-4"/> {label}
                        </Link>
                    ))}
                </nav>
                <nav aria-label="Tools" className="mt-5 flex flex-col gap-0.5 border-t pt-3">
                    <p className="px-2.5 text-xs font-medium text-muted-foreground">Tools</p>
                    {SECONDARY.map(({href, label, icon: Icon}) => (
                        <Link key={href} href={href} aria-current={isActive(path, href) ? "page" : undefined}
                              className={cn("flex min-h-11 items-center gap-2.5 rounded-md px-2.5 text-sm font-semibold text-muted-foreground transition-colors duration-[120ms] hover:bg-sidebar-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring", isActive(path, href) && "bg-sidebar-accent text-primary ring-1 ring-primary/25 ring-inset")}>
                            <Icon className="size-4"/> {label}
                        </Link>
                    ))}
                </nav>
                <div className="mt-auto space-y-2 px-1 pb-1">
                    <InstallHint/>
                    <div className="truncate px-1 text-xs text-muted-foreground" title={email}>{email}</div>
                </div>
            </aside>

            <div className="min-w-0">
                <header
                    className="no-print safe-top sticky top-0 z-30 flex min-h-12 items-center justify-between gap-2 bg-background px-4 md:px-6">
                    <div className="flex items-center gap-2 md:hidden">
                        <span
                            className="grid size-7 place-items-center rounded-md bg-primary text-primary-foreground"><QrCode
                            className="size-3.5"/></span>
                        <span className="text-sm font-semibold">QR Studio</span>
                    </div>
                    <div className="hidden md:block"/>
                    <div className="flex items-center gap-1">
                        <SyncBadge/>
                        <ThemeToggle/>
                    </div>
                </header>

                <main id="main" tabIndex={-1}
                      className="mx-auto w-full max-w-6xl px-4 pb-[calc(5rem+env(safe-area-inset-bottom))] pt-2 outline-none md:px-6 md:pb-10 md:pt-5 lg:px-8 xl:px-10">
                    {!online && (
                        <div role="status"
                             className="mb-4 flex items-center gap-2 rounded-xl border bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
                            <CloudOff className="size-4"/> You&apos;re offline. Generating, styling and exporting work
                            normally; saves are queued until you reconnect.
                        </div>
                    )}
                    <Gate>{children}</Gate>
                    <div className="mt-4 empty:hidden md:hidden"><InstallHint/></div>
                </main>

                <nav aria-label="Primary"
                     className="no-print safe-bottom fixed inset-x-0 bottom-0 z-40 border-t bg-sidebar md:hidden">
                    <ul className="mx-auto grid max-w-md grid-cols-4">
                        {PRIMARY.map(({href, label, icon: Icon}) => (
                            <li key={href}>
                                <Link href={href} aria-current={isActive(path, href) ? "page" : undefined}
                                      className={cn("flex h-14 flex-col items-center justify-center gap-0.5 text-xs font-medium text-muted-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring", isActive(path, href) && "bg-sidebar-accent font-semibold text-primary")}>
                                    <Icon className="size-5"/> {label}
                                </Link>
                            </li>
                        ))}
                        <li>
                            <DropdownMenu>
                                <DropdownMenuTrigger
                                    className={cn("flex h-14 w-full flex-col items-center justify-center gap-0.5 text-xs font-medium text-muted-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring", SECONDARY.some((s) => isActive(path, s.href)) && "bg-sidebar-accent font-semibold text-primary")}>
                                    <MoreHorizontal className="size-5"/> More
                                </DropdownMenuTrigger>
                                <DropdownMenuContent side="top" align="end" sideOffset={8} className="w-48">
                                    {SECONDARY.map(({href, label, icon: Icon}) => (
                                        <DropdownMenuItem key={href} className="min-h-11 gap-2.5"
                                                          render={<Link href={href}
                                                                        aria-current={isActive(path, href) ? "page" : undefined}/>}><Icon
                                            className="size-4"/> {label}</DropdownMenuItem>
                                    ))}
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </li>
                    </ul>
                </nav>
            </div>
        </div>
    );
}
