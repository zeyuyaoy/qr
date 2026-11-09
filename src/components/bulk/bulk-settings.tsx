"use client";
import {ChevronDown} from "lucide-react";
import {useState} from "react";
import {QrPreview} from "@/components/qr/qr-preview";
import {StyleEditor} from "@/components/qr/style-editor";
import {Collapsible, CollapsibleContent, CollapsibleTrigger} from "@/components/ui/collapsible";
import {Field, NativeSelect, TextField} from "@/components/ui/field";
import {api} from "@/lib/client/api";
import {useAsync} from "@/lib/client/hooks";
import {makeFilename} from "@/lib/qr/export";
import {PRESETS, presetStyle} from "@/lib/qr/style";
import {type ExportFormat, FORMATS, type QrStyle} from "@/lib/schema";
import {cn} from "@/lib/utils";

export type BulkCfg = {
    mode: "static" | "dynamic";
    style: QrStyle;
    format: ExportFormat;
    filename: string;
    templateKey: string
};

const MODES = [
    {
        id: "static",
        label: "Static",
        hint: "The URL is printed into the code. Works forever, no tracking, can't be edited later."
    },
    {
        id: "dynamic",
        label: "Dynamic",
        hint: "The code points to a short link you can change, pause or schedule. Tracks scans. Needs saving to your library."
    },
] as const;

function SizeField({value, onChange}: { value: number; onChange: (n: number) => void }) {
    const [text, setText] = useState<string | null>(null);
    const n = Number(text);
    const bad = text !== null && (!Number.isInteger(n) || n < 128 || n > 4096);
    return (
        <TextField
            label="Image size (px)"
            type="number"
            inputMode="numeric"
            min={128}
            max={4096}
            step={64}
            value={text ?? String(value)}
            error={bad ? "Enter a whole number from 128 to 4096." : undefined}
            hint="Applies to PNG, WebP and JPEG. SVG scales freely."
            onChange={(e) => {
                setText(e.target.value);
                const v = Number(e.target.value);
                if (Number.isInteger(v) && v >= 128 && v <= 4096) onChange(v);
            }}
            onBlur={() => setText(null)}
        />
    );
}

export function BulkSettings({cfg, onChange, defaultStyle, sampleData, sampleName, sampleSlug}: {
    cfg: BulkCfg;
    onChange: (patch: Partial<BulkCfg>) => void;
    defaultStyle: QrStyle;
    sampleData: string;
    sampleName: string;
    sampleSlug: string | null
}) {
    const [open, setOpen] = useState(false);
    const templates = useAsync(() => api.templates.list(), []);

    const pickTemplate = (key: string) => {
        let base: QrStyle | undefined;
        if (key === "") base = defaultStyle;
        else if (key.startsWith("preset:")) base = presetStyle(key.slice(7));
        else base = templates.data?.find((t) => t.id === key.slice(4))?.style;
        if (base) onChange({style: {...base, size: cfg.style.size}, templateKey: key});
    };

    return (
        <div className="grid gap-4">
            <fieldset className="grid gap-2 sm:grid-cols-2">
                <legend className="mb-1 text-sm font-medium">Code type</legend>
                {MODES.map((m) => (
                    <label key={m.id}
                           className={cn("flex min-h-11 cursor-pointer items-start gap-2.5 rounded-xl border p-3 text-sm has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50", cfg.mode === m.id && "border-primary bg-primary/5")}>
                        <input type="radio" name="bulk-mode" className="mt-0.5 size-4 accent-primary"
                               checked={cfg.mode === m.id} onChange={() => onChange({mode: m.id})}/>
                        <span>
              <span className="font-medium">{m.label}</span>
              <span className="block text-xs text-muted-foreground">{m.hint}</span>
            </span>
                    </label>
                ))}
            </fieldset>

            <div className="grid items-start gap-4 sm:grid-cols-[1fr_9rem]">
                <div className="grid gap-4">
                    <Field label="Style"
                           hint={templates.error && !templates.data ? "Your saved templates couldn't be loaded (offline?). Presets and the default style still work." : undefined}>
                        {(a) => (
                            <NativeSelect {...a} value={cfg.templateKey} onChange={(e) => pickTemplate(e.target.value)}>
                                {cfg.templateKey === "custom" ?
                                    <option value="custom">Custom (edited below)</option> : null}
                                <option value="">My default style</option>
                                {templates.data?.length ? (
                                    <optgroup label="My templates">
                                        {templates.data.map((t) => <option key={t.id}
                                                                           value={`tpl:${t.id}`}>{t.name}</option>)}
                                    </optgroup>
                                ) : null}
                                <optgroup label="Built-in presets">
                                    {PRESETS.map((p) => <option key={p.id} value={`preset:${p.id}`}>{p.name}</option>)}
                                </optgroup>
                            </NativeSelect>
                        )}
                    </Field>
                    <div className="grid gap-4 sm:grid-cols-2">
                        <Field label="File format">
                            {(a) => (
                                <NativeSelect {...a} value={cfg.format}
                                              onChange={(e) => onChange({format: e.target.value as ExportFormat})}>
                                    {FORMATS.map((f) => <option key={f} value={f}>{f.toUpperCase()}</option>)}
                                </NativeSelect>
                            )}
                        </Field>
                        <SizeField value={cfg.style.size} onChange={(size) => onChange({style: {...cfg.style, size}})}/>
                    </div>
                    <TextField
                        label="File name template"
                        value={cfg.filename}
                        maxLength={80}
                        onChange={(e) => onChange({filename: e.target.value})}
                        hint={<>Use {"{name}"}, {"{type}"} and {"{slug}"}. Example: <code
                            className="break-all">{makeFilename(cfg.filename, {
                            name: sampleName,
                            type: "url",
                            slug: sampleSlug
                        }, cfg.format)}</code></>}
                    />
                </div>
                <div className="max-sm:order-first max-sm:w-32">
                    <QrPreview data={sampleData} style={cfg.style} size={288} label="Preview of the first code"/>
                    <p className="mt-1 text-center text-xs text-muted-foreground">First code</p>
                </div>
            </div>

            <Collapsible open={open} onOpenChange={setOpen}>
                <CollapsibleTrigger
                    className="flex min-h-11 w-full items-center justify-between rounded-xl border px-3 text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
                    Customize style
                    <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} aria-hidden/>
                </CollapsibleTrigger>
                <CollapsibleContent>
                    <div className="pt-3">
                        <StyleEditor value={cfg.style} onChange={(style) => onChange({style, templateKey: "custom"})}
                                     payload={sampleData}/>
                    </div>
                </CollapsibleContent>
            </Collapsible>
        </div>
    );
}
