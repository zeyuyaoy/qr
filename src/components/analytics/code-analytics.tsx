"use client";
import Link from "next/link";
import {useAsync, useOnline} from "@/lib/client/hooks";
import {api} from "@/lib/client/api";
import {Breakdown} from "./breakdown";
import {DailyTrend} from "./daily-trend";
import {ResetAnalyticsDialog} from "./reset-dialog";
import {ErrorState, Kpi, Skeleton} from "./ui";

export function CodeAnalytics({id}: { id: string }) {
    const online = useOnline();
    const {data, error, loading, refresh} = useAsync(() => api.codes.analytics(id, 30), [id]);

    if (error && !data) return <ErrorState error={error} onRetry={() => void refresh()}/>;
    if (!data) return <div aria-busy="true" aria-label="Loading analytics" className="space-y-3"><Skeleton
        className="h-16"/><Skeleton className="h-56"/></div>;

    const week = data.daily.slice(-7).reduce((n, d) => n + d.scans, 0);
    return (
        <div className="space-y-4" aria-busy={loading}>
            {!data.enabled && (
                <p role="status" className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm">
                    Analytics are turned off, so new scans are not being recorded. <Link className="underline"
                                                                                         href="/settings#analytics">Change
                    in Settings</Link>
                </p>
            )}
            {error && <ErrorState error={error} onRetry={() => void refresh()}/>}
            <dl className="grid grid-cols-2 gap-3">
                <Kpi label="Scans, last 30 days" value={data.totals.scans}/>
                <Kpi label="Scans, last 7 days" value={week}/>
            </dl>
            <DailyTrend data={data.daily} height={180} title="Daily scans for this code"/>
            <Breakdown title="Devices" data={data.devices}/>
            <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">Days are in UTC. Counts older
                    than {data.retentionDays} days are removed automatically.</p>
                <ResetAnalyticsDialog id={id} disabled={!online} onDone={() => void refresh()}/>
            </div>
        </div>
    );
}
