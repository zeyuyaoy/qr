import {z} from "zod";
import {CONTENT_TYPES, type ContentType, DYNAMIC_TYPES} from "../schema";
import {checkDestination, withScheme} from "../url-safety";

export const BYTE_CAPACITY = {L: 2953, M: 2331, Q: 1663, H: 1273} as const;

const enc = new TextEncoder();
export const byteLength = (s: string) => enc.encode(s).length;
export const payloadFits = (payload: string, ecc: keyof typeof BYTE_CAPACITY) =>
    byteLength(payload) <= BYTE_CAPACITY[ecc];

const s = (max = 200) => z.string().trim().max(max);
const optional = (max = 200) => s(max).optional().default("");
const requiredUrl = z
    .string()
    .trim()
    .min(1, "Enter a URL")
    .superRefine((v, ctx) => {
        const c = checkDestination(withScheme(v));
        if (!c.ok) ctx.addIssue({code: "custom", message: c.reason});
    });

const pct = (v: string) => encodeURIComponent(v).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());

const wifiEsc = (v: string) => v.replace(/([\\;,:"])/g, "\\$1");
const vEsc = (v: string) => v.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");

export function zonedToUtc(local: string, timeZone: string): Date {
    const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(local);
    if (!m) throw new Error("Invalid date/time");
    const [y, mo, d, h, mi] = m.slice(1).map(Number) as [number, number, number, number, number];
    const asUtc = Date.UTC(y, mo - 1, d, h, mi);
    const offsetAt = (t: number) => {
        const parts = new Intl.DateTimeFormat("en-US", {
            timeZone,
            hourCycle: "h23",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
        }).formatToParts(new Date(t));
        const g = (k: string) => Number(parts.find((p) => p.type === k)?.value);
        return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second")) - t;
    };
    const first = asUtc - offsetAt(asUtc);
    return new Date(asUtc - offsetAt(first));
}

const icsDate = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const icsEsc = (v: string) => v.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");

const SOCIAL: Record<string, { label: string; base: string; hint: string }> = {
    instagram: {label: "Instagram", base: "https://instagram.com/", hint: "yourname"},
    x: {label: "X (Twitter)", base: "https://x.com/", hint: "yourname"},
    linkedin: {label: "LinkedIn", base: "https://www.linkedin.com/in/", hint: "your-profile"},
    github: {label: "GitHub", base: "https://github.com/", hint: "username"},
    facebook: {label: "Facebook", base: "https://facebook.com/", hint: "yourpage"},
    youtube: {label: "YouTube", base: "https://youtube.com/@", hint: "channel"},
    tiktok: {label: "TikTok", base: "https://www.tiktok.com/@", hint: "username"},
    bluesky: {label: "Bluesky", base: "https://bsky.app/profile/", hint: "name.bsky.social"},
    orcid: {label: "ORCID", base: "https://orcid.org/", hint: "0000-0002-1825-0097"},
    custom: {label: "Other (full URL)", base: "", hint: "https://…"},
};
export const SOCIAL_PLATFORMS = SOCIAL;

type TypeDef<S extends z.ZodType> = {
    label: string;
    description: string;
    schema: S;
    encode: (f: z.infer<S>) => string;
    example: Record<string, unknown>;
    dynamic: boolean;
};
const def = <S extends z.ZodType>(d: Omit<TypeDef<S>, "dynamic"> & { dynamic?: boolean }): TypeDef<S> => ({
    dynamic: false,
    ...d,
});

export const TYPES = {
    url: def({
        label: "Website URL",
        description: "Link to any web page.",
        dynamic: true,
        schema: z.object({url: requiredUrl}),
        encode: (f) => withScheme(f.url),
        example: {url: "https://example.com/menu?table=4"},
    }),
    text: def({
        label: "Plain text",
        description: "Any text up to ~2,000 characters.",
        schema: z.object({text: z.string().min(1, "Enter some text").max(2000)}),
        encode: (f) => f.text,
        example: {text: "Hello from QR Studio"},
    }),
    email: def({
        label: "Email",
        description: "Opens a pre-filled email.",
        schema: z.object({
            to: s(254).email("Enter a valid email address"),
            subject: optional(200),
            body: optional(1000),
        }),
        encode: (f) => {
            const q = [f.subject && `subject=${pct(f.subject)}`, f.body && `body=${pct(f.body)}`].filter(Boolean).join("&");
            return `mailto:${f.to}${q ? `?${q}` : ""}`;
        },
        example: {to: "hello@example.com", subject: "Hello", body: ""},
    }),
    phone: def({
        label: "Telephone",
        description: "Starts a phone call.",
        schema: z.object({
            number: s(30).regex(/^\+?[0-9 ()\-.]{3,30}$/, "Use digits, spaces and an optional leading +"),
        }),
        encode: (f) => `tel:${f.number.startsWith("+") ? "+" : ""}${f.number.replace(/\D/g, "")}`,
        example: {number: "+1 415 555 0132"},
    }),
    sms: def({
        label: "SMS",
        description: "Opens a text message (RFC 5724).",
        schema: z.object({
            number: s(30).regex(/^\+?[0-9 ()\-.]{3,30}$/, "Use digits, spaces and an optional leading +"),
            message: optional(500),
        }),
        encode: (f) =>
            `sms:${f.number.startsWith("+") ? "+" : ""}${f.number.replace(/\D/g, "")}${f.message ? `?body=${pct(f.message)}` : ""}`,
        example: {number: "+1 415 555 0132", message: "Hi!"},
    }),
    wifi: def({
        label: "Wi-Fi",
        description: "Join a network by scanning. Contains the password — treat the code as secret.",
        schema: z
            .object({
                ssid: s(32).min(1, "Network name is required"),
                password: z.string().max(63).optional().default(""),
                security: z.enum(["WPA", "WEP", "nopass"]).default("WPA"),
                hidden: z.boolean().default(false),
            })
            .superRefine((v, ctx) => {
                if (v.security === "WPA" && v.password.length > 0 && v.password.length < 8) {
                    ctx.addIssue({code: "custom", path: ["password"], message: "WPA passwords are 8–63 characters"});
                }
                if (v.security !== "nopass" && v.password.length === 0) {
                    ctx.addIssue({
                        code: "custom",
                        path: ["password"],
                        message: "Enter the password or choose “No password”"
                    });
                }
            }),
        encode: (f) =>
            `WIFI:T:${f.security};S:${wifiEsc(f.ssid)};${f.security === "nopass" ? "" : `P:${wifiEsc(f.password)};`}${f.hidden ? "H:true;" : ""};`,
        example: {ssid: "Home Network", password: "correct-horse-battery", security: "WPA", hidden: false},
    }),
    vcard: def({
        label: "vCard contact",
        description: "Share a contact card (vCard 3.0). Contains personal data.",
        schema: z
            .object({
                firstName: optional(60),
                lastName: optional(60),
                org: optional(100),
                title: optional(100),
                phone: optional(30),
                mobile: optional(30),
                email: s(254).email().optional().or(z.literal("")).default(""),
                url: optional(300),
                street: optional(120),
                city: optional(80),
                region: optional(80),
                postal: optional(20),
                country: optional(80),
                note: optional(300),
            })
            .refine((v) => v.firstName || v.lastName || v.org, {
                message: "Enter a name or organisation",
                path: ["firstName"]
            }),
        encode: (f) => {
            const L = ["BEGIN:VCARD", "VERSION:3.0", `N:${vEsc(f.lastName)};${vEsc(f.firstName)};;;`];
            L.push(`FN:${vEsc([f.firstName, f.lastName].filter(Boolean).join(" ") || f.org)}`);
            if (f.org) L.push(`ORG:${vEsc(f.org)}`);
            if (f.title) L.push(`TITLE:${vEsc(f.title)}`);
            if (f.phone) L.push(`TEL;TYPE=WORK,VOICE:${vEsc(f.phone)}`);
            if (f.mobile) L.push(`TEL;TYPE=CELL,VOICE:${vEsc(f.mobile)}`);
            if (f.email) L.push(`EMAIL;TYPE=INTERNET:${vEsc(f.email)}`);
            if (f.url) L.push(`URL:${vEsc(withScheme(f.url))}`);
            if (f.street || f.city || f.region || f.postal || f.country) {
                L.push(`ADR;TYPE=WORK:;;${vEsc(f.street)};${vEsc(f.city)};${vEsc(f.region)};${vEsc(f.postal)};${vEsc(f.country)}`);
            }
            if (f.note) L.push(`NOTE:${vEsc(f.note)}`);
            L.push("END:VCARD");
            return L.join("\r\n");
        },
        example: {
            firstName: "Ada",
            lastName: "Lovelace",
            org: "Analytical Engines",
            email: "ada@example.com",
            mobile: "+44 20 7946 0958"
        },
    }),
    event: def({
        label: "Calendar event",
        description: "Adds an event (iCalendar). Times use the time zone you pick.",
        schema: z
            .object({
                title: s(200).min(1, "Enter a title"),
                start: z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/, "Pick a start"),
                end: z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/).optional().or(z.literal("")).default(""),
                allDay: z.boolean().default(false),
                timezone: s(64).default("UTC"),
                location: optional(200),
                description: optional(500),
            })
            .superRefine((v, ctx) => {
                if (v.end && v.end < v.start) ctx.addIssue({
                    code: "custom",
                    path: ["end"],
                    message: "End must be after start"
                });
                try {
                    new Intl.DateTimeFormat("en-US", {timeZone: v.timezone});
                } catch {
                    ctx.addIssue({code: "custom", path: ["timezone"], message: "Unknown time zone"});
                }
            }),
        encode: (f) => {
            const L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//QR Studio//EN", "BEGIN:VEVENT"];
            const day = (v: string) => v.slice(0, 10).replace(/-/g, "");
            let stamp: string;
            if (f.allDay) {
                const endDay = new Date(Date.UTC(+(f.end || f.start).slice(0, 4), +(f.end || f.start).slice(5, 7) - 1, +(f.end || f.start).slice(8, 10) + 1));
                L.push(`DTSTART;VALUE=DATE:${day(f.start)}`, `DTEND;VALUE=DATE:${endDay.toISOString().slice(0, 10).replace(/-/g, "")}`);
                stamp = `${day(f.start)}T000000Z`;
            } else {
                const start = zonedToUtc(f.start.length === 10 ? `${f.start}T00:00` : f.start, f.timezone);
                const end = f.end ? zonedToUtc(f.end.length === 10 ? `${f.end}T00:00` : f.end, f.timezone) : new Date(start.getTime() + 3600_000);
                L.push(`DTSTART:${icsDate(start)}`, `DTEND:${icsDate(end)}`);
                stamp = icsDate(start);
            }
            L.splice(4, 0, `UID:${hash32(f.title + f.start)}@qr-studio`, `DTSTAMP:${stamp}`);
            L.push(`SUMMARY:${icsEsc(f.title)}`);
            if (f.location) L.push(`LOCATION:${icsEsc(f.location)}`);
            if (f.description) L.push(`DESCRIPTION:${icsEsc(f.description)}`);
            L.push("END:VEVENT", "END:VCALENDAR");
            return L.join("\r\n");
        },
        example: {
            title: "Launch party",
            start: "2027-03-14T18:00",
            end: "2027-03-14T21:00",
            timezone: "UTC",
            allDay: false
        },
    }),
    geo: def({
        label: "Location",
        description: "Opens a map at coordinates (RFC 5870).",
        schema: z.object({
            lat: z.coerce.number().min(-90).max(90),
            lng: z.coerce.number().min(-180).max(180),
            label: optional(100),
        }),
        encode: (f) => `geo:${f.lat},${f.lng}${f.label ? `?q=${f.lat},${f.lng}(${pct(f.label)})` : ""}`,
        example: {lat: 37.7749, lng: -122.4194, label: "San Francisco"},
    }),
    whatsapp: def({
        label: "WhatsApp",
        description: "Start a chat via wa.me.",
        dynamic: true,
        schema: z.object({
            phone: s(30).regex(/^\+?[0-9 ()\-.]{6,30}$/, "Use international format, e.g. +14155550132"),
            message: optional(500),
        }),
        encode: (f) => `https://wa.me/${f.phone.replace(/\D/g, "")}${f.message ? `?text=${pct(f.message)}` : ""}`,
        example: {phone: "+14155550132", message: "Hello!"},
    }),
    social: def({
        label: "Social profile",
        description: "Link to a profile on a popular network.",
        dynamic: true,
        schema: z
            .object({
                platform: z.enum(Object.keys(SOCIAL) as [string, ...string[]]),
                handle: s(300).min(1, "Enter a handle or URL"),
            })
            .superRefine((v, ctx) => {
                if (v.platform === "custom") {
                    const c = checkDestination(withScheme(v.handle));
                    if (!c.ok) ctx.addIssue({code: "custom", path: ["handle"], message: c.reason});
                } else if (!/^[A-Za-z0-9._-]{1,100}$/.test(v.handle.replace(/^@/, ""))) {
                    ctx.addIssue({code: "custom", path: ["handle"], message: "Enter just the handle, without a URL"});
                }
            }),
        encode: (f) => (f.platform === "custom" ? withScheme(f.handle) : `${SOCIAL[f.platform]!.base}${f.handle.replace(/^@/, "")}`),
        example: {platform: "github", handle: "octocat"},
    }),
    doi: def({
        label: "Publication (DOI)",
        description: "Link to a paper via doi.org.",
        dynamic: true,
        schema: z.object({
            doi: s(300).transform((v) => v.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").replace(/^doi:\s*/i, "")).pipe(
                z.string().regex(/^10\.\d{4,9}\/\S+$/, "A DOI looks like 10.1038/nature12373"),
            ),
        }),
        encode: (f) => `https://doi.org/${encodeURI(f.doi).replace(/#/g, "%23").replace(/\?/g, "%3F")}`,
        example: {doi: "10.1038/nature12373"},
    }),
} satisfies Record<ContentType, TypeDef<z.ZodType>>;

function hash32(str: string): string {
    let h1 = 0xdeadbeef ^ str.length;
    let h2 = 0x41c6ce57 ^ str.length;
    for (let i = 0; i < str.length; i++) {
        const c = str.charCodeAt(i);
        h1 = Math.imul(h1 ^ c, 2654435761);
        h2 = Math.imul(h2 ^ c, 1597334677);
    }
    return ((h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0"));
}

export type EncodeResult =
    | { ok: true; payload: string }
    | { ok: false; errors: Record<string, string> };

export function encodePayload(type: ContentType, fields: Record<string, unknown>): EncodeResult {
    const t = TYPES[type];
    const parsed = t.schema.safeParse(fields);
    if (!parsed.success) {
        const errors: Record<string, string> = {};
        for (const issue of parsed.error.issues) {
            const k = String(issue.path[0] ?? "_");
            errors[k] ??= issue.message;
        }
        return {ok: false, errors};
    }
    try {
        return {ok: true, payload: t.encode(parsed.data as never)};
    } catch (e) {
        return {ok: false, errors: {_: e instanceof Error ? e.message : "Could not encode"}};
    }
}

export const isDynamicCapable = (type: ContentType) => DYNAMIC_TYPES.includes(type);
export const CONTENT_TYPE_OPTIONS = CONTENT_TYPES.map((id) => ({
    id,
    label: TYPES[id].label,
    description: TYPES[id].description,
    dynamic: TYPES[id].dynamic,
}));

export const shortUrl = (appUrl: string, slug: string) => `${appUrl.replace(/\/+$/, "")}/r/${slug}`;

export const qrData = (r: { mode: "static" | "dynamic"; payload: string; slug: string | null }, appUrl: string) =>
    r.mode === "dynamic" && r.slug ? shortUrl(appUrl, r.slug) : r.payload;

export const clientAppUrl = () => process.env.NEXT_PUBLIC_APP_URL || (typeof location !== "undefined" ? location.origin : "http://localhost:3000");
