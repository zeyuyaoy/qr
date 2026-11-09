"use client";
import {RefreshCw, TriangleAlert, WifiOff} from "lucide-react";
import {Button} from "@/components/ui/button";
import {ApiClientError} from "@/lib/client/api";
import {cn} from "@/lib/utils";

export const Skeleton = ({className}: { className?: string }) => <div aria-hidden
                                                                      className={cn("animate-pulse rounded-lg bg-muted", className)}/>;

export function Kpi({label, value, hint}: { label: string; value: number; hint?: string }) {
    return (
        <div className="border-l pl-3">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="mt-1 text-2xl font-semibold tabular-nums">{value.toLocaleString()}</dd>
            {hint ? <dd className="mt-0.5 text-xs text-muted-foreground">{hint}</dd> : null}
        </div>
    );
}

export function ErrorState({error, onRetry}: { error: Error; onRetry: () => void }) {
    const offline = error instanceof ApiClientError && error.code === "OFFLINE";
    const Icon = offline ? WifiOff : TriangleAlert;
    return (
        <div role="alert"
             className="flex flex-col items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm">
            <div className="flex items-start gap-2">
                <Icon className="mt-0.5 size-4 shrink-0 text-destructive"/>
                <p>{offline ? "You're offline, so analytics can't be loaded. They need a connection to the server." : error.message || "Analytics could not be loaded."}</p>
            </div>
            <Button variant="outline" className="tap" onClick={onRetry}>
                <RefreshCw/> Try again
            </Button>
        </div>
    );
}
