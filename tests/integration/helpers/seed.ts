import {DEST, dynamicUrl, pngDataUrl, staticText, vcard, wifi} from "./fixtures";
import {acceptScan, createCode, putAsset, saveFolder, saveSettings, saveTemplate, updateCode} from "@/lib/redis/repo";
import {defaultStyle} from "@/lib/schema";

export const SECRET_DEST = "https://secret-destination.example/path?token=abc123";

export async function seedLibrary() {
    const work = await saveFolder({name: "Work stuff", color: "#112233"});
    const home = await saveFolder({name: "Personal"});
    const assetId = await putAsset(pngDataUrl());
    const logoStyle = {...defaultStyle(), logo: {...defaultStyle().logo, assetId}};
    const template = await saveTemplate({name: "Brand template", style: logoStyle});
    const settings = await saveSettings({brand: {name: "Acme Corp"}, analytics: {retentionDays: 45}});

    const alpha = await createCode(dynamicUrl({
        name: "Alpha Menu",
        slug: "bk-alpha",
        payload: SECRET_DEST,
        tags: ["t1", "t2"],
        folder: work.id,
        password: "pw-secret1",
        favorite: true
    }));
    const beta = await createCode(dynamicUrl({
        name: "Beta Promo",
        slug: "bk-beta",
        payload: DEST,
        tags: ["t2"],
        style: logoStyle,
        scanLimit: 100
    }));
    const gamma = await createCode(wifi({name: "Guest wifi", folder: home.id}));
    const delta = await createCode(vcard({name: "Ada contact"}));
    const eps = await createCode(staticText({name: "Plain note", tags: ["t3"]}));
    const trashed = await updateCode((await createCode(dynamicUrl({
        name: "Old promo",
        slug: "bk-old"
    }))).id, {status: "trashed"});

    for (let i = 0; i < 3; i++) await acceptScan({
        id: alpha.id,
        limit: null,
        analytics: true,
        retentionDays: 45,
        device: "mobile",
        country: ""
    });
    await acceptScan({id: beta.id, limit: 100, analytics: true, retentionDays: 45, device: "desktop", country: ""});

    return {
        work,
        home,
        assetId,
        template,
        settings,
        alpha,
        beta,
        gamma,
        delta,
        eps,
        trashed,
        ids: [alpha.id, beta.id, gamma.id, delta.id, eps.id, trashed.id].sort()
    };
}

export type Seeded = Awaited<ReturnType<typeof seedLibrary>>;

export function normalize(dump: Record<string, unknown>): Record<string, unknown> {
    const walk = (v: unknown): unknown => {
        if (typeof v === "string" && /^[{[]/.test(v)) {
            try {
                return walk(JSON.parse(v));
            } catch {
                return v;
            }
        }
        if (Array.isArray(v)) return v.map(walk);
        if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
        return v;
    };
    return walk(dump) as Record<string, unknown>;
}
