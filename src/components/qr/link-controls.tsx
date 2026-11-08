"use client";
import { Dices } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, NativeSelect, TextField } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { localInputToUtc, utcToLocalInput } from "@/lib/client/time";
import { newSlug } from "@/lib/ids";
import { shortUrl, clientAppUrl } from "@/lib/qr/payload";
import type { QrView } from "@/lib/schema";

type Unit = "minutes" | "hours" | "days";
const UNIT_SECONDS: Record<Unit, number> = { minutes: 60, hours: 3600, days: 86400 };

export type LinkSettings = {
  slug: string;
  enabled: boolean;
  activateAt: string | null;
  expiry: "never" | "at" | "after";
  expiresAt: string | null;
  afterValue: number;
  afterUnit: Unit;
  scanLimit: number | null;
  /** string = set/change, null = remove, undefined = leave unchanged */
  password: string | null | undefined;
  hasPassword: boolean;
  afterMessage: string;
  afterRedirect: string;
  analytics: boolean;
};

export const defaultLinkSettings = (): LinkSettings => ({
  slug: newSlug(), enabled: true, activateAt: null, expiry: "never", expiresAt: null, afterValue: 7, afterUnit: "days",
  scanLimit: null, password: undefined, hasPassword: false, afterMessage: "", afterRedirect: "", analytics: true,
});

export function linkSettingsFromView(v: QrView): LinkSettings {
  const s = v.schedule;
  const rel = s.expireAfterSeconds;
  const unit: Unit = rel && rel % 86400 === 0 ? "days" : rel && rel % 3600 === 0 ? "hours" : "minutes";
  return {
    slug: v.slug ?? newSlug(), enabled: v.enabled, activateAt: s.activateAt,
    expiry: rel ? "after" : s.expiresAt ? "at" : "never", expiresAt: s.expiresAt,
    afterValue: rel ? rel / UNIT_SECONDS[unit] : 7, afterUnit: rel ? unit : "days",
    scanLimit: v.scanLimit, password: undefined, hasPassword: v.hasPassword,
    afterMessage: v.afterExpiry.message ?? "", afterRedirect: v.afterExpiry.redirectUrl ?? "", analytics: v.analytics,
  };
}

/** Writable record fields derived from the link settings. */
export function linkFields(l: LinkSettings, dynamic: boolean) {
  return {
    enabled: l.enabled,
    analytics: l.analytics,
    ...(dynamic
      ? {
          slug: l.slug,
          schedule: {
            activateAt: l.activateAt,
            expiresAt: l.expiry === "at" ? l.expiresAt : null,
            expireAfterSeconds: l.expiry === "after" ? Math.max(60, Math.round(l.afterValue * UNIT_SECONDS[l.afterUnit])) : null,
          },
          scanLimit: l.scanLimit,
          afterExpiry: { message: l.afterMessage.trim() || null, redirectUrl: l.afterRedirect.trim() || null },
        }
      : {}),
  };
}

