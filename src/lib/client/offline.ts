"use client";
import {createStore, del, delMany, entries, get, set} from "idb-keyval";
import {newId, newOpId, newSlug} from "../ids";
import type {CreateInput, QrView, Settings} from "../schema";
import {api, ApiClientError} from "./api";

let _store: ReturnType<typeof createStore> | null = null;
const store = () => (_store ??= createStore("qr-studio", "kv"));
const safe = async <T>(fn: () => Promise<T>, fallback: T): Promise<T> => {
    try {
        return await fn();
    } catch {
        return fallback;
    }
};

type Listener = () => void;
const listeners = new Set<Listener>();
export const subscribe = (l: Listener) => (listeners.add(l), () => void listeners.delete(l));
const emit = () => listeners.forEach((l) => l());

export type Draft<T = unknown> = { id: string; savedAt: string; state: T };
export const drafts = {
    save: <T>(id: string, state: T) => safe(() => set(`draft:${id}`, {
        id,
        savedAt: new Date().toISOString(),
        state
    } satisfies Draft<T>, store()), undefined),
    load: <T>(id: string) => safe(() => get<Draft<T>>(`draft:${id}`, store()), undefined),
    remove: (id: string) => safe(() => del(`draft:${id}`, store()), undefined),
};

export type CachedView = QrView & { _pending?: "create" | "update" | "delete"; _error?: string };
export const library = {
    async read(): Promise<{ items: CachedView[]; cachedAt: string | null }> {
        return safe(async () => {
            const [items, meta] = await Promise.all([get<CachedView[]>("library:items", store()), get<{
                cachedAt: string
            }>("library:meta", store())]);
            return {items: items ?? [], cachedAt: meta?.cachedAt ?? null};
        }, {items: [], cachedAt: null});
    },
    async write(items: CachedView[]) {
        await safe(() => Promise.all([set("library:items", items, store()), set("library:meta", {
            cachedAt: new Date().toISOString(),
            count: items.length
        }, store())]), undefined);
        emit();
    },
    async upsert(v: CachedView) {
        const {items} = await library.read();
        await library.write([v, ...items.filter((x) => x.id !== v.id)]);
    },
    async remove(id: string) {
        const {items} = await library.read();
        await library.write(items.filter((x) => x.id !== id));
    },
    clear: () => safe(() => entries<string, unknown>(store()).then((e) => delMany(e.map(([k]) => k as string), store())), undefined).then(emit),
};

export const assetCache = {
    get: (id: string) => safe(() => get<string>(`asset:${id}`, store()), undefined),
    set: (id: string, dataUrl: string) => safe(() => set(`asset:${id}`, dataUrl, store()), undefined),
};

async function ensureAsset(assetId: string | null | undefined) {
    if (!assetId) return;
    const url = await assetCache.get(assetId);
    if (url) await api.assets.put(url);
}

export const settingsCache = {
    read: () => safe(() => get<Settings>("settings", store()), undefined),
    write: (s: Settings) => safe(() => set("settings", s, store()), undefined),
};

export type PendingOp =
    | {
    opId: string;
    kind: "create";
    at: string;
    input: CreateInput & { id: string; opId: string };
    status: "pending" | "failed";
    error?: string
}
    | {
    opId: string;
    kind: "update";
    at: string;
    id: string;
    baseRev: number;
    base: QrView;
    patch: Record<string, unknown>;
    status: "pending" | "failed";
    error?: string
}
    | { opId: string; kind: "trash"; at: string; id: string; status: "pending" | "failed"; error?: string };

export const queue = {
    async list(): Promise<PendingOp[]> {
        return safe(async () => (await entries<string, PendingOp>(store())).filter(([k]) => String(k).startsWith("op:")).map(([, v]) => v).sort((a, b) => a.at.localeCompare(b.at)), []);
    },
    async put(op: PendingOp) {
        await set(`op:${op.opId}`, op, store());
        emit();
    },
    async remove(opId: string) {
        await safe(() => del(`op:${opId}`, store()), undefined);
        emit();
    },
};

