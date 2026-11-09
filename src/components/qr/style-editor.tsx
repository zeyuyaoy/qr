"use client";
import {ImagePlus, Info, OctagonAlert, Trash2, TriangleAlert} from "lucide-react";
import {useMemo, useRef, useState} from "react";
import {toast} from "sonner";
import {Button} from "@/components/ui/button";
import {ColorField, Field, NativeSelect, RangeField} from "@/components/ui/field";
import {Switch} from "@/components/ui/switch";
import {api} from "@/lib/client/api";
import {processLogoFile, useLogoUrl} from "@/lib/client/logo";
import {isOnline} from "@/lib/client/offline";
import {checkReadability, type ReadabilityIssue} from "@/lib/qr/readability";
import {PRESETS} from "@/lib/qr/style";
import {DOT_TYPES, FINDER_INNER, FINDER_OUTER, type QrStyle, styleSchema} from "@/lib/schema";
import {cn} from "@/lib/utils";
import {PLATFORM_LOGOS} from "./platform-logos";

const label = (s: string) => s.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());
const ECC_HINT = {
    L: "7% recoverable — smallest code",
    M: "15% — recommended",
    Q: "25% — good with logos",
    H: "30% — best with logos"
} as const;

function ReadabilityList({issues}: { issues: ReadabilityIssue[] }) {
    if (!issues.length) return <p className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400">
        <Info className="size-4"/> No readability problems detected.</p>;
    return (
        <ul className="grid gap-1.5" aria-label="Readability checks">
            {issues.map((i) => {
                const Icon = i.severity === "error" ? OctagonAlert : i.severity === "warn" ? TriangleAlert : Info;
                return (
                    <li key={i.id}
                        className={cn("flex items-start gap-2 rounded-lg px-2.5 py-1.5 text-sm", i.severity === "error" ? "bg-destructive/10 text-destructive" : i.severity === "warn" ? "bg-amber-500/10 text-amber-800 dark:text-amber-200" : "bg-muted text-muted-foreground")}>
                        <Icon className="mt-0.5 size-4 shrink-0"/> <span>{i.message}</span>
                    </li>
                );
            })}
        </ul>
    );
}

function Section({title, children}: { title: string; children: React.ReactNode }) {
    return (
        <details className="group border-t">
            <summary
                className="tap flex cursor-pointer list-none items-center justify-between py-2.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
                {title}
                <span aria-hidden className="text-muted-foreground transition-transform group-open:rotate-90">›</span>
            </summary>
            <div className="grid gap-3 pb-3">{children}</div>
        </details>
    );
}

