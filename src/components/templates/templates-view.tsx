"use client";
import {
    CopyPlus,
    FileDown,
    FileUp,
    Layers3,
    MoreHorizontal,
    Pencil,
    Plus,
    Star,
    Trash2,
    WandSparkles
} from "lucide-react";
import {useState} from "react";
import {toast} from "sonner";
import {downloadBlob} from "@/lib/qr/export";
import {ConfirmDialog, errMsg, ErrorNotice, InfoNotice, Skeleton, TAP} from "@/components/library/common";
import {LazyQr} from "@/components/library/lazy-qr";
import {PageHeader} from "@/components/page-header";
import {Badge} from "@/components/ui/badge";
import {Button} from "@/components/ui/button";
import {DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger} from "@/components/ui/dropdown-menu";
import {api} from "@/lib/client/api";
import {useAsync, useOnline, useSettings} from "@/lib/client/hooks";
import {type Preset, PRESETS, presetStyle} from "@/lib/qr/style";
import type {QrStyle, Template} from "@/lib/schema";
import {ApplyDialog} from "./apply-dialog";
import {ImportTemplatesDialog} from "./import-templates-dialog";
import {type EditorState, TemplateEditor} from "./template-editor";
import {buildExport, LOGO_NOTE, sameStyle, SAMPLE_DATA} from "./templates-io";

type ApplyTarget = { kind: "user"; template: Template } | { kind: "preset"; preset: Preset };

function Card({title, style, isDefault, children}: {
    title: string;
    style: QrStyle;
    isDefault: boolean;
    children: React.ReactNode
}) {
    return (
        <li className="flex min-w-0 flex-col overflow-hidden rounded-xl bg-card text-card-foreground ring-1 ring-foreground/10">
            <div className="mx-auto w-full max-w-44 p-2 pb-0">
                <LazyQr data={SAMPLE_DATA} style={style} size={240} label={`Preview of the ${title} style`}/>
            </div>
            <div className="flex flex-1 flex-col gap-2 p-3">
                <div className="flex min-w-0 items-center gap-2">
                    <h3 className="min-w-0 flex-1 truncate text-sm font-medium">{title}</h3>
                    {isDefault ?
                        <Badge variant="secondary"><Star className="fill-current" aria-hidden/> Default</Badge> : null}
                </div>
                {children}
            </div>
        </li>
    );
}

