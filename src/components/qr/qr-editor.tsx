"use client";
import { Check, Copy, Download, Loader2, Printer, RotateCcw, Save, Share2, Star, Pin, TriangleAlert, WifiOff } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, NativeSelect, TextField } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ApiClientError, api } from "@/lib/client/api";
import { useOnline, useSettings, useStatus } from "@/lib/client/hooks";
import { resolveLogoUrl } from "@/lib/client/logo";
import { drafts, saveEdit, saveNew, type CachedView } from "@/lib/client/offline";
import { deviceTimeZone } from "@/lib/client/time";
import { TYPES, clientAppUrl, encodePayload, isDynamicCapable, qrData, shortUrl } from "@/lib/qr/payload";
import { parseScanned } from "@/lib/qr/parse";
import { blobToDataUrl, renderBlob } from "@/lib/qr/render";
import { copyImage, downloadBlob, makeFilename, printHtml, shareFile } from "@/lib/qr/export";
import { checkReadability, hasBlockingIssue } from "@/lib/qr/readability";
import { SENSITIVE_TYPES, FORMATS, defaultStyle, type ContentType, type ExportFormat, type Folder, type QrStyle, type QrView } from "@/lib/schema";
import { appHost, checkDestination } from "@/lib/url-safety";
import { LinkControls, defaultLinkSettings, linkFields, linkSettingsFromView, type LinkSettings } from "./link-controls";
import { QrPreview } from "./qr-preview";
import { StyleEditor } from "./style-editor";
import { TypeFields, TypePicker, emptyFields } from "./type-fields";

type F = Record<string, unknown>;
const DRAFT_KEY = "editor";
const card = "rounded-2xl border bg-card p-4";

type DraftState = { type: ContentType; fieldsByType: Partial<Record<ContentType, F>>; qrMode: "static" | "dynamic"; style: QrStyle; name: string; description: string; tags: string[]; folder: string | null; link: Omit<LinkSettings, "password"> };

function autoName(type: ContentType, payload: string, fields: F): string {
  try {
    if (type === "url" || type === "social" || type === "doi") return new URL(payload).hostname.replace(/^www\./, "") + (new URL(payload).pathname.length > 1 ? new URL(payload).pathname.slice(0, 24) : "");
  } catch {}
  if (type === "wifi") return `Wi-Fi ${String(fields.ssid ?? "")}`.trim();
  if (type === "vcard") return `${String(fields.firstName ?? "")} ${String(fields.lastName ?? "")}`.trim() || "Contact";
  if (type === "event") return String(fields.title ?? "Event");
  return `${TYPES[type].label}: ${payload.slice(0, 30)}`.trim();
}

