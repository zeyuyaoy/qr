import type {QrStyle} from "../schema";
import {BYTE_CAPACITY, byteLength} from "./payload";

type Severity = "error" | "warn" | "info";
export type ReadabilityIssue = { id: string; severity: Severity; message: string };

export function luminance(hexColor: string): number {
    const n = parseInt(hexColor.slice(1), 16);
    const f = (c: number) => {
        const v = c / 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f((n >> 16) & 255) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255);
}

export function contrast(a: string, b: string): number {
    const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
    return (l1 + 0.05) / (l2 + 0.05);
}

const RECOVERY = {L: 0.07, M: 0.15, Q: 0.25, H: 0.3} as const;

export function checkReadability(style: QrStyle, payload: string, hasLogo: boolean): ReadabilityIssue[] {
    const out: ReadabilityIssue[] = [];
    const colours = style.gradient.enabled ? [style.gradient.from, style.gradient.to] : [style.fg];
    const worst = Math.min(...colours.map((c) => contrast(c, style.bg)));
    if (style.transparent) {
        out.push({
            id: "transparent",
            severity: "info",
            message: "Transparent background: make sure it is placed on a light, plain surface."
        });
    } else {
        if (worst < 3) out.push({
            id: "contrast",
            severity: "error",
            message: `Low contrast (${worst.toFixed(1)}:1). Use at least 4:1 so scanners can find the modules.`
        });
        else if (worst < 4.5) out.push({
            id: "contrast",
            severity: "warn",
            message: `Contrast is ${worst.toFixed(1)}:1. Aim for 4.5:1 or higher.`
        });
        const dots = Math.min(...colours.map(luminance));
        if (luminance(style.bg) < dots) out.push({
            id: "inverted",
            severity: "warn",
            message: "Light-on-dark codes are not read by some older scanners."
        });
    }
    for (const [name, c] of [["Finder pattern", style.finderColor], ["Finder centre", style.finderInnerColor]] as const) {
        if (c && !style.transparent && contrast(c, style.bg) < 3) {
            out.push({
                id: `finder-${name}`,
                severity: "error",
                message: `${name} colour has too little contrast with the background.`
            });
        }
    }
    if (style.quietZone < 2) out.push({
        id: "quiet",
        severity: "error",
        message: "Quiet zone is too small; scanners need a clear border (4 modules recommended)."
    });
    else if (style.quietZone < 4) out.push({
        id: "quiet",
        severity: "warn",
        message: "Quiet zone is below the 4-module QR standard."
    });
    if (hasLogo) {
        const area = style.logo.size ** 2;
        const limit = RECOVERY[style.ecc] * 0.6;
        if (area > limit * 1.6) out.push({
            id: "logo",
            severity: "error",
            message: `Logo covers ${(area * 100).toFixed(0)}% of the code; the error correction level cannot recover that. Shrink it or raise correction to H.`
        });
        else if (area > limit) out.push({
            id: "logo",
            severity: "warn",
            message: `Logo covers ${(area * 100).toFixed(0)}% of the code. Consider error correction Q or H.`
        });
        if (style.ecc === "L" || style.ecc === "M") out.push({
            id: "logo-ecc",
            severity: "info",
            message: "Logos work best with error correction Q or H."
        });
    }
    const cap = BYTE_CAPACITY[style.ecc];
    const used = byteLength(payload);
    if (used > cap) out.push({
        id: "capacity",
        severity: "error",
        message: `Content is ${used} bytes; this correction level holds ${cap}. Shorten it or lower the level.`
    });
    else if (used > cap * 0.6) out.push({
        id: "dense",
        severity: "warn",
        message: "This code is very dense and needs a large print size or sharp camera."
    });
    if (style.size < 256) out.push({
        id: "small",
        severity: "info",
        message: "Export is small; print at least 2 cm (0.8 in) wide."
    });
    return out;
}

export const hasBlockingIssue = (issues: ReadabilityIssue[]) => issues.some((i) => i.severity === "error");