export function optimisticView(input: CreateInput & { id: string }): CachedView {
    const now = new Date().toISOString();
    return {
        v: 1,
        id: input.id,
        name: input.name,
        description: input.description ?? "",
        type: input.type,
        mode: input.mode,
        fields: input.fields ?? {},
        payload: input.payload,
        slug: input.slug ?? null,
        style: input.style,
        tags: input.tags ?? [],
        folder: input.folder ?? null,
        favorite: input.favorite ?? false,
        pinned: input.pinned ?? false,
        status: input.status ?? "active",
        enabled: input.enabled ?? true,
        schedule: input.schedule ?? {activateAt: null, expiresAt: null, expireAfterSeconds: null},
        scanLimit: input.scanLimit ?? null,
        afterExpiry: input.afterExpiry ?? {message: null, redirectUrl: null},
        analytics: input.analytics ?? true,
        rev: 0,
        createdAt: now,
        updatedAt: now,
        hasPassword: Boolean(input.password),
        scans: 0,
        linkState: "ok",
        _pending: "create",
    };
}

export const isOnline = () => (typeof navigator === "undefined" ? true : navigator.onLine);

export async function saveNew(input: CreateInput): Promise<{ view: CachedView; queued: boolean }> {
    const id = input.id ?? newId();
    const opId = input.opId ?? newOpId();
    const withIds = {...input, id, opId, slug: input.mode === "dynamic" ? (input.slug ?? newSlug()) : undefined};
    if (isOnline()) {
        try {
            await ensureAsset(withIds.style.logo.assetId);
            const v = await api.codes.create(withIds);
            await library.upsert(v);
            return {view: v, queued: false};
        } catch (e) {
            if (!(e instanceof ApiClientError) || !e.retryable) throw e;
        }
    }
    const op: PendingOp = {opId, kind: "create", at: new Date().toISOString(), input: withIds, status: "pending"};
    await queue.put(op);
    const view = optimisticView(withIds);
    await library.upsert(view);
    return {view, queued: true};
}

export async function saveEdit(base: QrView, patch: Record<string, unknown>): Promise<{
    view: CachedView;
    queued: boolean
}> {
    const pendingCreate = (await queue.list()).find((op) => op.kind === "create" && op.input.id === base.id);
    if (pendingCreate?.kind === "create") {
        const input = {...pendingCreate.input, ...patch} as typeof pendingCreate.input;
        await queue.put({...pendingCreate, input, status: "pending", error: undefined});
        const view = optimisticView(input);
        await library.upsert(view);
        return {view, queued: true};
    }
    if (isOnline()) {
        try {
            await ensureAsset((patch.style as QrView["style"] | undefined)?.logo?.assetId);
            const v = await api.codes.update(base.id, {...patch, ifRev: base.rev} as never);
            await library.upsert(v);
            return {view: v, queued: false};
        } catch (e) {
            if (!(e instanceof ApiClientError) || !e.retryable) throw e;
        }
    }
    const ops = await queue.list();
    const existing = ops.find((o) => o.kind === "update" && o.id === base.id && o.status === "pending");
    const op: PendingOp = existing && existing.kind === "update"
        ? {...existing, patch: {...existing.patch, ...patch}}
        : {
            opId: newOpId(),
            kind: "update",
            at: new Date().toISOString(),
            id: base.id,
            baseRev: base.rev,
            base,
            patch,
            status: "pending"
        };
    await queue.put(op);
    const view: CachedView = {...base, ...(patch as object), _pending: "update"} as CachedView;
    await library.upsert(view);
    return {view, queued: true};
}

type SyncState = { syncing: boolean; lastResult: SyncResult | null };
let state: SyncState = {syncing: false, lastResult: null};
export const getSyncState = () => state;
export type SyncResult = {
    synced: number;
    failed: number;
    conflicts: { id: string; name: string; copyId: string }[];
    stopped: boolean
};

