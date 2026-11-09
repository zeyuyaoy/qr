import {z} from "zod";

export const SCHEMA_VERSION = 1;

export const CONTENT_TYPES = [
    "url",
    "text",
    "email",
    "phone",
    "sms",
    "wifi",
    "vcard",
    "event",
    "geo",
    "whatsapp",
    "social",
    "doi",
] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

export const DYNAMIC_TYPES: readonly ContentType[] = ["url", "social", "doi", "whatsapp"];
export const SENSITIVE_TYPES: readonly ContentType[] = ["wifi", "vcard"];

export const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a #RRGGBB colour");
const idRe = /^[a-z0-9]{8,24}$/;
export const idSchema = z.string().regex(idRe, "Invalid id");
export const slugSchema = z
    .string()
    .min(3)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9_-]*$/, "Lowercase letters, digits, - and _ only");
const isoDate = z.string().datetime({offset: true});
export const tagSchema = z
    .string()
    .trim()
    .toLowerCase()
    .min(1)
    .max(32)
    .regex(/^[a-z0-9][a-z0-9 _-]*$/, "Letters, digits, space, - and _ only");

export const DOT_TYPES = ["square", "dots", "rounded", "extra-rounded", "classy", "classy-rounded"] as const;
export const FINDER_OUTER = ["square", "dot", "extra-rounded"] as const;
export const FINDER_INNER = ["square", "dot"] as const;
export const FORMATS = ["png", "svg", "webp", "jpeg"] as const;
export type ExportFormat = (typeof FORMATS)[number];

export const styleSchema = z.object({
    fg: hex.default("#111111"),
    bg: hex.default("#ffffff"),
    transparent: z.boolean().default(false),
    gradient: z
        .object({
            enabled: z.boolean().default(false),
            type: z.enum(["linear", "radial"]).default("linear"),
            from: hex.default("#111111"),
            to: hex.default("#4f46e5"),
            rotation: z.number().min(0).max(360).default(45),
        })
        .default({enabled: false, type: "linear", from: "#111111", to: "#4f46e5", rotation: 45}),
    dots: z.enum(DOT_TYPES).default("square"),
    finderOuter: z.enum(FINDER_OUTER).default("square"),
    finderInner: z.enum(FINDER_INNER).default("square"),
    finderColor: hex.nullable().default(null),
    finderInnerColor: hex.nullable().default(null),
    ecc: z.enum(["L", "M", "Q", "H"]).default("M"),
    quietZone: z.number().int().min(0).max(16).default(4),
    size: z.number().int().min(128).max(4096).default(1024),
    logo: z
        .object({
            assetId: z.string().regex(/^[a-f0-9]{16,64}$/).nullable().default(null),
            size: z.number().min(0.05).max(0.4).default(0.2),
            padding: z.number().min(0).max(40).default(6),
            background: hex.nullable().default("#ffffff"),
            hideDots: z.boolean().default(true),
        })
        .default({assetId: null, size: 0.2, padding: 6, background: "#ffffff", hideDots: true}),
    preset: z.string().max(40).nullable().default(null),
});
export type QrStyle = z.infer<typeof styleSchema>;
export const defaultStyle = (): QrStyle => styleSchema.parse({});

export const settingsSchema = z.object({
    v: z.literal(1).default(1),
    defaultStyle: styleSchema.default(defaultStyle()),
    format: z.enum(FORMATS).default("png"),
    size: z.number().int().min(128).max(4096).default(1024),
    mode: z.enum(["static", "dynamic"]).default("static"),
    theme: z.enum(["light", "dark", "system"]).default("system"),
    timezone: z.string().max(64).default("UTC"),
    filenameTemplate: z.string().max(80).default("{name}"),
    analytics: z
        .object({
            enabled: z.boolean().default(true),
            devices: z.boolean().default(true),
            geo: z.boolean().default(false),
            retentionDays: z.number().int().min(7).max(365).default(90),
        })
        .default({enabled: true, devices: true, geo: false, retentionDays: 90}),
    brand: z
        .object({
            name: z.string().max(60).default("QR Studio"),
            accent: hex.default("#4f46e5"),
            expiredTitle: z.string().max(80).default("This link has expired"),
            expiredMessage: z.string().max(280).default("The owner of this QR code has retired this link."),
            footer: z.string().max(120).default(""),
        })
        .default({
            name: "QR Studio",
            accent: "#4f46e5",
            expiredTitle: "This link has expired",
            expiredMessage: "The owner of this QR code has retired this link.",
            footer: "",
        }),
    updatedAt: isoDate.optional(),
});
export type Settings = z.infer<typeof settingsSchema>;
export const defaultSettings = (): Settings => settingsSchema.parse({});

