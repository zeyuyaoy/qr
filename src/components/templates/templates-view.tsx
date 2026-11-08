"use client";
import { CopyPlus, FileDown, FileUp, Layers3, Loader2, MoreHorizontal, Pencil, Plus, Star, Trash2, WandSparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog, ErrorNotice, errMsg, InfoNotice, saveTextFile, Skeleton, TAP } from "@/components/library/common";
import { LazyQr } from "@/components/library/lazy-qr";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { api } from "@/lib/client/api";
import { useAsync, useOnline, useSettings } from "@/lib/client/hooks";
import { PRESETS, presetStyle, type Preset } from "@/lib/qr/style";
import type { QrStyle, Template } from "@/lib/schema";
import { ApplyDialog } from "./apply-dialog";
import { ImportTemplatesDialog } from "./import-templates-dialog";
import { TemplateEditor, type EditorState } from "./template-editor";
import { buildExport, LOGO_NOTE, SAMPLE_DATA, sameStyle } from "./templates-io";

type ApplyTarget = { kind: "user"; template: Template } | { kind: "preset"; preset: Preset };

function Card({ title, style, isDefault, children }: { title: string; style: QrStyle; isDefault: boolean; children: React.ReactNode }) {
  return (
    <li className="flex min-w-0 flex-col overflow-hidden rounded-xl bg-card text-card-foreground ring-1 ring-foreground/10">
      <div className="p-3 pb-0">
        <LazyQr data={SAMPLE_DATA} style={style} size={240} label={`Preview of the ${title} style`} />
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="min-w-0 flex-1 truncate text-sm font-medium">{title}</h3>
          {isDefault ? <Badge variant="secondary"><Star className="fill-current" aria-hidden /> Default</Badge> : null}
        </div>
        {children}
      </div>
    </li>
  );
}

export function TemplatesView() {
  const online = useOnline();
  const { settings, save: saveSettings } = useSettings();
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
      // Re-read first so a stale local copy of the other settings can never overwrite the saved ones.
      const fresh = await api.settings.get();
      await saveSettings({ ...fresh, defaultStyle: style });
      toast.success(`“${label}” is now your default style`);
    } catch (e) {
      toast.error(errMsg(e, "Could not update your default style"));
    } finally {
      setBusyKey(null);
    }
  };

  /** Built-in presets can only be applied once they exist as a saved template. */
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
    saveTextFile("qr-studio-templates.json", buildExport(list));
    toast.success(`Exported ${list.length} ${list.length === 1 ? "template" : "templates"}`, { description: "Logos only work when imported into this same database." });
  };

  return (
    <div>
      <PageHeader
        title="Templates"
        description="Reusable looks for your QR codes. Set one as your default, or restyle codes you've already made."
        actions={
          <>
            <Button className={TAP} disabled={!online} onClick={() => setEditor({ kind: "create", name: "", style: settings.defaultStyle })}>
              <Plus /> New template
            </Button>
            <Button variant="outline" className={TAP} disabled={!online} onClick={() => setImporting(true)}>
              <FileUp /> Import
            </Button>
            <Button variant="outline" className={TAP} disabled={list.length === 0} onClick={exportAll}>
              <FileDown /> Export
            </Button>
          </>
        }
      />
      {!online ? <InfoNotice tone="warn" className="mb-4">You&apos;re offline. Built-in presets are shown below, but saving, applying and importing templates need a connection.</InfoNotice> : null}

      <section aria-labelledby="mine-h" className="mb-8">
        <h2 id="mine-h" className="mb-3 text-base font-medium">Your templates</h2>
        {tpl.error && !tpl.data ? (
          <ErrorNotice title="Could not load your templates" message={tpl.error.message} onRetry={() => void tpl.refresh()} />
        ) : !tpl.data ? (
          <div aria-busy="true" aria-label="Loading templates" className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="aspect-[4/5]" />)}
          </div>
        ) : list.length === 0 ? (
          <div className="grid place-items-center gap-2 rounded-2xl border border-dashed px-4 py-10 text-center">
            <Layers3 className="size-8 text-muted-foreground" aria-hidden />
            <p className="font-medium">No saved templates yet</p>
            <p className="max-w-sm text-sm text-muted-foreground">Create one from scratch, or save a built-in preset below to make it yours.</p>
            <Button className={TAP} disabled={!online} onClick={() => setEditor({ kind: "create", name: "", style: settings.defaultStyle })}><Plus /> New template</Button>
          </div>
        ) : (
          <>
            {tpl.error ? <ErrorNotice className="mb-3" title="Could not refresh templates" message={tpl.error.message} onRetry={() => void tpl.refresh()} /> : null}
            <ul className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {list.map((t) => (
                <Card key={t.id} title={t.name} style={t.style} isDefault={sameStyle(settings.defaultStyle, t.style)}>
                  <div className="grid grid-cols-[1fr_auto_auto] gap-1.5">
                    <Button variant="outline" className={TAP} disabled={!online || busyKey !== null} onClick={() => void setDefault(`t:${t.id}`, t.name, t.style)}>
                      {busyKey === `t:${t.id}` ? <Loader2 className="animate-spin" /> : null} Use as default
                    </Button>
                    <Button variant="ghost" size="icon" className="tap" aria-label={`Edit ${t.name}`} disabled={!online} onClick={() => setEditor({ kind: "edit", template: t })}><Pencil /></Button>
                    <Button variant="ghost" size="icon" className="tap" aria-label={`Delete ${t.name}`} disabled={!online} onClick={() => setDel(t)}><Trash2 /></Button>
                  </div>
                  <Button variant="secondary" className={TAP} disabled={!online} onClick={() => setApply({ kind: "user", template: t })}>
                    <WandSparkles /> Apply to codes…
                  </Button>
                </Card>
              ))}
            </ul>
          </>
        )}
        <p className="mt-3 text-xs text-muted-foreground">{LOGO_NOTE}</p>
      </section>

      <section aria-labelledby="builtin-h">
        <h2 id="builtin-h" className="mb-3 text-base font-medium">Built-in presets</h2>
        <ul className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {PRESETS.map((p) => {
            const style = presetStyle(p.id);
            return (
              <Card key={p.id} title={p.name} style={style} isDefault={settings.defaultStyle.preset === p.id}>
                <div className="grid grid-cols-[1fr_auto] gap-1.5">
                  <Button variant="outline" className={TAP} disabled={!online || busyKey !== null} onClick={() => void setDefault(`p:${p.id}`, p.name, { ...style, size: settings.defaultStyle.size })}>
                    {busyKey === `p:${p.id}` ? <Loader2 className="animate-spin" /> : null} Use as default
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger render={<Button variant="ghost" size="icon" className="tap" aria-label={`More actions for ${p.name}`} />}>
                      <MoreHorizontal />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-52">
                      <DropdownMenuItem className={MI} disabled={!online} onClick={() => void saveBuiltIn(p).catch((e) => toast.error(errMsg(e)))}><CopyPlus /> Save to my templates</DropdownMenuItem>
                      <DropdownMenuItem className={MI} disabled={!online} onClick={() => setEditor({ kind: "create", name: `${p.name} copy`, style })}><Pencil /> Customize…</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <Button variant="secondary" className={TAP} disabled={!online} onClick={() => setApply({ kind: "preset", preset: p })}>
                  <WandSparkles /> Apply to codes…
                </Button>
              </Card>
            );
          })}
        </ul>
      </section>

      <TemplateEditor state={editor} templates={list} defaultStyle={settings.defaultStyle} offline={!online} onClose={() => setEditor(null)} onSaved={onSaved} />
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
