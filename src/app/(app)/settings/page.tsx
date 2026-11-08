"use client";
import { Loader2, RefreshCw, Save, Undo2 } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { AccountSection } from "@/components/settings/account-section";
import { AnalyticsSection } from "@/components/settings/analytics-section";
import { BackupSection } from "@/components/settings/backup-section";
import { BrandingSection } from "@/components/settings/branding-section";
import { DataSection } from "@/components/settings/data-section";
import { DefaultsSection, validZone } from "@/components/settings/defaults-section";
import type { SectionProps } from "@/components/settings/types";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/client/api";
import { useAsync, useOnline, useSettings } from "@/lib/client/hooks";
import { settingsSchema, type Settings } from "@/lib/schema";

const NAV = [
  ["defaults", "Defaults"],
  ["analytics", "Analytics"],
  ["branding", "Branding"],
  ["backup", "Backup"],
  ["data", "Data"],
  ["account", "Account"],
] as const;

const FRIENDLY: Record<string, string> = {
  size: "Enter a whole number from 128 to 4096.",
  "defaultStyle.size": "Enter a whole number from 128 to 4096.",
  "analytics.retentionDays": "Enter a whole number from 7 to 365.",
};

function validate(d: Settings): Record<string, string> {
  const errors: Record<string, string> = {};
  const r = settingsSchema.safeParse(d);
  if (!r.success) for (const i of r.error.issues) errors[i.path.join(".")] ??= FRIENDLY[i.path.join(".")] ?? i.message;
  if (!d.filenameTemplate.trim()) errors.filenameTemplate = "Enter a template, for example {name}.";
  if (!validZone(d.timezone)) errors.timezone = "Not a known time zone. Choose one from the list, for example Europe/Paris.";
  if (!d.brand.name.trim()) errors["brand.name"] = "Enter a brand name.";
  if (!d.brand.expiredTitle.trim()) errors["brand.expiredTitle"] = "Enter a title.";
  if (!d.brand.expiredMessage.trim()) errors["brand.expiredMessage"] = "Enter a message.";
  return errors;
}

export default function SettingsPage() {
  const online = useOnline();
  const { setTheme } = useTheme();
  const { save } = useSettings();
  // Edit only server-confirmed settings: seeding the form from local defaults could overwrite real ones on save.
  const load = useAsync(() => api.settings.get(), []);
  const [base, setBase] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  if (load.data && base === null) {
    setBase(load.data);
    setDraft(load.data);
  }

  const errors = useMemo(() => (draft ? validate(draft) : {}), [draft]);
  const errorCount = Object.keys(errors).length;
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(base);

  // Sections above the backup block change height once settings load, so re-apply the URL hash (e.g. /settings#backup).
  const ready = draft !== null;
  useEffect(() => {
    const id = location.hash.slice(1);
    if (ready && id) document.getElementById(id)?.scrollIntoView();
  }, [ready]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const update: SectionProps["update"] = (fn) => setDraft((d) => (d ? fn(d) : d));

  const onSave = async () => {
    if (!draft || errorCount) return;
    setSaving(true);
    try {
      const saved = await save(draft);
      setBase(saved);
      setDraft(saved);
      setTheme(saved.theme);
      toast.success("Settings saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Settings could not be saved");
    } finally {
      setSaving(false);
    }
  };

  const discard = () => {
    setDraft(base);
    if (base) setTheme(base.theme);
  };

  const props: SectionProps | null = draft ? { draft, update, errors } : null;

  return (
    <>
      <PageHeader title="Settings" description="Defaults for new codes, analytics, the public page, backups and your account." />
      <nav aria-label="Settings sections" className="-mx-4 mb-5 overflow-x-auto px-4 md:mx-0 md:px-0">
        <ul className="flex gap-2">
          {NAV.map(([id, label]) => (
            <li key={id}><a href={`#${id}`} className="tap inline-flex items-center rounded-full border px-3.5 text-sm font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">{label}</a></li>
          ))}
        </ul>
      </nav>

      <div className="mx-auto max-w-3xl space-y-5">
        {props ? (
          <>
            <DefaultsSection {...props} />
            <AnalyticsSection {...props} />
            <BrandingSection {...props} />
          </>
        ) : load.error ? (
          <div role="alert" className="space-y-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm">
            <p>{online ? `Settings could not be loaded: ${load.error.message}` : "You're offline. Settings can only be edited while connected."} They are not shown so that saving cannot overwrite your real settings with defaults.</p>
            <Button variant="outline" className="tap" onClick={() => void load.refresh()}><RefreshCw /> Try again</Button>
          </div>
        ) : (
          <div aria-busy="true" aria-label="Loading settings" className="space-y-5">
            {[0, 1, 2].map((i) => <div key={i} className="h-48 animate-pulse rounded-xl bg-muted" />)}
          </div>
        )}

        {props && (
          <div role="region" aria-label="Save settings" className="sticky bottom-[calc(3.5rem+env(safe-area-inset-bottom)+0.5rem)] z-20 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-background/95 p-3 shadow-lg backdrop-blur md:bottom-4">
            <p role="status" className="flex items-center gap-2 text-sm">
              {dirty ? <><span aria-hidden className="size-2 rounded-full bg-amber-500" /> {errorCount ? `Fix ${errorCount} problem${errorCount === 1 ? "" : "s"} to save` : "Unsaved changes"}</> : <span className="text-muted-foreground">All changes saved</span>}
              {!online && <span className="text-muted-foreground">· offline, saving is unavailable</span>}
            </p>
            <div className="flex gap-2">
              <Button variant="outline" className="tap" onClick={discard} disabled={!dirty || saving}><Undo2 /> Discard</Button>
              <Button className="tap" onClick={() => void onSave()} disabled={!dirty || saving || errorCount > 0 || !online}>
                {saving ? <Loader2 className="animate-spin" /> : <Save />} Save settings
              </Button>
            </div>
          </div>
        )}

        <BackupSection timezone={base?.timezone ?? "UTC"} />
        <DataSection />
        <AccountSection />
      </div>
    </>
  );
}