export async function flushQueue(): Promise<SyncResult> {
    const result: SyncResult = {synced: 0, failed: 0, conflicts: [], stopped: false};
    if (state.syncing || !isOnline()) return result;
    state = {...state, syncing: true};
    emit();
    try {
        for (const op of await queue.list()) {
            if (op.status === "failed") continue;
            try {
                await ensureAsset(op.kind === "create" ? op.input.style.logo.assetId : op.kind === "update" ? (op.patch.style as QrView["style"] | undefined)?.logo?.assetId : null);
                if (op.kind === "create") {
                    const v = await api.codes.create(op.input);
                    await library.upsert(v);
                } else if (op.kind === "update") {
                    try {
                        const v = await api.codes.update(op.id, {...op.patch, ifRev: op.baseRev} as never);
                        await library.upsert(v);
                    } catch (e) {
                        if (!(e instanceof ApiClientError) || e.code !== "REV_MISMATCH") throw e;
                        const merged = {...op.base, ...(op.patch as object)} as QrView;
                        const copy = await api.codes.create({
                            id: op.opId,
                            name: `${merged.name} (offline edit)`.slice(0, 120),
                            description: merged.description,
                            type: merged.type,
                            mode: merged.mode,
                            fields: merged.fields,
                            payload: merged.payload,
                            style: merged.style,
                            tags: merged.tags,
                            folder: merged.folder,
                            scanLimit: merged.scanLimit,
                            schedule: merged.schedule,
                            afterExpiry: merged.afterExpiry,
                            analytics: merged.analytics,
                            enabled: merged.enabled && (!op.base.hasPassword || typeof op.patch.password === "string"),
                            password: typeof op.patch.password === "string" ? op.patch.password : undefined,
                            status: merged.status,
                            favorite: merged.favorite,
                            pinned: merged.pinned,
                            opId: op.opId,
                        });
                        await library.upsert(copy);
                        const server = await api.codes.get(op.id).catch(() => null);
                        if (server) await library.upsert(server);
                        result.conflicts.push({id: op.id, name: merged.name, copyId: copy.id});
                    }
                } else {
                    await api.codes.remove(op.id);
                    await library.remove(op.id);
                }
                await queue.remove(op.opId);
                result.synced++;
            } catch (e) {
                if (e instanceof ApiClientError && e.retryable) {
                    result.stopped = true;
                    break;
                }
                const msg = e instanceof Error ? e.message : "Failed";
                await queue.put({...op, status: "failed", error: msg});
                if (op.kind === "create") await library.upsert({...(await optimisticFor(op)), _error: msg});
                result.failed++;
            }
        }
    } finally {
        state = {syncing: false, lastResult: result};
        emit();
    }
    if (result.synced > 0) {
        try {
            const {items} = await api.codes.all({status: "all"});
            const pending = (await library.read()).items.filter((v) => v._pending);
            await library.write([...pending, ...items.filter((v) => !pending.some((p) => p.id === v.id))]);
        } catch {
        }
    }
    return result;
}

const optimisticFor = async (op: Extract<PendingOp, { kind: "create" }>) => optimisticView(op.input);

export async function discardOp(op: PendingOp) {
    await queue.remove(op.opId);
    if (op.kind === "create") await library.remove(op.input.id);
}

export async function retryWithNewSlug(op: Extract<PendingOp, { kind: "create" }>) {
    await queue.put({...op, input: {...op.input, slug: newSlug()}, status: "pending", error: undefined});
    void flushQueue();
}

export function startSync(): () => void {
    const run = () => void flushQueue();
    const visible = () => {
        if (document.visibilityState === "visible") run();
    };
    window.addEventListener("online", run);
    document.addEventListener("visibilitychange", visible);
    const t = window.setInterval(run, 30_000);
    run();
    return () => {
        window.removeEventListener("online", run);
        document.removeEventListener("visibilitychange", visible);
        window.clearInterval(t);
    };
}
