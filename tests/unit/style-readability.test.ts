import {describe, expect, it} from "vitest";
import {defaultStyle, type QrStyle, styleSchema} from "@/lib/schema";
import {marginPx, moduleCount, PRESETS, presetStyle, renderKey, toStylingOptions} from "@/lib/qr/style";
import {checkReadability, contrast, hasBlockingIssue, luminance} from "@/lib/qr/readability";

const style = (o: Partial<QrStyle> = {}): QrStyle => styleSchema.parse(o);
const ids = (s: QrStyle, payload = "https://example.com", logo = false) => checkReadability(s, payload, logo).map((i) => `${i.severity}:${i.id}`);

describe("styleSchema", () => {
    it("fills every default", () => {
        const d = defaultStyle();
        expect(d).toMatchObject({
            fg: "#111111",
            bg: "#ffffff",
            transparent: false,
            dots: "square",
            finderOuter: "square",
            finderInner: "square",
            finderColor: null,
            finderInnerColor: null,
            ecc: "M",
            quietZone: 4,
            size: 1024,
            preset: null,
        });
        expect(d.gradient).toEqual({enabled: false, type: "linear", from: "#111111", to: "#4f46e5", rotation: 45});
        expect(d.logo).toEqual({assetId: null, size: 0.2, padding: 6, background: "#ffffff", hideDots: true});
    });
    it("is idempotent", () => {
        const d = defaultStyle();
        expect(styleSchema.parse(d)).toEqual(d);
    });
    it.each([
        ["fg", "red"],
        ["fg", "#fff"],
        ["bg", "#GGGGGG"],
        ["ecc", "X"],
        ["dots", "hexagon"],
        ["quietZone", -1],
        ["quietZone", 17],
        ["quietZone", 2.5],
        ["size", 127],
        ["size", 4097],
        ["finderColor", "nope"],
        ["preset", "x".repeat(41)],
    ])("rejects %s = %j", (k, v) => {
        expect(styleSchema.safeParse({[k]: v}).success).toBe(false);
    });
    it("accepts the boundaries", () => {
        expect(styleSchema.safeParse({quietZone: 0, size: 128}).success).toBe(true);
        expect(styleSchema.safeParse({quietZone: 16, size: 4096}).success).toBe(true);
    });
    it("validates nested gradient and logo values", () => {
        expect(styleSchema.safeParse({gradient: {rotation: 361}}).success).toBe(false);
        expect(styleSchema.safeParse({gradient: {type: "conic"}}).success).toBe(false);
        expect(styleSchema.safeParse({logo: {size: 0.5}}).success).toBe(false);
        expect(styleSchema.safeParse({logo: {size: 0.04}}).success).toBe(false);
        expect(styleSchema.safeParse({logo: {assetId: "not-hex"}}).success).toBe(false);
        expect(styleSchema.safeParse({logo: {assetId: "a".repeat(32)}}).success).toBe(true);
        expect(styleSchema.parse({gradient: {enabled: true}}).gradient).toMatchObject({
            enabled: true,
            type: "linear",
            rotation: 45
        });
    });
});

describe("presets", () => {
    it("has unique ids and every preset parses", () => {
        expect(new Set(PRESETS.map((p) => p.id)).size).toBe(PRESETS.length);
        for (const p of PRESETS) {
            const s = presetStyle(p.id);
            expect(styleSchema.safeParse(s).success, p.id).toBe(true);
            expect(s.preset).toBe(p.id);
        }
    });
    it("falls back to the first preset for unknown ids", () => {
        expect(presetStyle("nope").preset).toBe(PRESETS[0]!.id);
    });
    it("keeps >= 4.5:1 contrast against the background for every non-transparent colour", () => {
        for (const p of PRESETS) {
            const s = presetStyle(p.id);
            if (s.transparent) continue;
            const colours = [s.fg, s.finderColor, s.finderInnerColor, ...(s.gradient.enabled ? [s.gradient.from, s.gradient.to] : [])].filter((c): c is string => Boolean(c));
            for (const c of colours) expect(contrast(c, s.bg), `${p.id}: ${c} on ${s.bg}`).toBeGreaterThanOrEqual(4.5);
        }
    });
    it("never produces a readability error or contrast warning", () => {
        for (const p of PRESETS) {
            const issues = checkReadability(presetStyle(p.id), "https://example.com", false);
            expect(issues.filter((i) => i.severity !== "info").map((i) => i.id), p.id).toEqual([]);
        }
    });
});