export function StyleEditor({value, onChange, payload = "https://example.com", disabled}: {
    value: QrStyle;
    onChange: (s: QrStyle) => void;
    payload?: string;
    disabled?: boolean
}) {
    const logoUrl = useLogoUrl(value.logo.assetId);
    const fileRef = useRef<HTMLInputElement>(null);
    const [busy, setBusy] = useState(false);
    const set = (patch: Partial<QrStyle>) => onChange({
        ...value, ...patch,
        preset: "preset" in patch ? patch.preset! : null
    });
    const issues = useMemo(() => checkReadability(value, payload, Boolean(value.logo.assetId)), [value, payload]);

    const pickLogo = async (file: File | undefined, matchForeground?: true) => {
        if (!file) return;
        setBusy(true);
        try {
            const {dataUrl, assetId} = await processLogoFile(file);
            if (isOnline()) await api.assets.put(dataUrl).catch(() => toast.message("Logo kept on this device; it will upload when you save."));
            onChange({...value, preset: null, logo: {...value.logo, assetId, matchForeground}});
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Could not use that image");
        } finally {
            setBusy(false);
            if (fileRef.current) fileRef.current.value = "";
        }
    };

    return (
        <div className="grid min-w-0 grid-cols-1 gap-3" aria-disabled={disabled}>
            <div>
                <p className="mb-1.5 text-sm font-medium">Presets</p>
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Style presets">
                    {PRESETS.map((p) => {
                        const s = styleSchema.parse({...p.style, preset: p.id});
                        const active = value.preset === p.id;
                        return (
                            <button key={p.id} type="button" disabled={disabled} aria-pressed={active}
                                    onClick={() => onChange({
                                        ...s,
                                        size: value.size,
                                        ecc: value.logo.assetId && s.ecc === "M" ? "Q" : s.ecc,
                                        logo: value.logo
                                    })}
                                    className={cn("tap flex shrink-0 items-center gap-2 rounded-lg border px-2.5 text-sm transition-colors hover:bg-muted", active && "border-primary bg-muted")}>
                                <span aria-hidden className="size-5 rounded-full border" style={{
                                    background: s.gradient.enabled ? `linear-gradient(135deg, ${s.gradient.from}, ${s.gradient.to})` : s.fg,
                                    outline: `3px solid ${s.transparent ? "transparent" : s.bg}`,
                                    outlineOffset: "-3px"
                                }}/>
                                {p.name}
                            </button>
                        );
                    })}
                </div>
            </div>

            <Section title="Colours">
                <div className="grid grid-cols-2 gap-3">
                    <ColorField label="Foreground" value={value.fg} disabled={disabled || value.gradient.enabled}
                                onChange={(fg) => set({fg})}/>
                    <ColorField label="Background" value={value.bg} disabled={disabled || value.transparent}
                                onChange={(bg) => set({bg})}/>
                </div>
                <label className="flex items-center justify-between gap-3 text-sm">
                    Transparent background
                    <Switch checked={value.transparent} disabled={disabled}
                            onCheckedChange={(transparent) => set({transparent})} aria-label="Transparent background"/>
                </label>
                <label className="flex items-center justify-between gap-3 text-sm">
                    Gradient
                    <Switch checked={value.gradient.enabled} disabled={disabled}
                            onCheckedChange={(enabled) => set({gradient: {...value.gradient, enabled}})}
                            aria-label="Use gradient"/>
                </label>
                {value.gradient.enabled && (
                    <div className="grid gap-3 rounded-lg bg-muted/50 p-3">
                        <div className="grid grid-cols-2 gap-3">
                            <ColorField label="From" value={value.gradient.from}
                                        onChange={(from) => set({gradient: {...value.gradient, from}})}/>
                            <ColorField label="To" value={value.gradient.to}
                                        onChange={(to) => set({gradient: {...value.gradient, to}})}/>
                        </div>
                        <Field label="Type">{(a) => <NativeSelect {...a} value={value.gradient.type}
                                                                  onChange={(e) => set({
                                                                      gradient: {
                                                                          ...value.gradient,
                                                                          type: e.target.value as "linear" | "radial"
                                                                      }
                                                                  })}>
                            <option value="linear">Linear</option>
                            <option value="radial">Radial</option>
                        </NativeSelect>}</Field>
                        {value.gradient.type === "linear" &&
                            <RangeField label="Angle" value={value.gradient.rotation} min={0} max={360} step={15}
                                        format={(v) => `${v}°`}
                                        onChange={(rotation) => set({gradient: {...value.gradient, rotation}})}/>}
                    </div>
                )}
            </Section>

            <Section title="Shapes">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <Field label="Modules">{(a) => <NativeSelect {...a} value={value.dots} disabled={disabled}
                                                                 onChange={(e) => set({dots: e.target.value as QrStyle["dots"]})}>{DOT_TYPES.map((d) =>
                        <option key={d} value={d}>{label(d)}</option>)}</NativeSelect>}</Field>
                    <Field label="Finder outer">{(a) => <NativeSelect {...a} value={value.finderOuter}
                                                                      disabled={disabled}
                                                                      onChange={(e) => set({finderOuter: e.target.value as QrStyle["finderOuter"]})}>{FINDER_OUTER.map((d) =>
                        <option key={d} value={d}>{label(d)}</option>)}</NativeSelect>}</Field>
                    <Field label="Finder centre">{(a) => <NativeSelect {...a} value={value.finderInner}
                                                                       disabled={disabled}
                                                                       onChange={(e) => set({finderInner: e.target.value as QrStyle["finderInner"]})}>{FINDER_INNER.map((d) =>
                        <option key={d} value={d}>{label(d)}</option>)}</NativeSelect>}</Field>
                </div>
                <div className="grid grid-cols-2 gap-3">
                    <div className="grid gap-1.5">
                        <ColorField label="Finder colour" value={value.finderColor ?? value.fg} disabled={disabled}
                                    onChange={(finderColor) => set({finderColor})}/>
                        {value.finderColor &&
                            <Button type="button" variant="ghost" size="sm" onClick={() => set({finderColor: null})}>Match
                                modules</Button>}
                    </div>
                    <div className="grid gap-1.5">
                        <ColorField label="Finder centre colour"
                                    value={value.finderInnerColor ?? value.finderColor ?? value.fg} disabled={disabled}
                                    onChange={(finderInnerColor) => set({finderInnerColor})}/>
                        {value.finderInnerColor && <Button type="button" variant="ghost" size="sm"
                                                           onClick={() => set({finderInnerColor: null})}>Match
                            finder</Button>}
                    </div>
                </div>
            </Section>

            <Section title="Logo">
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Platform logos">
                    {PLATFORM_LOGOS.map(([name, path]) => (
                        <Button key={name} type="button" variant="outline" size="sm" className="tap"
                                disabled={busy || disabled} onClick={() => void pickLogo(new File([
                            `<svg xmlns="http://www.w3.org/2000/svg" width="192" height="192" viewBox="-1 -1 26 26"><path d="${path}" stroke="black" stroke-width="0.5" stroke-linejoin="round"/></svg>`
                        ], `${name}.svg`, {type: "image/svg+xml"}), true)}>
                            <svg aria-hidden="true" viewBox="-1 -1 26 26" className="size-5 rounded bg-zinc-800 p-0.5" fill="white"><path d={path} stroke="white" strokeWidth={0.5} strokeLinejoin="round"/></svg>
                            {name}
                        </Button>
                    ))}
                </div>
                <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml"
                       className="sr-only" aria-label="Logo image file" disabled={busy || disabled}
                       onChange={(e) => void pickLogo(e.target.files?.[0])}/>
                {value.logo.assetId ? (
                    <div className="flex items-center gap-3">
                        <span
                            className={cn("grid size-14 place-items-center overflow-hidden rounded-lg border",
                                logoUrl && value.logo.matchForeground ? "bg-zinc-800" : "bg-muted")}>{logoUrl ?
                            (value.logo.matchForeground ?
                                <span role="img" aria-label="Current logo" className="size-full bg-white" style={{
                                    mask: `url("${logoUrl}") center / contain no-repeat`
                                }}/> :
                                <img src={logoUrl} alt="Current logo" className="max-h-full max-w-full"/>) :
                            <ImagePlus className="size-5 text-muted-foreground"/>}</span>
                        <div className="flex flex-wrap gap-2">
                            <Button type="button" variant="outline" size="sm" disabled={busy || disabled}
                                    onClick={() => fileRef.current?.click()}>Replace</Button>
                            <Button type="button" variant="ghost" size="sm" disabled={busy || disabled}
                                    onClick={() => onChange({
                                        ...value,
                                        preset: null,
                                        logo: {...value.logo, assetId: null, matchForeground: undefined}
                                    })}><Trash2/> Remove</Button>
                        </div>
                    </div>
                ) : (
                    <Button type="button" variant="outline" className="tap" disabled={busy || disabled}
                            onClick={() => fileRef.current?.click()}><ImagePlus/> {busy ? "Processing…" : "Add a logo"}
                    </Button>
                )}
                <p className="text-xs text-muted-foreground">PNG, JPEG, WebP or SVG. The image is resized on this
                    device.</p>
                {value.logo.assetId && (
                    <>
                        <RangeField label="Logo size" value={Math.round(value.logo.size * 100)} min={5} max={40}
                                    format={(v) => `${v}%`}
                                    onChange={(v) => set({logo: {...value.logo, size: v / 100}})}/>
                        <RangeField label="Logo padding" value={value.logo.padding} min={0} max={40}
                                    onChange={(padding) => set({logo: {...value.logo, padding}})}/>
                        <label className="flex items-center justify-between gap-3 text-sm">
                            Clear modules behind logo
                            <Switch checked={value.logo.hideDots}
                                    onCheckedChange={(hideDots) => set({logo: {...value.logo, hideDots}})}
                                    aria-label="Clear modules behind logo"/>
                        </label>
                        <label className="flex items-center justify-between gap-3 text-sm">
                            Logo background
                            <Switch checked={value.logo.background !== null} onCheckedChange={(on) => set({
                                logo: {
                                    ...value.logo,
                                    background: on ? "#ffffff" : null
                                }
                            })} aria-label="Logo background"/>
                        </label>
                        {value.logo.background &&
                            <ColorField label="Logo background colour" value={value.logo.background}
                                        onChange={(background) => set({logo: {...value.logo, background}})}/>}
                    </>
                )}
            </Section>

            <Section title="Advanced: size and error correction">
                <Field label="Error correction" hint={ECC_HINT[value.ecc]}>{(a) => <NativeSelect {...a}
                                                                                                 value={value.ecc}
                                                                                                 disabled={disabled}
                                                                                                 onChange={(e) => set({ecc: e.target.value as QrStyle["ecc"]})}>{(["L", "M", "Q", "H"] as const).map((l) =>
                    <option key={l} value={l}>{l} — {ECC_HINT[l].split(" — ")[0]}</option>)}</NativeSelect>}</Field>
                <RangeField label="Quiet zone (modules)" value={value.quietZone} min={0} max={16}
                            onChange={(quietZone) => set({quietZone})}/>
                <Field label="Export size (px)" hint="Edge length of PNG/WebP/JPEG exports. SVG is always vector.">
                    {(a) => <input {...a} type="number" inputMode="numeric" min={128} max={4096} step={64}
                                   value={value.size} disabled={disabled}
                                   onChange={(e) => set({size: Math.min(4096, Math.max(128, Math.round(Number(e.target.value) || 1024)))})}
                                   className="h-10 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm tabular-nums"/>}
                </Field>
            </Section>

            <ReadabilityList issues={issues}/>
        </div>
    );
}
