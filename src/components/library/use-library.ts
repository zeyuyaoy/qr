"use client";
import {useCallback, useEffect, useRef, useState} from "react";
import {api} from "@/lib/client/api";
import {useOnline} from "@/lib/client/hooks";
import {type CachedView, library, optimisticView, type PendingOp, queue, subscribe} from "@/lib/client/offline";
import type {Folder} from "@/lib/schema";
import {errMsg} from "./common";

function mergePending(server: CachedView[], cached: CachedView[], ops: PendingOp[]): CachedView[] {
    const byId = new Map<string, CachedView>(server.map((s) => [s.id, s]));
    const local = new Map(cached.map((c) => [c.id, c]));
    const flag = (op: PendingOp) => (op.status === "failed" ? {_error: op.error ?? "Could not sync"} : {});
    for (const op of ops) {
        if (op.kind === "create") {
            if (byId.has(op.input.id)) continue;
            byId.set(op.input.id, {
                ...(local.get(op.input.id) ?? optimisticView(op.input)),
                _pending: "create", ...flag(op)
            });
        } else if (op.kind === "update") {
            const mine = local.get(op.id);
            if (mine && byId.has(op.id)) byId.set(op.id, {...mine, _pending: "update", ...flag(op)});
        } else {
            const s = byId.get(op.id);
            if (s) byId.set(op.id, {...s, status: "trashed", _pending: "delete", ...flag(op)});
        }
    }
    return [...byId.values()];
}

export type LibraryData = {
    items: CachedView[];
    cachedAt: string | null;
    total: number;
    unreadable: number;
    ready: boolean;
    source: "live" | "cache";
    error: string | null;
    refreshing: boolean;
};

export function useLibrary() {
    const online = useOnline();
    const [data, setData] = useState<LibraryData>({
        items: [],
        cachedAt: null,
        total: 0,
        unreadable: 0,
        ready: false,
        source: "live",
        error: null,
        refreshing: true
    });
    const itemsRef = useRef<CachedView[]>([]);
    const live = useRef(false);

    const commit = useCallback((items: CachedView[], extra: Partial<LibraryData> = {}) => {
        itemsRef.current = items;
        setData((d) => ({...d, items, ...extra}));
    }, []);

    const refresh = useCallback(async () => {
        setData((d) => ({...d, refreshing: true}));
        try {
            const res = await api.codes.all({status: "all"});
            const [{items: cached}, ops] = await Promise.all([library.read(), queue.list()]);
            const merged = mergePending(res.items, cached, ops);
            live.current = true;
            await library.write(merged);
            commit(merged, {
                cachedAt: new Date().toISOString(),
                total: res.total,
                unreadable: res.unreadable.length,
                source: "live",
                error: null,
                ready: true,
                refreshing: false
            });
        } catch (e) {
            setData((d) => ({
                ...d,
                source: "cache",
                error: errMsg(e, "Could not reach the server"),
                ready: true,
                refreshing: false
            }));
        }
    }, [commit]);

    useEffect(() => {
        let alive = true;
        const readCache = () =>
            library.read().then(({items, cachedAt}) => {
                if (!alive) return;
                if (!live.current || items.length) commit(items, {cachedAt, ready: true});
            });
        void readCache();
        void refresh();
        const off = subscribe(() => void readCache());
        return () => {
            alive = false;
            off();
        };
    }, [commit, refresh]);

    const wasOnline = useRef(online);
    useEffect(() => {
        if (online && !wasOnline.current) void refresh();
        wasOnline.current = online;
    }, [online, refresh]);

    const mutate = useCallback(
        (fn: (items: CachedView[]) => CachedView[]) => {
            const next = fn(itemsRef.current);
            commit(next);
            void library.write(next);
        },
        [commit],
    );

    return {...data, refresh, mutate};
}

const FOLDERS_KEY = "qr.library.folders";
export type FolderWithCount = Folder & { count: number };

export function useFolders() {
    const [folders, setFolders] = useState<FolderWithCount[]>([]);
    const [loaded, setLoaded] = useState(false);
    const [tick, setTick] = useState(0);
    useEffect(() => {
        let alive = true;
        api.folders.list().then(
            (list) => {
                if (!alive) return;
                setFolders(list);
                setLoaded(true);
                try {
                    localStorage.setItem(FOLDERS_KEY, JSON.stringify(list));
                } catch {
                }
            },
            () => {
                if (!alive) return;
                try {
                    const raw = localStorage.getItem(FOLDERS_KEY);
                    if (raw) setFolders(JSON.parse(raw) as FolderWithCount[]);
                } catch {
                }
                setLoaded(true);
            },
        );
        return () => {
            alive = false;
        };
    }, [tick]);
    const reload = useCallback(() => setTick((n) => n + 1), []);
    return {folders, loaded, reload};
}