describe("colour maths", () => {
    it("matches WCAG reference values", () => {
        expect(luminance("#000000")).toBe(0);
        expect(luminance("#ffffff")).toBeCloseTo(1, 10);
        expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
        expect(contrast("#ffffff", "#000000")).toBeCloseTo(21, 5);
        expect(contrast("#777777", "#ffffff")).toBeCloseTo(4.48, 1);
        expect(contrast("#336699", "#336699")).toBeCloseTo(1, 10);
    });
});

describe("checkReadability", () => {
    it("is quiet for the default style", () => {
        expect(ids(defaultStyle())).toEqual([]);
    });
    it("flags low contrast as an error and mid contrast as a warning", () => {
        expect(ids(style({fg: "#cccccc"}))).toContain("error:contrast");
        expect(ids(style({fg: "#888888"}))).toContain("warn:contrast");
        expect(ids(style({fg: "#767676"}))).not.toContain("warn:contrast");
    });
    it("uses the worst gradient stop for contrast", () => {
        const s = style({
            fg: "#000000",
            gradient: {enabled: true, type: "linear", from: "#000000", to: "#dddddd", rotation: 0}
        });
        expect(ids(s)).toContain("error:contrast");
    });
    it("flags light-on-dark (inverted) codes", () => {
        expect(ids(style({fg: "#ffffff", bg: "#000000"}))).toEqual(["warn:inverted"]);
        expect(ids(style({fg: "#000000", bg: "#ffffff"}))).not.toContain("warn:inverted");
    });
    it("flags weak finder colours", () => {
        expect(ids(style({finderColor: "#eeeeee"}))).toContain("error:finder-Finder pattern");
        expect(ids(style({finderInnerColor: "#eeeeee"}))).toContain("error:finder-Finder centre");
        expect(ids(style({finderColor: "#000000"}))).toEqual([]);
    });
    it("skips contrast checks for transparent backgrounds and says why", () => {
        const out = checkReadability(style({transparent: true, fg: "#cccccc"}), "x", false);
        expect(out.map((i) => i.id)).toEqual(["transparent"]);
        expect(out[0]!.severity).toBe("info");
    });
    it("checks the quiet zone", () => {
        expect(ids(style({quietZone: 0}))).toContain("error:quiet");
        expect(ids(style({quietZone: 1}))).toContain("error:quiet");
        expect(ids(style({quietZone: 2}))).toContain("warn:quiet");
        expect(ids(style({quietZone: 3}))).toContain("warn:quiet");
        expect(ids(style({quietZone: 4}))).not.toContain("warn:quiet");
    });
    it("relates logo coverage to the correction level", () => {
        const logo = (ecc: QrStyle["ecc"], size: number) => ids(style({
            ecc,
            logo: {size} as QrStyle["logo"]
        }), "https://example.com", true);
        expect(logo("H", 0.2)).toEqual([]);
        expect(logo("H", 0.4)).toEqual([]);
        expect(logo("M", 0.2)).toEqual(["info:logo-ecc"]);
        expect(logo("M", 0.35)).toEqual(expect.arrayContaining(["warn:logo", "info:logo-ecc"]));
        expect(logo("L", 0.4)).toEqual(expect.arrayContaining(["error:logo"]));
        expect(logo("Q", 0.4)).toContain("warn:logo");
        expect(ids(style({ecc: "L", logo: {size: 0.4} as QrStyle["logo"]}), "x", false)).toEqual([]);
    });
    it("checks capacity per correction level", () => {
        expect(ids(style({ecc: "H"}), "a".repeat(1273))).toContain("warn:dense");
        expect(ids(style({ecc: "H"}), "a".repeat(1274))).toContain("error:capacity");
        expect(ids(style({ecc: "L"}), "a".repeat(1274))).not.toContain("error:capacity");
        expect(ids(style({ecc: "M"}), "a".repeat(800))).not.toContain("warn:dense");
        expect(ids(style({ecc: "H"}), "a".repeat(800))).toContain("warn:dense");
        expect(ids(style({ecc: "M"}), "é".repeat(1200))).toContain("error:capacity");
    });
    it("notes tiny exports", () => {
        expect(ids(style({size: 128}))).toContain("info:small");
        expect(ids(style({size: 256}))).not.toContain("info:small");
    });
    it("hasBlockingIssue only reacts to errors", () => {
        expect(hasBlockingIssue(checkReadability(style({fg: "#cccccc"}), "x", false))).toBe(true);
        expect(hasBlockingIssue(checkReadability(style({fg: "#888888"}), "x", false))).toBe(false);
        expect(hasBlockingIssue([])).toBe(false);
    });
});

