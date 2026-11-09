"use client";
import type {AnalyticsReport} from "../analytics-report";
import type {ImportReport, IndexReport} from "../redis/maintenance";
import type {RestoreReport} from "../backup/snapshot";
import type {BackupRun, BackupStatus, Freshness} from "../backup/run";
import type {RemoteSnapshot} from "../backup/github";
import type {LibraryQuery} from "../library-query";
import type {
    ApiErrorCode,
    ApiResult,
    CreateInput,
    Folder,
    QrStyle,
    QrView,
    Settings,
    Template,
    UpdateInput
} from "../schema";
import type {buildStatus} from "../server-status";

export type StatusData = Awaited<ReturnType<typeof buildStatus>> & { user: { email: string } };

export class ApiClientError extends Error {
    constructor(public code: ApiErrorCode | "OFFLINE", message: string, public status = 0, public details?: unknown) {
        super(message);
    }

    get retryable() {
        return this.code === "OFFLINE" || this.code === "REDIS_UNAVAILABLE" || this.status >= 502;
    }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
        res = await fetch(path, {
            method,
            credentials: "same-origin",
            headers: {"x-qr-csrf": "1", ...(body !== undefined ? {"Content-Type": "application/json"} : {})},
            body: body !== undefined ? JSON.stringify(body) : undefined,
            cache: "no-store",
        });
    } catch {
        throw new ApiClientError("OFFLINE", "You appear to be offline");
    }
    if (res.status === 401 && typeof window !== "undefined") {
        await import("./session").then((m) => m.wipeLocalPrivateData());
        window.location.assign(`/login?next=${encodeURIComponent(location.pathname)}`);
    }
    let json: ApiResult<T>;
    try {
        json = (await res.json()) as ApiResult<T>;
    } catch {
        throw new ApiClientError(res.status >= 500 ? "REDIS_UNAVAILABLE" : "INTERNAL", `Unexpected response (${res.status})`, res.status);
    }
    if (!json.ok) throw new ApiClientError(json.error.code, json.error.message, res.status, json.error.details);
    return json.data;
}

const qs = (o: Record<string, string | number | boolean | undefined | null>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== "" && v !== false) p.set(k, v === true ? "1" : String(v));
    const s = p.toString();
    return s ? `?${s}` : "";
};

export type BatchAction =
    "archive"
    | "restore"
    | "trash"
    | "purge"
    | "favorite"
    | "unfavorite"
    | "pin"
    | "unpin"
    | "enable"
    | "disable"
    | "tag-add"
    | "tag-remove"
    | "move-folder"
    | "apply-template";
export type BackupInfo = {
    configured: boolean;
    freshness: Freshness;
    status: BackupStatus;
    snapshots: RemoteSnapshot[];
    listError: string | null
};
export type {BackupRun, AnalyticsReport, ImportReport, IndexReport, RestoreReport};

let pendingStatus: Promise<StatusData> | undefined;

