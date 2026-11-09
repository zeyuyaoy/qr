"use client";
import {useTheme} from "next-themes";
import {useMemo} from "react";
import {QrPreview} from "@/components/qr/qr-preview";
import {StyleEditor} from "@/components/qr/style-editor";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {FORMATS} from "@/lib/schema";
import {Choice, Field, NumberInput, Section, selectClass} from "./field";
import type {SectionProps} from "./types";

const FALLBACK_ZONES = ["UTC", "Europe/London", "Europe/Paris", "Europe/Berlin", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Sao_Paulo", "Asia/Dubai", "Asia/Kolkata", "Asia/Shanghai", "Asia/Tokyo", "Australia/Sydney", "Pacific/Auckland"];

const zones = (): string[] => {
    const all = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone");
    const list = all && all.length ? all : FALLBACK_ZONES;
    return list.includes("UTC") ? list : ["UTC", ...list];
};

export const validZone = (tz: string) => {
    try {
        new Intl.DateTimeFormat(undefined, {timeZone: tz});
        return tz.length > 0;
    } catch {
        return false;
    }
};

export function DefaultsSection({draft, update, errors}: SectionProps) {
    const {setTheme} = useTheme();
    const zoneList = useMemo(() => zones(), []);
    const device = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
    const now = validZone(draft.timezone) ? new Intl.DateTimeFormat(undefined, {
        timeZone: draft.timezone,
        dateStyle: "medium",
        timeStyle: "short"
    }).format(new Date()) : null;
    const example = draft.filenameTemplate.replaceAll("{name}", "Spring-menu").replaceAll("{type}", "url").replaceAll("{slug}", "k7x2mqa");

    return (
        <Section id="defaults" title="Defaults"
                 description="Applied to new codes and exports. Existing codes are not changed.">
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_auto]">
                <div className="min-w-0 space-y-2">
                    <h3 className="text-sm font-medium">Default QR style</h3>
                    <StyleEditor value={draft.defaultStyle}
                                 onChange={(s) => update((d) => ({...d, defaultStyle: s, size: s.size}))}
                                 payload="https://example.com"/>
                </div>
                <div className="mx-auto w-[200px] max-w-full lg:sticky lg:top-16 lg:self-start">
                    <p className="mb-2 text-sm font-medium">Preview</p>
                    <QrPreview data="https://example.com" style={draft.defaultStyle} size={200}
                               className="rounded-lg ring-1 ring-foreground/10"
                               label="Preview of the default QR style"/>
                </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Preferred export format">
                    {(a) => (
                        <select {...a} className={selectClass} value={draft.format}
                                onChange={(e) => update((d) => ({...d, format: e.target.value as typeof d.format}))}>
                            {FORMATS.map((f) => <option key={f} value={f}>{f.toUpperCase()}</option>)}
                        </select>
                    )}
                </Field>
                <Field label="Default export size (px)"
                       hint="Edge length of PNG, WebP and JPEG exports, 128 to 4096. SVG is always vector."
                       error={errors.size}>
                    {(a) => <NumberInput value={draft.size} min={128} max={4096} onChange={(n) => update((d) => ({
                        ...d,
                        size: n,
                        defaultStyle: {...d.defaultStyle, size: n}
                    }))} {...a} />}
                </Field>
            </div>

            <Choice
                legend="Default mode for new codes"
                name="default-mode"
                value={draft.mode}
                onChange={(mode) => update((d) => ({...d, mode}))}
                options={[
                    {
                        value: "static",
                        label: "Static",
                        hint: "Content is printed into the code. Works forever, not trackable."
                    },
                    {
                        value: "dynamic",
                        label: "Dynamic",
                        hint: "Short link you can edit, schedule and track. URLs only."
                    },
                ]}
            />

            <Field label="Filename template"
                   hint={<>Placeholders: <code>{"{name}"}</code> the code name, <code>{"{type}"}</code> its content type
                       (url, wifi, …), <code>{"{slug}"}</code> its short-link slug. Example: <span
                           className="font-mono">{example || "…"}.{draft.format}</span></>}
                   error={errors.filenameTemplate}>
                {(a) => <Input {...a} className="h-11 font-mono" value={draft.filenameTemplate} maxLength={80}
                               spellCheck={false}
                               onChange={(e) => update((d) => ({...d, filenameTemplate: e.target.value}))}/>}
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Time zone"
                       hint={now ? `Now there: ${now}. Times are stored in UTC and displayed in this zone.` : "Start typing to search, e.g. Europe/Paris."}
                       error={errors.timezone}>
                    {(a) => (
                        <>
                            <Input {...a} list="tz-options" className="h-11" value={draft.timezone} maxLength={64}
                                   autoComplete="off" spellCheck={false}
                                   onChange={(e) => update((d) => ({...d, timezone: e.target.value}))}/>
                            <datalist id="tz-options">{zoneList.map((z) => <option key={z} value={z}/>)}</datalist>
                        </>
                    )}
                </Field>
                {device && device !== draft.timezone && (
                    <div className="flex items-end">
                        <Button type="button" variant="outline" className="tap"
                                onClick={() => update((d) => ({...d, timezone: device}))}>Use this device&apos;s zone
                            ({device})</Button>
                    </div>
                )}
            </div>

            <Choice
                legend="Theme"
                name="theme"
                value={draft.theme}
                onChange={(theme) => {
                    setTheme(theme);
                    update((d) => ({...d, theme}));
                }}
                options={[
                    {value: "light", label: "Light"},
                    {value: "dark", label: "Dark"},
                    {value: "system", label: "System", hint: "Follow the device"},
                ]}
            />
        </Section>
    );
}
