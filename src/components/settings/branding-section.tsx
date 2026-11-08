"use client";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ColorField, Field, Section } from "./field";
import type { SectionProps } from "./types";

/** Black or white, whichever reads better on `hex`. */
const onColor = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.6 ? "#111111" : "#ffffff";
};

export function BrandingSection({ draft, update, errors }: SectionProps) {
  const b = draft.brand;
  const set = (patch: Partial<typeof b>) => update((d) => ({ ...d, brand: { ...d.brand, ...patch } }));
  const accent = /^#[0-9a-fA-F]{6}$/.test(b.accent) ? b.accent : "#4f46e5";
  return (
    <Section id="branding" title="Public page branding" description="What people see when they scan a code that has expired, been paused or reached its scan limit.">
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <Field label="Brand name" error={errors["brand.name"]}>
            {(a) => <Input {...a} className="h-11" value={b.name} maxLength={60} onChange={(e) => set({ name: e.target.value })} />}
          </Field>
          <Field label="Accent colour" hint="Used for the button and highlights on the public page." error={errors["brand.accent"]}>
            {(a) => <ColorField value={b.accent} onChange={(accent) => set({ accent })} {...a} />}
          </Field>
          <Field label="Expired page title" error={errors["brand.expiredTitle"]}>
            {(a) => <Input {...a} className="h-11" value={b.expiredTitle} maxLength={80} onChange={(e) => set({ expiredTitle: e.target.value })} />}
          </Field>
          <Field label="Expired page message" hint={`${b.expiredMessage.length}/280. A code can override this with its own message.`} error={errors["brand.expiredMessage"]}>
            {(a) => <Textarea {...a} rows={3} value={b.expiredMessage} maxLength={280} onChange={(e) => set({ expiredMessage: e.target.value })} />}
          </Field>
          <Field label="Footer text" hint="Optional, shown at the bottom of the page." error={errors["brand.footer"]}>
            {(a) => <Input {...a} className="h-11" value={b.footer} maxLength={120} onChange={(e) => set({ footer: e.target.value })} />}
          </Field>
        </div>

        <div>
          <p className="mb-2 text-sm font-medium">Live preview</p>
          <div className="rounded-xl border bg-white p-6 text-center text-neutral-900 shadow-sm" role="img" aria-label={`Preview of the expired page: ${b.expiredTitle}. ${b.expiredMessage}`}>
            <div aria-hidden>
              <div className="mx-auto mb-4 grid size-12 place-items-center rounded-full text-xl font-bold" style={{ background: accent, color: onColor(accent) }}>{(b.name.trim()[0] ?? "Q").toUpperCase()}</div>
              <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">{b.name || "Your brand"}</p>
              <h3 className="mt-3 text-lg font-semibold">{b.expiredTitle || "This link has expired"}</h3>
              <p className="mx-auto mt-2 max-w-xs text-sm text-neutral-600">{b.expiredMessage}</p>
              <span className="mt-5 inline-block rounded-lg px-4 py-2 text-sm font-medium" style={{ background: accent, color: onColor(accent) }}>Back to {b.name || "home"}</span>
              {b.footer ? <p className="mt-6 text-xs text-neutral-500">{b.footer}</p> : null}
            </div>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Always shown on a light background. Save first, then <Link href="/expired" target="_blank" rel="noopener" className="inline-flex items-center gap-1 underline">view the real page <ExternalLink className="size-3" /></Link>.</p>
        </div>
      </div>
    </Section>
  );
}