export const api = {
    status: () => (pendingStatus ??= call<StatusData>("GET", "/api/status").finally(() => {
        pendingStatus = undefined;
    })),
    admin: {
        init: () => call<unknown>("POST", "/api/admin/init", {confirm: "start-empty"}),
        repair: (apply: boolean) => call<IndexReport>("POST", "/api/admin/repair", {apply}),
    },
    codes: {
        all: async (q: LibraryQuery = {}) => {
            const items: QrView[] = [];
            let page: { items: QrView[]; total: number; unreadable: string[] };
            do {
                page = await call("GET", `/api/codes${qs({...q, limit: 2000, offset: items.length})}`);
                items.push(...page.items);
            } while (page.items.length && items.length < page.total);
            return {...page, items};
        },
        list: (q: LibraryQuery & { limit?: number; offset?: number } = {}) =>
            call<{ items: QrView[]; total: number; unreadable: string[] }>("GET", `/api/codes${qs({...q})}`),
        get: (id: string) => call<QrView>("GET", `/api/codes/${id}`),
        create: (input: CreateInput) => call<QrView>("POST", "/api/codes", input),
        update: (id: string, patch: UpdateInput) => call<QrView>("PATCH", `/api/codes/${id}`, patch),
        remove: (id: string, permanent = false) => call<unknown>("DELETE", `/api/codes/${id}${permanent ? "?permanent=1" : ""}`),
        duplicate: (id: string) => call<QrView>("POST", `/api/codes/${id}/duplicate`),
        batch: (ids: string[], action: BatchAction, value?: string | null) =>
            call<{
                results: { id: string; ok: boolean; error?: string }[];
                succeeded: number
            }>("POST", "/api/codes/batch", {ids, action, value}),
        bulkCreate: (items: CreateInput[]) => call<{
            results: ApiResult<QrView>[];
            created: number
        }>("POST", "/api/codes/bulk", {items}),
        analytics: (id: string, days = 30) => call<AnalyticsReport>("GET", `/api/codes/${id}/analytics?days=${days}`),
    },
    folders: {
        list: () => call<(Folder & { count: number })[]>("GET", "/api/folders"),
        create: (name: string, color?: string | null) => call<Folder>("POST", "/api/folders", {
            name,
            color: color ?? null
        }),
        update: (id: string, name: string, color?: string | null) => call<Folder>("PATCH", `/api/folders/${id}`, {
            name,
            color: color ?? null
        }),
        remove: (id: string) => call<{ unfiled: number }>("DELETE", `/api/folders/${id}`),
    },
    tags: {
        list: () => call<{ tag: string; count: number }[]>("GET", "/api/tags"),
        rename: (from: string, to: string | null) => call<{ updated: number }>("POST", "/api/tags", {from, to}),
    },
    templates: {
        list: () => call<Template[]>("GET", "/api/templates"),
        create: (name: string, style: QrStyle) => call<Template>("POST", "/api/templates", {name, style}),
        update: (id: string, name: string, style: QrStyle) => call<Template>("PATCH", `/api/templates/${id}`, {
            name,
            style
        }),
        remove: (id: string) => call<unknown>("DELETE", `/api/templates/${id}`),
    },
    settings: {
        get: () => call<Settings>("GET", "/api/settings"),
        put: (s: Settings) => call<Settings>("PUT", "/api/settings", s),
    },
    assets: {
        put: (dataUrl: string) => call<{ id: string }>("POST", "/api/assets", {dataUrl}),
        get: (id: string) => call<{ dataUrl: string }>("GET", `/api/assets/${id}`),
    },
    analytics: {
        get: (p: { from?: string; to?: string; id?: string }) => call<AnalyticsReport>("GET", `/api/analytics${qs(p)}`),
        csvUrl: (p: { from?: string; to?: string; id?: string }) => `/api/analytics${qs({...p, format: "csv"})}`,
        reset: (id?: string) => call<{ deleted: number }>("POST", "/api/analytics/reset", {id, confirm: "reset"}),
    },
    library: {
        exportUrl: (format: "json" | "csv") => `/api/library/export?format=${format}`,
        import: (data: unknown, o: {
            dryRun: boolean;
            policy: "skip" | "overwrite" | "duplicate"
        }) => call<ImportReport>("POST", "/api/library/import", {data, ...o}),
    },
    backup: {
        info: () => call<BackupInfo>("GET", "/api/backup"),
        run: () => call<BackupRun>("POST", "/api/backup"),
        downloadUrl: "/api/backup/download",
        restore: (o: {
            source: { github: string } | { text: string };
            dryRun: boolean;
            mode: "merge" | "replace";
            prefer: "newer" | "snapshot" | "existing";
            confirm?: string
        }) =>
            call<{
                report: RestoreReport;
                envelope: { createdAt: string; recordCount: number; schemaVersion: number }
            }>("POST", "/api/backup/restore", o),
    },
};