export function LinkControls({ value, onChange, timezone, errors = {} }: { value: LinkSettings; onChange: (v: LinkSettings) => void; timezone: string; errors?: Record<string, string> }) {
  const set = (p: Partial<LinkSettings>) => onChange({ ...value, ...p });
  return (
    <div className="grid gap-4">
      <div className="grid gap-1.5">
        <TextField label="Short link" value={value.slug} onChange={(e) => set({ slug: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "") })} error={errors.slug} hint={<>Encoded in the QR: <span className="break-all font-mono">{shortUrl(clientAppUrl(), value.slug || "…")}</span>. The slug can&apos;t change what a printed code points to — edit the destination instead.</>} spellCheck={false} maxLength={64} autoComplete="off" />
        <div><Button type="button" variant="ghost" size="sm" onClick={() => set({ slug: newSlug() })}><Dices /> New random slug</Button></div>
      </div>

      <label className="flex items-center justify-between gap-3 text-sm">
        <span><span className="font-medium">Link active</span><span className="block text-xs text-muted-foreground">Pause to stop redirecting without deleting.</span></span>
        <Switch checked={value.enabled} onCheckedChange={(enabled) => set({ enabled })} aria-label="Link active" />
      </label>

      <TextField label={`Activate at (${timezone})`} type="datetime-local" value={utcToLocalInput(value.activateAt, timezone)} onChange={(e) => set({ activateAt: localInputToUtc(e.target.value, timezone) })} error={errors.activateAt} hint="Leave empty to start immediately." />

      <div className="grid gap-3">
        <Field label="Expiry">{(a) => <NativeSelect {...a} value={value.expiry} onChange={(e) => set({ expiry: e.target.value as LinkSettings["expiry"] })}><option value="never">Never expires</option><option value="at">At a date and time</option><option value="after">After a duration</option></NativeSelect>}</Field>
        {value.expiry === "at" && <TextField label={`Expires at (${timezone})`} type="datetime-local" value={utcToLocalInput(value.expiresAt, timezone)} onChange={(e) => set({ expiresAt: localInputToUtc(e.target.value, timezone) })} error={errors.expiresAt} />}
        {value.expiry === "after" && (
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <TextField label="Expires after" type="number" min={1} inputMode="numeric" value={String(value.afterValue)} onChange={(e) => set({ afterValue: Math.max(1, Number(e.target.value) || 1) })} hint={value.activateAt ? "Counted from the activation time." : "Counted from when the code is created."} />
            <Field label="Unit">{(a) => <NativeSelect {...a} value={value.afterUnit} onChange={(e) => set({ afterUnit: e.target.value as Unit })}><option value="minutes">minutes</option><option value="hours">hours</option><option value="days">days</option></NativeSelect>}</Field>
          </div>
        )}
      </div>

      <TextField label="Maximum scans" type="number" min={1} inputMode="numeric" placeholder="Unlimited" value={value.scanLimit ?? ""} onChange={(e) => set({ scanLimit: e.target.value ? Math.max(1, Math.round(Number(e.target.value))) : null })} error={errors.scanLimit} hint="Counts successful redirects only — wrong passwords, paused or expired visits never count." />

      <div className="grid gap-2">
        <Field label="Password" hint="Visitors must enter it before being redirected. Stored only as a salted scrypt hash.">
          {(a) => (
            <div className="flex gap-2">
              <input {...a} type="text" autoComplete="off" spellCheck={false} placeholder={value.hasPassword && value.password === undefined ? "•••••• (set — type to change)" : "No password"} value={typeof value.password === "string" ? value.password : ""} onChange={(e) => set({ password: e.target.value || undefined })} className="h-10 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm" minLength={4} maxLength={128} />
              {(value.hasPassword || typeof value.password === "string") && value.password !== null && (
                <Button type="button" variant="outline" onClick={() => set({ password: null })}>Remove</Button>
              )}
            </div>
          )}
        </Field>
        {value.password === null && <p className="text-xs text-amber-700 dark:text-amber-300">The password will be removed when you save.</p>}
        {errors.password && <p role="alert" className="text-xs text-destructive">{errors.password}</p>}
      </div>

      <div className="grid gap-3 rounded-xl border p-3">
        <p className="text-sm font-medium">After expiry</p>
        <TextField label="Custom message" value={value.afterMessage} maxLength={280} onChange={(e) => set({ afterMessage: e.target.value })} hint="Shown on the branded expired page. Plain text only." />
        <TextField label="Replacement destination (optional)" type="url" inputMode="url" value={value.afterRedirect} onChange={(e) => set({ afterRedirect: e.target.value })} error={errors.afterRedirect} hint="Visitors are sent here instead of seeing the expired page." />
      </div>

      <label className="flex items-center justify-between gap-3 text-sm">
        <span><span className="font-medium">Count scans (analytics)</span><span className="block text-xs text-muted-foreground">Aggregate counters only — no IP addresses or visitor IDs are stored.</span></span>
        <Switch checked={value.analytics} onCheckedChange={(analytics) => set({ analytics })} aria-label="Count scans" />
      </label>
    </div>
  );
}