describe("geometry", () => {
    it("computes QR module counts from the version", () => {
        expect(moduleCount("hello", "M")).toBe(21);
        expect(moduleCount("a".repeat(20), "M")).toBe(25);
        expect(moduleCount("a".repeat(14), "M")).toBe(21);
        expect(moduleCount("a".repeat(15), "M")).toBe(25);
        expect(moduleCount("a".repeat(2331), "M")).toBe(177);
        expect(moduleCount("hello", "H")).toBeGreaterThanOrEqual(moduleCount("hello", "L"));
    });
    it("sizes the margin so the quiet zone is exactly q modules", () => {
        expect(marginPx(1000, 21, 4)).toBe(138);
        expect(marginPx(1024, 21, 0)).toBe(0);
        const size = 1000, m = 25, q = 4;
        const px = marginPx(size, m, q);
        expect((size - 2 * px) / m).toBeCloseTo(((size - 2 * px) / m), 6);
        expect(px / ((size - 2 * px) / m)).toBeCloseTo(q, 1);
    });
    it("builds qr-code-styling options", () => {
        const s = style({
            fg: "#112233",
            bg: "#fafafa",
            ecc: "Q",
            dots: "rounded",
            finderOuter: "extra-rounded",
            finderInner: "dot",
            size: 512
        });
        const o = toStylingOptions("hello", s);
        expect(o).toMatchObject({
            width: 512,
            height: 512,
            type: "svg",
            data: "hello",
            margin: marginPx(512, moduleCount("hello", "Q"), 4),
            qrOptions: {errorCorrectionLevel: "Q", mode: "Byte"},
            dotsOptions: {type: "rounded", color: "#112233"},
            cornersSquareOptions: {type: "extra-rounded", color: "#112233"},
            cornersDotOptions: {type: "dot", color: "#112233"},
            backgroundOptions: {color: "#fafafa"},
        });
        expect(o.image).toBeUndefined();
        expect(o.dotsOptions).not.toHaveProperty("gradient");
        expect(toStylingOptions("hello", s, {size: 256}).width).toBe(256);
    });
    it("maps gradients (degrees to radians) and finder colour fallbacks", () => {
        const s = style({
            gradient: {enabled: true, type: "radial", from: "#000000", to: "#0000ff", rotation: 90},
            finderColor: null,
            finderInnerColor: "#123456"
        });
        const o = toStylingOptions("x", s);
        expect(o.dotsOptions!.gradient).toEqual({
            type: "radial",
            rotation: Math.PI / 2,
            colorStops: [{offset: 0, color: "#000000"}, {offset: 1, color: "#0000ff"}]
        });
        expect(o.cornersSquareOptions!.color).toBe("#000000");
        expect(o.cornersDotOptions!.color).toBe("#123456");
        const f = toStylingOptions("x", style({finderColor: "#222222"}));
        expect(f.cornersSquareOptions!.color).toBe("#222222");
        expect(f.cornersDotOptions!.color).toBe("#222222");
    });
    it("makes transparent backgrounds transparent and wires the logo", () => {
        expect(toStylingOptions("x", style({transparent: true})).backgroundOptions!.color).toBe("rgba(0,0,0,0)");
        const logoStyle = (background: string | null) =>
            style({logo: {size: 0.25, padding: 10, hideDots: false, background} as QrStyle["logo"], size: 1000});
        const o = toStylingOptions("x", logoStyle(null), {logoUrl: "data:image/png;base64,AAAA"});
        expect(o.image).toBe("data:image/png;base64,AAAA");
        expect(o.imageOptions).toMatchObject({imageSize: 0.25, hideBackgroundDots: false, margin: 10});
        expect(toStylingOptions("x", logoStyle("#ffffff"), {logoUrl: "data:a"}).imageOptions!.margin).toBe(0);
    });
    it("renderKey changes with content and style but not with identical input", () => {
        const s = defaultStyle();
        expect(renderKey("a", s)).toBe(renderKey("a", {...s}));
        expect(renderKey("a", s)).not.toBe(renderKey("b", s));
        expect(renderKey("a", s)).not.toBe(renderKey("a", {...s, fg: "#222222"}));
        expect(renderKey("a", s, "data:x")).not.toBe(renderKey("a", s));
    });
});

it("uses self-contained logo data directly without CSP-blocked XHR conversion", () => {
    const style = defaultStyle();
    const opts = toStylingOptions("https://example.com/logo", style, {logoUrl: "data:image/png;base64,AAAA"});
    expect(opts.imageOptions?.saveAsBlob).toBe(false);
    expect(opts.image).toBe("data:image/png;base64,AAAA");
});
