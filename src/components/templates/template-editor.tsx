"use client";
import {Loader2} from "lucide-react";
import {useState} from "react";
import {toast} from "sonner";
import {QrPreview} from "@/components/qr/qr-preview";
import {StyleEditor} from "@/components/qr/style-editor";
import {Button} from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from "@/components/ui/dialog";
import {Field, NativeSelect, TextField} from "@/components/ui/field";
import {api} from "@/lib/client/api";
import {PRESETS, presetStyle} from "@/lib/qr/style";
import type {QrStyle, Template} from "@/lib/schema";
import {errMsg, TAP} from "@/components/library/common";
import {SAMPLE_DATA} from "./templates-io";

export type EditorState = { kind: "create"; name: string; style: QrStyle } | { kind: "edit"; template: Template };

function Body({state, templates, defaultStyle, offline, onClose, onSaved}: {
    state: EditorState;
    templates: Template[];
    defaultStyle: QrStyle;
    offline: boolean;
    onClose: () => void;
    onSaved: (t: Template, created: boolean) => void
}) {
    const editing = state.kind === "edit";
    const [name, setName] = useState(state.kind === "edit" ? state.template.name : state.name);
    const [style, setStyle] = useState<QrStyle>(state.kind === "edit" ? state.template.style : state.style);
    const [from, setFrom] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const trimmed = name.trim();
    const nameError = name && !trimmed ? "Enter a name" : trimmed.length > 60 ? "Use 60 characters or fewer" : undefined;

    const startFrom = (v: string) => {
        setFrom(v);
        if (v === "default") setStyle(defaultStyle);
        else if (v.startsWith("preset:")) setStyle(presetStyle(v.slice(7)));
        else if (v.startsWith("tpl:")) {
            const t = templates.find((x) => x.id === v.slice(4));
            if (t) setStyle(t.style);
        }
    };

    const save = async () => {
        setBusy(true);
        setError(null);
        try {
            if (state.kind === "edit") onSaved(await api.templates.update(state.template.id, trimmed, style), false);
            else onSaved(await api.templates.create(trimmed, style), true);
            toast.success(editing ? "Template updated" : "Template saved");
        } catch (e) {
            setError(errMsg(e));
        } finally {
            setBusy(false);
        }
    };

    return (
        <>
            <DialogHeader>
                <DialogTitle>{editing ? "Edit template" : "New template"}</DialogTitle>
                <DialogDescription>Design a look once, then reuse it for new codes or apply it to existing
                    ones.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_280px]">
                <div className="grid content-start gap-4 max-md:order-2">
                    <TextField label="Template name" value={name} onChange={(e) => setName(e.target.value)}
                               maxLength={70} placeholder="e.g. Brand blue" error={nameError} autoFocus/>
                    {!editing ? (
                        <Field label="Start from">{(a) => <NativeSelect {...a} value={from}
                                                                        onChange={(e) => startFrom(e.target.value)}>
                            <option value="">Keep the style below</option>
                            <option value="default">My current default style</option>
                            <optgroup label="Built-in presets">
                                {PRESETS.map((p) => <option key={p.id} value={`preset:${p.id}`}>{p.name}</option>)}
                            </optgroup>
                            {templates.length ? (
                                <optgroup label="My templates">
                                    {templates.map((t) => <option key={t.id} value={`tpl:${t.id}`}>{t.name}</option>)}
                                </optgroup>
                            ) : null}
                        </NativeSelect>}</Field>
                    ) : null}
                    <StyleEditor value={style} onChange={setStyle} payload={SAMPLE_DATA}/>
                </div>
                <div
                    className="bg-popover max-md:sticky max-md:top-0 max-md:z-10 max-md:order-1 max-md:py-2 md:sticky md:top-0 md:self-start">
                    <QrPreview data={SAMPLE_DATA} style={style} size={320} label="Template preview"
                               className="mx-auto max-md:max-w-36"/>
                    <p className="mt-2 text-center text-xs text-muted-foreground">Preview with sample data</p>
                </div>
            </div>
            {error ? <p role="alert"
                        className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p> : null}
            {offline ? <p role="status" className="text-sm text-muted-foreground">Saving a template needs a
                connection.</p> : null}
            <DialogFooter>
                <Button variant="outline" className={TAP} disabled={busy} onClick={onClose}>Cancel</Button>
                <Button className={TAP} disabled={busy || offline || !trimmed || Boolean(nameError)}
                        onClick={() => void save()}>
                    {busy ? <Loader2 className="animate-spin"/> : null} {editing ? "Save changes" : "Save template"}
                </Button>
            </DialogFooter>
        </>
    );
}

export function TemplateEditor({state, templates, defaultStyle, offline, onClose, onSaved}: {
    state: EditorState | null;
    templates: Template[];
    defaultStyle: QrStyle;
    offline: boolean;
    onClose: () => void;
    onSaved: (t: Template, created: boolean) => void
}) {
    return (
        <Dialog open={state !== null} onOpenChange={(o) => !o && onClose()}>
            <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-4xl">
                {state ?
                    <Body key={state.kind === "edit" ? state.template.id : "new"} state={state} templates={templates}
                          defaultStyle={defaultStyle} offline={offline} onClose={onClose} onSaved={onSaved}/> : null}
            </DialogContent>
        </Dialog>
    );
}