export function QrEditor({ mode, initial, onSaved }: { mode: "create" | "edit"; initial?: QrView; onSaved?: (v: QrView) => void }) {
  const router = useRouter();
  const params = useSearchParams();
  const online = useOnline();
  const { settings, loaded } = useSettings();
  const { data: status } = useStatus();
  const tz = settings.timezone && settings.timezone !== "UTC" ? settings.timezone : mode === "create" ? deviceTimeZone() : settings.timezone;

  // ---------------- state
  const [type, setType] = useState<ContentType>(initial?.type ?? "url");
  const [fieldsByType, setFieldsByType] = useState<Partial<Record<ContentType, F>>>(initial ? { [initial.type]: initial.fields as F } : {});
  const [qrMode, setQrMode] = useState<"static" | "dynamic">(initial?.mode ?? "static");
  const [style, setStyle] = useState<QrStyle>(initial?.style ?? defaultStyle());
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [tags, setTags] = useState<string[]>(initial?.tags ?? []);
  const [tagInput, setTagInput] = useState("");
  const [folder, setFolder] = useState<string | null>(initial?.folder ?? null);
  const [favorite, setFavorite] = useState(initial?.favorite ?? false);
  const [pinned, setPinned] = useState(initial?.pinned ?? false);
  const [link, setLink] = useState<LinkSettings>(initial ? linkSettingsFromView(initial) : defaultLinkSettings());
  const [folders, setFolders] = useState<(Folder & { count: number })[]>([]);
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [attempted, setAttempted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [current, setCurrent] = useState<CachedView | null>(initial ?? null);
  const [conflict, setConflict] = useState<QrView | null>(null);
  const [slugError, setSlugError] = useState<string | undefined>();
  const [restored, setRestored] = useState(false);
  const [format, setFormat] = useState<ExportFormat>("png");
  const [fileBase, setFileBase] = useState<string | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);
  const pristine = useRef(true);
  const initialised = useRef(mode === "edit");
  const baseline = useRef<string>("");

  const fields = useMemo<F>(() => ({ ...emptyFields(type, tz), ...(fieldsByType[type] ?? {}) }), [fieldsByType, type, tz]);
  const setFields = (f: F) => ((pristine.current = false), setFieldsByType((m) => ({ ...m, [type]: f })));

  // ---------------- defaults, prefill, draft restore (create mode only)
  useEffect(() => {
    if (initialised.current || !loaded) return;
    initialised.current = true;
    if (!pristine.current) return;
    setStyle(settings.defaultStyle);
    setFormat(settings.format);
    setStyle((s) => ({ ...s, size: settings.size }));
    const content = params.get("content");
    const sharedUrl = params.get("url");
    const sharedText = params.get("text") ?? params.get("title");
    if (content || sharedUrl || sharedText) {
      const raw = content ?? sharedUrl ?? sharedText ?? "";
      const p = parseScanned(raw);
      setType(p.type);
      setFieldsByType({ [p.type]: p.fields });
      setQrMode(p.type === "url" ? settings.mode : "static");
      pristine.current = false;
      toast.message(content ? "Content loaded from scan" : "Shared content loaded");
      return;
    }
    setQrMode(settings.mode);
    void drafts.load<DraftState>(DRAFT_KEY).then((d) => {
      if (!d || !pristine.current) return;
      const s = d.state;
      setType(s.type); setFieldsByType(s.fieldsByType); setQrMode(s.qrMode); setStyle(s.style); setName(s.name); setDescription(s.description); setTags(s.tags); setFolder(s.folder);
      setLink({ ...s.link, password: undefined });
      setRestored(true);
      pristine.current = false;
    });
  }, [loaded, settings, params]);

  useEffect(() => {
    api.folders.list().then(setFolders).catch(() => undefined);
  }, []);

  // ---------------- derived QR content
  const typeDef = TYPES[type];
  const canDynamic = isDynamicCapable(type);
  const dynamic = qrMode === "dynamic" && canDynamic;
  const enc = useMemo(() => encodePayload(type, fields), [type, fields]);
  const example = useMemo(() => encodePayload(type, typeDef.example), [type, typeDef]);
  const payload = enc.ok ? enc.payload : "";
  const destCheck = useMemo(() => (dynamic && enc.ok ? checkDestination(enc.payload, { appHost: appHost(clientAppUrl()) }) : { ok: true as const, url: "" }), [dynamic, enc]);
  const shown = enc.ok ? qrData({ mode: dynamic ? "dynamic" : "static", payload, slug: link.slug || null }, clientAppUrl()) : example.ok ? example.payload : "https://example.com";
  const errors = !enc.ok ? Object.fromEntries(Object.entries(enc.errors).filter(([k]) => attempted || touched.has(k))) : {};
  const displayName = name.trim() || (enc.ok ? autoName(type, payload, fields) : typeDef.label);
  const issues = useMemo(() => checkReadability(style, shown, Boolean(style.logo.assetId)), [style, shown]);
  const blocking = hasBlockingIssue(issues);
  const sensitive = SENSITIVE_TYPES.includes(type);
  const sealingMissing = sensitive && status && !status.sealing;
  const filename = (fileBase ?? makeFilename(settings.filenameTemplate, { name: displayName, type, slug: link.slug }, format).replace(/\.[^.]+$/, "")) || "qr-code";

  // ---------------- draft autosave & dirty tracking
  const snapshot = JSON.stringify({ type, fields, qrMode, style, name, description, tags, folder, favorite, pinned, link: { ...link, password: typeof link.password } });
  useEffect(() => {
    if (mode === "edit" && !baseline.current) baseline.current = snapshot;
  }, [mode, snapshot]);
  const dirty = mode === "edit" ? baseline.current !== "" && baseline.current !== snapshot : !pristine.current;
  useEffect(() => {
    if (mode !== "create" || pristine.current || current) return;
    const t = setTimeout(() => {
      const { password: _p, ...linkSafe } = link;
      void _p;
      void drafts.save<DraftState>(DRAFT_KEY, { type, fieldsByType: { ...fieldsByType, [type]: fields }, qrMode, style, name, description, tags, folder, link: linkSafe });
    }, 800);
    return () => clearTimeout(t);
  }, [mode, current, type, fields, fieldsByType, qrMode, style, name, description, tags, folder, link]);
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => (e.preventDefault(), (e.returnValue = ""));
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const touch = useCallback((k: string) => setTouched((s) => new Set(s).add(k)), []);
  const mark = <T,>(setter: (v: T) => void) => (v: T) => ((pristine.current = false), setter(v));

  // ---------------- export actions
  const getBlob = async (f: ExportFormat) => renderBlob({ data: shown, style, logoUrl: await resolveLogoUrl(style.logo.assetId), format: f, size: style.size });
  const guard = (label: string, fn: () => Promise<void>) => async () => {
    if (!enc.ok) return void (setAttempted(true), toast.error("Fill in the content first"));
    setExporting(label);
    try { await fn(); } catch (e) { toast.error(e instanceof Error ? e.message : "Export failed"); } finally { setExporting(null); }
  };
  const download = guard("download", async () => downloadBlob(await getBlob(format), `${filename}.${format}`));
  const copy = guard("copy", async () => {
    const r = await copyImage(getBlob("png"));
    toast[r === "copied" ? "success" : "error"](r === "copied" ? "Image copied" : r === "denied" ? "Clipboard permission was denied" : "Copying images isn't supported in this browser — use Download");
  });
  const share = guard("share", async () => {
    const blob = await getBlob("png");
    const r = await shareFile(blob, `${filename}.png`, { title: displayName, text: dynamic ? shown : undefined, url: dynamic ? shown : undefined });
    if (r === "unsupported") toast.message("Sharing isn't supported here. Use Download or Copy instead.");
  });
  const print = guard("print", async () => printHtml(displayName, [{ name: displayName, dataUrl: await blobToDataUrl(await getBlob("png")) }]));

  // ---------------- save
  const buildFields = () => ({
    name: displayName,
    description,
    type,
    mode: dynamic ? ("dynamic" as const) : ("static" as const),
    fields,
    payload,
    style,
    tags,
    folder,
    favorite,
    pinned,
    ...linkFields(link, dynamic),
  });

  const save = async (asCopy = false) => {
    setAttempted(true);
    setSlugError(undefined);
    if (!enc.ok) return void toast.error("Some fields need attention");
    if (!destCheck.ok) return void toast.error(destCheck.reason);
    if (sealingMissing) return void toast.error("Saving Wi-Fi and contact codes needs DATA_ENCRYPTION_KEY on the server (see Settings → Data & storage).");
    if (!online && typeof link.password === "string") return void toast.error("Passwords can't be set while offline. Remove it or reconnect.");
    setSaving(true);
    try {
      const body = buildFields();
      let result: { view: CachedView; queued: boolean };
      if (current && !asCopy) {
        const { slug: _s, ...rest } = body as typeof body & { slug?: string };
        void _s;
        const patch: Record<string, unknown> = { ...rest, ...(dynamic ? { slug: link.slug } : {}) };
        if (link.password !== undefined) patch.password = link.password;
        result = await saveEdit(current, patch);
      } else {
        result = await saveNew({ ...body, ...(typeof link.password === "string" ? { password: link.password } : {}) } as never);
      }
      setCurrent(result.view);
      baseline.current = snapshot;
      pristine.current = true;
      setConflict(null);
      void drafts.remove(DRAFT_KEY);
      setLink((l) => ({ ...l, password: undefined, hasPassword: result.view.hasPassword }));
      toast.success(result.queued ? (dynamic ? "Saved offline — this link isn't live until it syncs" : "Saved offline — will sync when you're back online") : "Saved");
      onSaved?.(result.view);
    } catch (e) {
      if (e instanceof ApiClientError) {
        if (e.code === "REV_MISMATCH") setConflict((e.details as { current: QrView }).current);
        else if (e.code === "SLUG_TAKEN") { setSlugError("That slug is already in use"); toast.error("That slug is already in use"); }
        else toast.error(e.message);
      } else toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    setCurrent(null); setName(""); setDescription(""); setTags([]); setFolder(null); setFavorite(false); setPinned(false);
    setFieldsByType({}); setLink(defaultLinkSettings()); setTouched(new Set()); setAttempted(false); setFileBase(null); setRestored(false);
    pristine.current = true;
    void drafts.remove(DRAFT_KEY);
    router.replace("/");
  };

  const addTag = (raw: string) => {
    const t = raw.trim().toLowerCase().replace(/[^a-z0-9 _-]/g, "").slice(0, 32);
    if (t && !tags.includes(t) && tags.length < 20) mark(setTags)([...tags, t]);
    setTagInput("");
  };

  const typeChange = (t: ContentType) => {
    pristine.current = false;
    setType(t);
    if (!isDynamicCapable(t)) setQrMode("static");
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px] xl:items-start">
      {/* ---------- content ---------- */}
      <section aria-labelledby="content-h" className={`${card} order-1 grid gap-4 xl:col-start-1`}>
        <h2 id="content-h" className="sr-only">Content</h2>
        {restored && (
          <div role="status" className="flex items-center justify-between gap-2 rounded-lg bg-muted px-3 py-2 text-sm">
            <span>Draft restored from this device.</span>
            <Button size="sm" variant="ghost" onClick={reset}><RotateCcw /> Discard</Button>
          </div>
        )}
        <TypePicker value={type} onChange={typeChange} />
        <p className="-mt-2 text-sm text-muted-foreground">{typeDef.description}</p>
        <TypeFields type={type} fields={fields} errors={errors} onChange={setFields} onTouch={touch} timezone={tz} />
        {errors._ && <p role="alert" className="text-sm text-destructive">{errors._}</p>}
        {!destCheck.ok && <p role="alert" className="text-sm text-destructive">{destCheck.reason}</p>}
        {sensitive && <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">{type === "wifi" ? "This code contains the network password in readable form. Only share it with people you trust. Wi-Fi and contact codes are always static — they can't be remotely disabled once distributed." : "Contact details are embedded in the code itself and can't be recalled once printed or shared."}</p>}

        {canDynamic && (
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">Code type</legend>
            <div className="grid grid-cols-2 gap-2">
              {(["static", "dynamic"] as const).map((m) => (
                <label key={m} className={`tap flex cursor-pointer flex-col rounded-xl border p-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-muted ${m === "dynamic" && !online ? "opacity-70" : ""}`}>
                  <input type="radio" name="qr-mode" className="sr-only" checked={qrMode === m} onChange={() => mark(setQrMode)(m)} />
                  <span className="font-medium">{m === "static" ? "Static" : "Dynamic"}</span>
                  <span className="text-xs text-muted-foreground">{m === "static" ? "Encodes the content directly. Works forever, can't be changed." : "Encodes a short link you can edit, pause, expire and track."}</span>
                </label>
              ))}
            </div>
            {dynamic && mode === "edit" && initial?.mode === "static" && <p className="text-xs text-amber-700 dark:text-amber-300">Switching to dynamic changes the image: previously printed static codes keep pointing to the old destination.</p>}
            {!dynamic && mode === "edit" && initial?.mode === "dynamic" && <p className="text-xs text-destructive">Switching to static releases the short link — codes already printed with it will stop working.</p>}
          </fieldset>
        )}
      </section>

      {/* ---------- preview & actions ---------- */}
      <aside aria-label="Preview and actions" className="order-2 grid gap-3 xl:sticky xl:top-16 xl:col-start-2 xl:row-span-4 xl:row-start-1">
        <div className={`${card} grid gap-3`}>
          <div className="mx-auto w-full max-w-[320px]">
            <QrPreview data={shown} style={style} size={512} label={`QR code for ${displayName}`} className={!enc.ok ? "opacity-40" : undefined} />
          </div>
          {!enc.ok && <p className="text-center text-xs text-muted-foreground">Example preview — fill in the details to generate your code.</p>}
          {dynamic && (
            <p className="break-all text-center text-xs text-muted-foreground">
              Encodes <span className="font-mono">{shortUrl(clientAppUrl(), link.slug || "…")}</span>
              {!current && <> · <strong>not live until saved</strong></>}
              {current && current._pending === "create" && <> · <strong>pending sync — not live yet</strong></>}
            </p>
          )}
          {blocking && <p role="alert" className="flex items-start gap-1.5 rounded-lg bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive"><TriangleAlert className="mt-0.5 size-3.5 shrink-0" /> This design may not scan reliably — see the checks under Customize.</p>}

          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
            <Field label="File name">{(a) => <input {...a} value={filename} onChange={(e) => setFileBase(e.target.value.replace(/[\\/:*?"<>|]/g, "-"))} className="h-10 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm" />}</Field>
            <Field label="Format">{(a) => <NativeSelect {...a} value={format} onChange={(e) => setFormat(e.target.value as ExportFormat)}>{FORMATS.map((f) => <option key={f} value={f}>{f.toUpperCase()}</option>)}</NativeSelect>}</Field>
          </div>
          <div className="grid grid-cols-4 gap-2">
            <Button className="tap col-span-2" onClick={download} disabled={!!exporting}>{exporting === "download" ? <Loader2 className="animate-spin" /> : <Download />} Download</Button>
            <Button variant="outline" className="tap" onClick={copy} disabled={!!exporting} aria-label="Copy image"><Copy /><span className="sr-only">Copy</span></Button>
            <Button variant="outline" className="tap" onClick={share} disabled={!!exporting} aria-label="Share"><Share2 /><span className="sr-only">Share</span></Button>
          </div>
          <Button variant="ghost" className="tap justify-self-start" onClick={print} disabled={!!exporting}><Printer /> Print</Button>
        </div>

        <div className={`${card} grid gap-3`}>
          {conflict && (
            <div role="alert" className="grid gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
              <p>This code was changed on another device (revision {conflict.rev}). Your edits were not saved.</p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => { setCurrent(conflict); baseline.current = ""; setConflict(null); toast.message("Now based on the latest version — re-apply your edits"); }}>Use latest as base</Button>
                <Button size="sm" onClick={() => { setName(`${displayName} (my edit)`.slice(0, 120)); void save(true); }}>Save mine as a copy</Button>
              </div>
            </div>
          )}
          {sealingMissing && <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">Saving this type to the server is disabled: <code>DATA_ENCRYPTION_KEY</code> isn&apos;t set, and Redis Cloud Free has no TLS, so secrets can&apos;t be stored safely. Export works fine.</p>}
          {!online && <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><WifiOff className="size-3.5" /> Offline — saving queues the change{dynamic ? "; the link won't be live until it syncs" : ""}.</p>}
          <Button size="lg" className="tap" onClick={() => void save()} disabled={saving || !!sealingMissing}>
            {saving ? <Loader2 className="animate-spin" /> : current && !current._pending ? <Check /> : <Save />}
            {current ? (dirty ? "Save changes" : "Saved") : "Save to library"}
          </Button>
          {current && (
            <div className="flex flex-wrap gap-2 text-sm">
              {mode === "create" && <Link className="underline" href={`/library/${current.id}`}>Open in library</Link>}
              {mode === "create" && <button type="button" className="underline" onClick={reset}>Create another</button>}
              {mode === "edit" && <Button size="sm" variant="ghost" onClick={() => void save(true)}>Save as new copy</Button>}
            </div>
          )}
          {dirty && !saving && <p className="text-xs text-muted-foreground" role="status">{mode === "create" ? "Draft auto-saved on this device." : "Unsaved changes."}</p>}
        </div>
      </aside>

      {/* ---------- details & options ---------- */}
      <section aria-label="Options" className="order-3 grid gap-3 xl:col-start-1">
        <details className={`${card} group`} open={mode === "edit"}>
          <summary className="tap flex cursor-pointer list-none items-center justify-between font-medium [&::-webkit-details-marker]:hidden">Details <span aria-hidden className="text-muted-foreground transition-transform group-open:rotate-90">›</span></summary>
          <div className="mt-3 grid gap-3">
            <TextField label="Name" value={name} placeholder={enc.ok ? autoName(type, payload, fields) : "Untitled"} maxLength={120} onChange={(e) => mark(setName)(e.target.value)} />
            <Field label="Description">{(a) => <Textarea {...a} rows={2} maxLength={500} value={description} onChange={(e) => mark(setDescription)(e.target.value)} />}</Field>
            <Field label="Tags" hint="Press Enter or comma to add.">
              {(a) => (
                <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-input px-2 py-1.5">
                  {tags.map((t) => <button key={t} type="button" onClick={() => mark(setTags)(tags.filter((x) => x !== t))} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs" aria-label={`Remove tag ${t}`}>{t} ×</button>)}
                  <input {...a} value={tagInput} onChange={(e) => (e.target.value.endsWith(",") ? addTag(e.target.value) : setTagInput(e.target.value))} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(tagInput); } if (e.key === "Backspace" && !tagInput && tags.length) mark(setTags)(tags.slice(0, -1)); }} onBlur={() => addTag(tagInput)} className="h-9 min-w-24 flex-1 bg-transparent text-sm outline-none" />
                </div>
              )}
            </Field>
            <Field label="Folder">{(a) => <NativeSelect {...a} value={folder ?? ""} onChange={(e) => mark(setFolder)(e.target.value || null)}><option value="">No folder</option>{folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</NativeSelect>}</Field>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex items-center justify-between gap-2 text-sm"><span className="inline-flex items-center gap-1.5"><Star className="size-4" /> Favourite</span><Switch checked={favorite} onCheckedChange={mark(setFavorite)} aria-label="Favourite" /></label>
              <label className="flex items-center justify-between gap-2 text-sm"><span className="inline-flex items-center gap-1.5"><Pin className="size-4" /> Pin to top</span><Switch checked={pinned} onCheckedChange={mark(setPinned)} aria-label="Pin to top" /></label>
            </div>
          </div>
        </details>

        {dynamic && (
          <details className={`${card} group`} open={mode === "edit" || undefined}>
            <summary className="tap flex cursor-pointer list-none items-center justify-between font-medium [&::-webkit-details-marker]:hidden">Link controls — schedule, limits, password <span aria-hidden className="text-muted-foreground transition-transform group-open:rotate-90">›</span></summary>
            <div className="mt-3"><LinkControls value={link} onChange={mark(setLink)} timezone={tz} errors={{ slug: slugError ?? "", ...(slugError ? {} : {}) }} /></div>
          </details>
        )}

        <details className={`${card} group`}>
          <summary className="tap flex cursor-pointer list-none items-center justify-between font-medium [&::-webkit-details-marker]:hidden">Customize <span aria-hidden className="text-muted-foreground transition-transform group-open:rotate-90">›</span></summary>
          <div className="mt-3"><StyleEditor value={style} onChange={mark(setStyle)} payload={shown} /></div>
        </details>
      </section>
    </div>
  );
}
