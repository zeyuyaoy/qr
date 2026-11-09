import qrcode from "qrcode-generator";
import type {Options as StylingOptions} from "qr-code-styling";
import {type QrStyle, styleSchema} from "../schema";

export type Preset = { id: string; name: string; style: Partial<QrStyle> };

const g = (from: string, to: string, rotation = 45, type: "linear" | "radial" = "linear") => ({
    enabled: true,
    type,
    from,
    to,
    rotation,
});

export const PRESETS: Preset[] = [
    {id: "classic", name: "Classic", style: {fg: "#111111", bg: "#ffffff"}},
    {
        id: "soft",
        name: "Soft dots",
        style: {fg: "#1f2937", bg: "#ffffff", dots: "dots", finderOuter: "extra-rounded", finderInner: "dot"}
    },
    {
        id: "rounded",
        name: "Rounded",
        style: {fg: "#0f172a", bg: "#f8fafc", dots: "rounded", finderOuter: "extra-rounded", finderInner: "dot"}
    },
    {
        id: "ocean",
        name: "Ocean",
        style: {
            fg: "#0b3b8c",
            bg: "#ffffff",
            dots: "rounded",
            gradient: g("#0b3b8c", "#0e7490"),
            finderColor: "#0b3b8c",
            finderOuter: "extra-rounded",
            finderInner: "dot"
        }
    },
    {
        id: "sunset",
        name: "Sunset",
        style: {
            fg: "#9a1b1b",
            bg: "#fffaf5",
            dots: "classy-rounded",
            gradient: g("#9a1b1b", "#7c2d92", 60),
            finderOuter: "extra-rounded"
        }
    },
    {
        id: "forest",
        name: "Forest",
        style: {fg: "#14532d", bg: "#f7fee7", dots: "extra-rounded", finderOuter: "extra-rounded", finderInner: "dot"}
    },
    {
        id: "indigo",
        name: "Indigo",
        style: {fg: "#3730a3", bg: "#ffffff", dots: "classy", finderColor: "#1e1b4b", finderInnerColor: "#3730a3"}
    },
    {id: "ink", name: "Ink on transparent", style: {fg: "#000000", transparent: true}},
];

export const presetStyle = (id: string): QrStyle => {
    const p = PRESETS.find((x) => x.id === id) ?? PRESETS[0]!;
    return styleSchema.parse({...p.style, preset: p.id});
};

const utf8 = new TextEncoder();

export function moduleCount(bytes: string, ecc: QrStyle["ecc"]): number {
    const qr = qrcode(0, ecc);
    qr.addData(bytes, "Byte");
    qr.make();
    return qr.getModuleCount();
}

export function marginPx(size: number, modules: number, q: number): number {
    return Math.round((q * size) / (modules + 2 * q));
}

export function toStylingOptions(
    data: string,
    style: QrStyle,
    opts: { size?: number; logoUrl?: string | null } = {},
): StylingOptions {
    const size = opts.size ?? style.size;
    const bytes = String.fromCharCode(...utf8.encode(data));
    const modules = moduleCount(bytes, style.ecc);
    const dotColor = style.fg;
    const grad = style.gradient.enabled
        ? {
            type: style.gradient.type,
            rotation: (style.gradient.rotation * Math.PI) / 180,
            colorStops: [
                {offset: 0, color: style.gradient.from},
                {offset: 1, color: style.gradient.to},
            ],
        }
        : undefined;
    const hasLogo = Boolean(opts.logoUrl);
    return {
        width: size,
        height: size,
        type: "svg",
        data: bytes,
        margin: marginPx(size, modules, style.quietZone),
        qrOptions: {errorCorrectionLevel: style.ecc, mode: "Byte"},
        dotsOptions: {type: style.dots, color: dotColor, ...(grad ? {gradient: grad} : {})},
        cornersSquareOptions: {
            type: style.finderOuter,
            color: style.finderColor ?? (grad ? style.gradient.from : dotColor)
        },
        cornersDotOptions: {
            type: style.finderInner,
            color: style.finderInnerColor ?? style.finderColor ?? (grad ? style.gradient.from : dotColor)
        },
        backgroundOptions: {color: style.transparent ? "rgba(0,0,0,0)" : style.bg},
        ...(hasLogo
            ? {
                image: opts.logoUrl!,
                imageOptions: {
                    saveAsBlob: false,
                    hideBackgroundDots: style.logo.hideDots,
                    imageSize: style.logo.size,
                    margin: style.logo.background ? 0 : Math.round((style.logo.padding * size) / 1000),
                    crossOrigin: "anonymous",
                },
            }
            : {}),
    };
}

export function renderKey(data: string, style: QrStyle, logoUrl?: string | null): string {
    return JSON.stringify([data, style, logoUrl ? logoUrl.length : 0, logoUrl?.slice(-24) ?? ""]);
}