export const scheduleSchema = z.object({
    activateAt: isoDate.nullable().default(null),
    expiresAt: isoDate.nullable().default(null),
    expireAfterSeconds: z.number().int().min(60).max(60 * 60 * 24 * 3650).nullable().default(null),
});

const httpUrlLoose = z.string().max(2048);

export const qrRecordSchema = z.object({
    v: z.literal(SCHEMA_VERSION),
    id: idSchema,
    opId: z.string().max(40).optional(),
    name: z.string().trim().min(1).max(120),
    description: z.string().max(500).default(""),
    type: z.enum(CONTENT_TYPES),
    mode: z.enum(["static", "dynamic"]),
    fields: z.record(z.string(), z.unknown()).default({}),
    payload: z.string().min(1).max(4000),
    slug: slugSchema.nullable().default(null),
    style: styleSchema,
    tags: z.array(tagSchema).max(20).default([]),
    folder: idSchema.nullable().default(null),
    favorite: z.boolean().default(false),
    pinned: z.boolean().default(false),
    status: z.enum(["active", "archived", "trashed"]).default("active"),
    enabled: z.boolean().default(true),
    schedule: scheduleSchema.default({activateAt: null, expiresAt: null, expireAfterSeconds: null}),
    scanLimit: z.number().int().min(1).max(10_000_000).nullable().default(null),
    password: z.object({hash: z.string().max(300), setAt: isoDate}).nullable().default(null),
    afterExpiry: z
        .object({
            message: z.string().max(280).nullable().default(null),
            redirectUrl: httpUrlLoose.nullable().default(null),
        })
        .default({message: null, redirectUrl: null}),
    analytics: z.boolean().default(true),
    rev: z.number().int().min(1),
    createdAt: isoDate,
    updatedAt: isoDate,
});
export type QrRecord = z.infer<typeof qrRecordSchema>;

export type QrView = Omit<QrRecord, "password"> & {
    hasPassword: boolean;
    scans: number;
    linkState: LinkState["kind"];
};

export const folderSchema = z.object({
    id: idSchema,
    name: z.string().trim().min(1).max(60),
    color: hex.nullable().default(null),
    createdAt: isoDate,
    updatedAt: isoDate,
});
export type Folder = z.infer<typeof folderSchema>;

export const templateSchema = z.object({
    id: idSchema,
    name: z.string().trim().min(1).max(60),
    style: styleSchema,
    createdAt: isoDate,
    updatedAt: isoDate,
});
export type Template = z.infer<typeof templateSchema>;

export type LinkState =
    | { kind: "ok" }
    | { kind: "not_found" }
    | { kind: "removed" }
    | { kind: "paused" }
    | { kind: "not_yet"; activateAt: string }
    | { kind: "expired"; at: string }
    | { kind: "exhausted" };

const writableFields = qrRecordSchema.omit({
    v: true,
    id: true,
    opId: true,
    rev: true,
    createdAt: true,
    updatedAt: true,
    password: true,
});

export const createInput = writableFields
    .partial({
        description: true,
        fields: true,
        slug: true,
        tags: true,
        folder: true,
        favorite: true,
        pinned: true,
        status: true,
        enabled: true,
        schedule: true,
        scanLimit: true,
        afterExpiry: true,
        analytics: true,
    })
    .extend({
        id: idSchema.optional(),
        opId: z.string().max(40).optional(),
        password: z.string().min(4).max(128).nullable().optional(),
    });
export type CreateInput = z.infer<typeof createInput>;

const updateExtras = {
    ifRev: z.number().int().min(1),
    password: z.string().min(4).max(128).nullable().optional(),
};
const updateShape = writableFields.partial().extend(updateExtras);
export const updateInput = z.object(
    Object.fromEntries(
        Object.entries(updateShape.shape).map(([k, v]) => {
            const inner = v instanceof z.ZodOptional ? v.unwrap() : null;
            return [k, inner instanceof z.ZodDefault ? inner.unwrap().optional() : v];
        }),
    ),
) as unknown as typeof updateShape;
export type UpdateInput = z.infer<typeof updateInput>;

export const API_ERROR_CODES = [
    "UNAUTHENTICATED",
    "FORBIDDEN",
    "BAD_REQUEST",
    "NOT_FOUND",
    "CONFLICT",
    "SLUG_TAKEN",
    "REV_MISMATCH",
    "RATE_LIMITED",
    "REDIS_UNAVAILABLE",
    "RECOVERY_REQUIRED",
    "PAYLOAD_TOO_LARGE",
    "NOT_CONFIGURED",
    "INTERNAL",
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

type ApiOk<T> = { ok: true; data: T };
type ApiErr = { ok: false; error: { code: ApiErrorCode; message: string; details?: unknown } };
export type ApiResult<T> = ApiOk<T> | ApiErr;