export function TemplatesView() {
    const online = useOnline();
    const {settings, save: saveSettings} = useSettings();
    const tpl = useAsync(() => api.templates.list(), []);
    const [editor, setEditor] = useState<EditorState | null>(null);
    const [apply, setApply] = useState<ApplyTarget | null>(null);
    const [del, setDel] = useState<Template | null>(null);
    const [importing, setImporting] = useState(false);
    const [busyKey, setBusyKey] = useState<string | null>(null);
    const list = tpl.data ?? [];
    const MI = "min-h-10 md:min-h-8";

    const setDefault = async (key: string, label: string, style: QrStyle) => {
        setBusyKey(key);
        try {
            const fresh = await api.settings.get();
            await saveSettings({...fresh, defaultStyle: style});
            toast.success(`“${label}” is now your default style`);
        } catch (e) {
            toast.error(errMsg(e, "Could not update your default style"));
        } finally {
            setBusyKey(null);
        }
    };

    const saveBuiltIn = async (p: Preset, announce = true): Promise<Template> => {
        const style = presetStyle(p.id);
        const existing = list.find((t) => t.name === p.name && sameStyle(t.style, style));
        if (existing) {
            if (announce) toast.message(`“${p.name}” is already in your templates`);
            return existing;
        }
        const t = await api.templates.create(p.name, style);
        tpl.setData((prev) => [...(prev ?? []), t]);
        toast.success(`Saved “${p.name}” to your templates`);
        return t;
    };

    const onSaved = (t: Template, created: boolean) => {
        tpl.setData((prev) => (created ? [...(prev ?? []), t] : (prev ?? []).map((x) => (x.id === t.id ? t : x))));
        setEditor(null);
    };

    const exportAll = () => {
        downloadBlob(new Blob([buildExport(list)], {type: "application/json"}), "qr-studio-templates.json");
        toast.success(`Exported ${list.length} ${list.length === 1 ? "template" : "templates"}`, {description: "Logos only work when imported into this same database."});
    };

    return (
        <div>
            <PageHeader
                title="Templates"
                description="Save a look or apply it to existing codes."
                actions={
                    <>
                        <Button className={TAP} disabled={!online}
                                onClick={() => setEditor({kind: "create", name: "", style: settings.defaultStyle})}>
                            <Plus/> New template
                        </Button>
                        <DropdownMenu>
                            <DropdownMenuTrigger render={<Button variant="outline"
                                                                 className={TAP}/>}><MoreHorizontal/> Manage</DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                <DropdownMenuItem className={MI} disabled={!online}
                                                  onClick={() => setImporting(true)}><FileUp/> Import</DropdownMenuItem>
                                <DropdownMenuItem className={MI} disabled={list.length === 0}
                                                  onClick={exportAll}><FileDown/> Export</DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </>
                }
            />
            {!online ?
                <InfoNotice tone="warn" className="mb-4">You&apos;re offline. Built-in presets are shown below, but
                    saving, applying and importing templates need a connection.</InfoNotice> : null}

            <section aria-labelledby="mine-h" className="mb-8">
                <h2 id="mine-h" className="mb-3 text-base font-medium">Your templates</h2>
                {tpl.error && !tpl.data ? (
                    <ErrorNotice title="Could not load your templates" message={tpl.error.message}
                                 onRetry={() => void tpl.refresh()}/>
                ) : !tpl.data ? (
                    <div aria-busy="true" aria-label="Loading templates"
                         className="grid grid-cols-1 gap-3 min-[370px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="aspect-[4/5]"/>)}
                    </div>
                ) : list.length === 0 ? (
                    <p className="flex items-center gap-2 text-sm text-muted-foreground"><Layers3 className="size-4"
                                                                                                  aria-hidden/> Save a
                        preset below to start your collection.</p>
                ) : (
                    <>
                        {tpl.error ? <ErrorNotice className="mb-3" title="Could not refresh templates"
                                                  message={tpl.error.message}
                                                  onRetry={() => void tpl.refresh()}/> : null}
                        <ul className="grid grid-cols-1 gap-3 min-[370px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                            {list.map((t) => (
                                <Card key={t.id} title={t.name} style={t.style}
                                      isDefault={sameStyle(settings.defaultStyle, t.style)}>
                                    <div className="flex items-center justify-between gap-1">
                                        <Button variant="secondary" className={TAP} disabled={!online}
                                                aria-label={`Apply ${t.name} to codes`} onClick={() => setApply({
                                            kind: "user",
                                            template: t
                                        })}><WandSparkles/> Apply</Button>
                                        <DropdownMenu>
                                            <DropdownMenuTrigger
                                                render={<Button variant="ghost" size="icon" className="tap"
                                                                aria-label={`More actions for ${t.name}`}/>}><MoreHorizontal/></DropdownMenuTrigger>
                                            <DropdownMenuContent align="end">
                                                <DropdownMenuItem className={MI} disabled={!online || busyKey !== null}
                                                                  onClick={() => void setDefault(`t:${t.id}`, t.name, t.style)}><Star/> Use
                                                    as default</DropdownMenuItem>
                                                <DropdownMenuItem className={MI} disabled={!online}
                                                                  onClick={() => setEditor({
                                                                      kind: "edit",
                                                                      template: t
                                                                  })}><Pencil/> Edit</DropdownMenuItem>
                                                <DropdownMenuItem className={MI} disabled={!online}
                                                                  onClick={() => setDel(t)}><Trash2/> Delete</DropdownMenuItem>
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    </div>
                                </Card>
                            ))}
                        </ul>
                    </>
                )}
                <p className="mt-3 text-xs text-muted-foreground">{LOGO_NOTE}</p>
            </section>

            <section aria-labelledby="builtin-h">
                <h2 id="builtin-h" className="mb-3 text-base font-medium">Built-in presets</h2>
                <ul className="grid grid-cols-1 gap-3 min-[370px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {PRESETS.map((p) => {
                        const style = presetStyle(p.id);
                        return (
                            <Card key={p.id} title={p.name} style={style}
                                  isDefault={settings.defaultStyle.preset === p.id}>
                                <div className="flex items-center justify-between gap-1">
                                    <Button variant="secondary" className={TAP} disabled={!online}
                                            aria-label={`Apply ${p.name} to codes`}
                                            onClick={() => setApply({kind: "preset", preset: p})}><WandSparkles/> Apply</Button>
                                    <DropdownMenu>
                                        <DropdownMenuTrigger render={<Button variant="ghost" size="icon" className="tap"
                                                                             aria-label={`More actions for ${p.name}`}/>}>
                                            <MoreHorizontal/>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end" className="min-w-52">
                                            <DropdownMenuItem className={MI} disabled={!online || busyKey !== null}
                                                              onClick={() => void setDefault(`p:${p.id}`, p.name, {
                                                                  ...style,
                                                                  size: settings.defaultStyle.size
                                                              })}><Star/> Use as default</DropdownMenuItem>
                                            <DropdownMenuItem className={MI} disabled={!online}
                                                              onClick={() => void saveBuiltIn(p).catch((e) => toast.error(errMsg(e)))}><CopyPlus/> Save
                                                to my templates</DropdownMenuItem>
                                            <DropdownMenuItem className={MI} disabled={!online}
                                                              onClick={() => setEditor({
                                                                  kind: "create",
                                                                  name: `${p.name} copy`,
                                                                  style
                                                              })}><Pencil/> Customize…</DropdownMenuItem>
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                </div>
                            </Card>
                        );
                    })}
                </ul>
            </section>

            <TemplateEditor state={editor} templates={list} defaultStyle={settings.defaultStyle} offline={!online}
                            onClose={() => setEditor(null)} onSaved={onSaved}/>
            <ApplyDialog
                open={apply !== null}
                name={apply ? (apply.kind === "user" ? apply.template.name : apply.preset.name) : ""}
                builtIn={apply?.kind === "preset"}
                offline={!online}
                resolveTemplateId={async () => {
                    if (!apply) throw new Error("No template selected");
                    return apply.kind === "user" ? apply.template.id : (await saveBuiltIn(apply.preset, false)).id;
                }}
                onClose={() => setApply(null)}
            />
            <ImportTemplatesDialog
                open={importing}
                existingNames={list.map((t) => t.name)}
                offline={!online}
                onClose={() => setImporting(false)}
                onImported={(created) => tpl.setData((prev) => [...(prev ?? []), ...created])}
            />
            <ConfirmDialog
                open={del !== null}
                onOpenChange={(o) => !o && setDel(null)}
                title={`Delete “${del?.name ?? ""}”?`}
                description="Codes that already use this look keep it. Only the saved template is removed."
                confirmLabel="Delete template"
                onConfirm={async () => {
                    if (!del) return;
                    await api.templates.remove(del.id);
                    tpl.setData((prev) => (prev ?? []).filter((t) => t.id !== del.id));
                    toast.success("Template deleted");
                }}
            />
        </div>
    );
}
