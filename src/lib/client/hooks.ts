"use client";
import {createContext, useCallback, useEffect, useRef, useState, useSyncExternalStore} from "react";
import {defaultSettings, type Settings} from "../schema";
import {api, ApiClientError, type StatusData} from "./api";
import {getSyncState, type PendingOp, queue, settingsCache, subscribe} from "./offline";

const onlineSub = (cb: () => void) => {
    window.addEventListener("online", cb);
    window.addEventListener("offline", cb);
    return () => {
        window.removeEventListener("online", cb);
        window.removeEventListener("offline", cb);
    };
};
export const useOnline = () => useSyncExternalStore(onlineSub, () => navigator.onLine, () => true);

export function usePending() {
    const [ops, setOps] = useState<PendingOp[]>([]);
    const [syncing, setSyncing] = useState(false);
    useEffect(() => {
        let alive = true;
        const load = () => queue.list().then((o) => alive && (setOps(o), setSyncing(getSyncState().syncing)));
        void load();
        const off = subscribe(() => void load());
        return () => ((alive = false), off());
    }, []);
    return {
        ops,
        pending: ops.filter((o) => o.status === "pending").length,
        failed: ops.filter((o) => o.status === "failed").length,
        syncing
    };
}

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []) {
    const [data, setData] = useState<T | undefined>();
    const [error, setError] = useState<ApiClientError | Error | null>(null);
    const [loading, setLoading] = useState(true);
    const fnRef = useRef(fn);
    fnRef.current = fn;
    const run = useCallback(async () => {
        setLoading(true);
        try {
            setData(await fnRef.current());
            setError(null);
        } catch (e) {
            setError(e instanceof Error ? e : new Error("Failed"));
        } finally {
            setLoading(false);
        }
    }, []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => void run(), deps);
    return {data, error, loading, refresh: run, setData};
}

export const SealingContext = createContext<boolean | undefined>(undefined);

let statusCache: StatusData | undefined;

export function useStatus() {
    const r = useAsync(async () => (statusCache = await api.status()), []);
    return {...r, data: r.data ?? statusCache};
}

export function useSettings() {
    const [settings, setSettings] = useState<Settings>(defaultSettings());
    const [loaded, setLoaded] = useState(false);
    useEffect(() => {
        let alive = true;
        void settingsCache.read().then((s) => alive && s && setSettings(s));
        api.settings
            .get()
            .then((s) => {
                if (!alive) return;
                setSettings(s);
                void settingsCache.write(s);
            })
            .catch(() => undefined)
            .finally(() => alive && setLoaded(true));
        return () => void (alive = false);
    }, []);
    const save = useCallback(async (next: Settings) => {
        const saved = await api.settings.put(next);
        setSettings(saved);
        await settingsCache.write(saved);
        return saved;
    }, []);
    return {settings, loaded, save, setSettings};
}

export function formatDateTime(iso: string | null | undefined, timeZone = "UTC", opts: Intl.DateTimeFormatOptions = {
    dateStyle: "medium",
    timeStyle: "short"
}) {
    if (!iso) return "—";
    try {
        return new Intl.DateTimeFormat(undefined, {timeZone, ...opts}).format(new Date(iso));
    } catch {
        return new Date(iso).toISOString();
    }
}
