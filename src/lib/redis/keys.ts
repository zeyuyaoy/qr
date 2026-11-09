import {env} from "../env";

export const prefix = () => env.keyPrefix();
const p = (s: string) => `${prefix()}${s}`;

export const K = {
    code: (id: string) => p(`code:${id}`),
    slug: (slug: string) => p(`slug:${slug}`),
    count: (id: string) => p(`count:${id}`),
    indexCodes: () => p("index:codes"),
    indexFolder: (id: string) => p(`index:folder:${id}`),
    indexTag: (tag: string) => p(`index:tag:${tag}`),
    indexTags: () => p("index:tags"),
    indexFolders: () => p("index:folders"),
    indexTemplates: () => p("index:templates"),
    folder: (id: string) => p(`folder:${id}`),
    template: (id: string) => p(`template:${id}`),
    settings: () => p("settings"),
    meta: () => p("meta:schema"),
    stats: (id: string, day: string) => p(`stats:${id}:${day}`),
    statsAll: (day: string) => p(`stats:all:${day}`),
    recent: () => p("recent"),
    asset: (hash: string) => p(`asset:${hash}`),
    rl: (bucket: string) => p(`rl:${bucket}`),
    backupStatus: () => p("backup:status"),
    backupLock: () => p("backup:lock"),
};

export function assertOwnKey(key: string): string {
    if (!key.startsWith(prefix())) throw new Error("Refusing to touch a key outside the QR Studio namespace");
    return key;
}

export const dayKey = (d: Date | number) => new Date(d).toISOString().slice(0, 10).replace(/-/g, "");
