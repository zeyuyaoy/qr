"use client";
import {Download, WifiOff} from "lucide-react";
import Link from "next/link";
import {useState} from "react";
import {Breakdown, countryName} from "@/components/analytics/breakdown";
import {DailyTrend} from "@/components/analytics/daily-trend";
import {ResetAnalyticsDialog} from "@/components/analytics/reset-dialog";
import {ErrorState, Kpi, Skeleton} from "@/components/analytics/ui";
import {PageHeader} from "@/components/page-header";
import {Badge} from "@/components/ui/badge";
import {Button, buttonVariants} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import {api} from "@/lib/client/api";
import {formatDateTime, useAsync, useOnline, useSettings} from "@/lib/client/hooks";
import {cn} from "@/lib/utils";

const PRESETS = [7, 30, 90] as const;
const DAY = 86_400_000;
const MAX_DAYS = 366;
const dayStr = (t: number) => new Date(t).toISOString().slice(0, 10);
const presetRange = (days: number) => {
    const now = Date.now();
    return {from: dayStr(now - (days - 1) * DAY), to: dayStr(now)};
};
const spanDays = (r: { from: string; to: string }) => Math.round((Date.parse(r.to) - Date.parse(r.from)) / DAY) + 1;

export default function AnalyticsPage() {
    const online = useOnline();
    const {settings} = useSettings();
    const tz = settings.timezone;
    const [preset, setPreset] = useState<number | "custom">(30);
    const [range, setRange] = useState(() => presetRange(30));
    const [custom, setCustom] = useState(() => presetRange(30));
    const [today] = useState(() => dayStr(Date.now()));
    const customError = !custom.from || !custom.to ? "Choose both dates." : custom.from > custom.to ? "The start date must not be after the end date." : spanDays(custom) > MAX_DAYS ? `Choose a range of at most ${MAX_DAYS} days.` : custom.to > today ? "The end date cannot be in the future." : "";
    const {data, error, loading, refresh} = useAsync(() => api.analytics.get(range), [range.from, range.to]);

    const pick = (p: number | "custom") => {
        setPreset(p);
        if (p !== "custom") setRange(presetRange(p));
    };

    return (
        <>
            <PageHeader
                title="Analytics"
                description="Scan activity for dynamic QR codes."
                actions={
                    online ? (
                        <a href={api.analytics.csvUrl(range)} download
                           className={cn(buttonVariants({variant: "outline"}), "tap")}>
                            <Download/> Export CSV
                        </a>
                    ) : (
                        <Button variant="outline" className="tap" disabled><Download/> Export CSV</Button>
                    )
                }
            />

            <section aria-label="Date range" className="mb-5 space-y-3">
                <div role="group" aria-label="Range presets" className="flex flex-wrap gap-2">
                    {[...PRESETS, "custom" as const].map((p) => (
                        <Button key={p} variant={preset === p ? "default" : "outline"} className="tap"
                                aria-pressed={preset === p} onClick={() => pick(p)}>
                            {p === "custom" ? "Custom" : `${p} days`}
                        </Button>
                    ))}
                </div>
                {preset === "custom" && (
                    <form
                        className="flex flex-wrap items-end gap-3"
                        onSubmit={(e) => {
                            e.preventDefault();
                            if (!customError) setRange(custom);
                        }}
                    >
                        <div className="grid gap-1.5">
                            <Label htmlFor="an-from">From</Label>
                            <Input id="an-from" type="date" className="h-11 w-44" max={custom.to || today}
                                   value={custom.from} onChange={(e) => setCustom({...custom, from: e.target.value})}
                                   aria-invalid={Boolean(customError)}
                                   aria-describedby={customError ? "an-range-err" : undefined}/>
                        </div>
                        <div className="grid gap-1.5">
                            <Label htmlFor="an-to">To</Label>
                            <Input id="an-to" type="date" className="h-11 w-44" min={custom.from} max={today}
                                   value={custom.to} onChange={(e) => setCustom({...custom, to: e.target.value})}
                                   aria-invalid={Boolean(customError)}
                                   aria-describedby={customError ? "an-range-err" : undefined}/>
                        </div>
                        <Button type="submit" className="tap" disabled={Boolean(customError)}>Apply</Button>
                        {customError &&
                            <p id="an-range-err" className="basis-full text-sm text-destructive">{customError}</p>}
                    </form>
                )}
                <p className="text-xs text-muted-foreground">Showing {range.from} to {range.to}. Days are UTC.</p>
            </section>

            {!online && (
                <p role="status"
                   className="mb-4 flex items-center gap-2 rounded-xl border bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
                    <WifiOff className="size-4 shrink-0"/> You&apos;re
                    offline. {data ? "Showing the last data that was loaded." : "Analytics need a connection to the server."}
                </p>
            )}

            {error && !data ? (
                <ErrorState error={error} onRetry={() => void refresh()}/>
            ) : !data ? (
                <div aria-busy="true" aria-label="Loading analytics" className="space-y-4">
                    <div className="grid grid-cols-2 gap-3">{Array.from({length: 2}, (_, i) => <Skeleton key={i}
                                                                                                         className="h-20"/>)}</div>
                    <Skeleton className="h-64"/>
                </div>
            ) : (
                <div className="space-y-5" aria-busy={loading}>
                    {error && <ErrorState error={error} onRetry={() => void refresh()}/>}
                    {!data.enabled && (
                        <p role="status"
                           className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm">
                            Analytics are turned off, so new scans are not being recorded. Figures below are from before
                            they were disabled.{" "}
                            <Link className="underline" href="/settings#analytics">Turn them on in Settings</Link>.
                        </p>
                    )}

                    {data.totals.codes === 0 ? (
                        <div className="rounded-xl border border-dashed p-8 text-center">
                            <p className="font-medium">No codes yet</p>
                            <p className="mt-1 text-sm text-muted-foreground">Create a dynamic QR code and its scans
                                will show up here.</p>
                            <Link href="/" className={cn(buttonVariants(), "tap mt-4")}>Create a code</Link>
                        </div>
                    ) : (
                        <>
                            <dl className="grid grid-cols-2 gap-3">
                                <Kpi label="Scans in range" value={data.totals.scans}/>
                                <Kpi label="Total codes" value={data.totals.codes}/>
                            </dl>

                            <section aria-labelledby="an-trend" className="border-t pt-3">
                                <h2 id="an-trend" className="mb-3 font-medium">Daily scans</h2>
                                <DailyTrend data={data.daily}/>
                            </section>

                            <details className="border-y">
                                <summary
                                    className="tap cursor-pointer py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring">Link
                                    status
                                </summary>
                                <dl className="grid grid-cols-2 gap-2 pb-3 sm:grid-cols-3 lg:grid-cols-5">
                                    <Kpi label="Active" value={data.totals.active}/>
                                    <Kpi label="Expired" value={data.totals.expired}/>
                                    <Kpi label="Paused" value={data.totals.paused} hint="Archived or switched off"/>
                                    <Kpi label="Scheduled" value={data.totals.scheduled} hint="Not live yet"/>
                                    <Kpi label="Scan limit reached" value={data.totals.exhausted}/>
                                </dl>
                            </details>

                            <div className="grid gap-5 md:grid-cols-2">
                                <Breakdown title="Devices" data={data.devices}/>
                                <Breakdown title="Countries" data={data.countries} label={countryName}
                                           note="Country is only recorded when enabled in Settings and available from trusted platform headers."/>
                            </div>
                            {Object.keys(data.countries).length === 0 && (
                                <p className="text-xs text-muted-foreground">Country is only recorded when enabled in
                                    Settings and available from trusted platform headers (for example on Vercel), so no
                                    country breakdown is shown.</p>
                            )}

                            <div className="grid gap-5 lg:grid-cols-2">
                                <section aria-labelledby="an-top" className="border-t pt-3">
                                    <h2 id="an-top" className="font-medium">Top codes</h2>
                                    {data.top.length === 0 ? (
                                        <p className="mt-2 text-sm text-muted-foreground">No scans in this range.</p>
                                    ) : (
                                        <ol className="mt-2 divide-y">
                                            {data.top.map((t) => (
                                                <li key={t.id}>
                                                    <Link href={`/library/${t.id}`}
                                                          className="flex min-h-11 items-center justify-between gap-3 rounded-md py-2 text-sm hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring">
                                                        <span className="min-w-0 truncate">{t.name}</span>
                                                        <span className="flex shrink-0 items-center gap-2">
                              <Badge variant="outline">{t.mode}</Badge>
                              <span className="tabular-nums">{t.scans.toLocaleString()}</span>
                            </span>
                                                    </Link>
                                                </li>
                                            ))}
                                        </ol>
                                    )}
                                </section>

                                <section aria-labelledby="an-recent" className="border-t pt-3">
                                    <h2 id="an-recent" className="font-medium">Recent activity</h2>
                                    <p className="text-xs text-muted-foreground">Times shown in {tz}. Stored as UTC.</p>
                                    {data.recent.length === 0 ? (
                                        <p className="mt-2 text-sm text-muted-foreground">No recent scans.</p>
                                    ) : (
                                        <ul className="mt-2 divide-y">
                                            {data.recent.map((r, i) => (
                                                <li key={`${r.at}-${i}`}
                                                    className="flex min-h-11 items-center justify-between gap-3 py-2 text-sm">
                          <span className="min-w-0">
                            {r.name === "(deleted)" ? <span className="text-muted-foreground">{r.name}</span> :
                                <Link className="truncate underline-offset-2 hover:underline"
                                      href={`/library/${r.id}`}>{r.name}</Link>}
                              <span className="block text-xs text-muted-foreground">{formatDateTime(r.at, tz)}</span>
                          </span>
                                                    <span
                                                        className="shrink-0 text-xs capitalize text-muted-foreground">{r.device}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </section>
                            </div>
                        </>
                    )}

                    <section aria-labelledby="an-data"
                             className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4">
                        <div className="min-w-0">
                            <h2 id="an-data" className="font-medium">Analytics data</h2>
                            <p className="text-sm text-muted-foreground">Kept for {data.retentionDays} days, then
                                removed automatically. Analytics store counts and device categories, not visitor
                                identities.</p>
                        </div>
                        <ResetAnalyticsDialog disabled={!online} onDone={() => void refresh()}/>
                    </section>
                </div>
            )}
        </>
    );
}
