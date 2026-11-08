"use client";
import { Field, NumberInput, Section, SwitchRow } from "./field";
import type { SectionProps } from "./types";

export function AnalyticsSection({ draft, update, errors }: SectionProps) {
  const a = draft.analytics;
  const set = (patch: Partial<typeof a>) => update((d) => ({ ...d, analytics: { ...d.analytics, ...patch } }));
  return (
    <Section id="analytics" title="Analytics" description="Only dynamic codes can be counted, because they pass through this app. Static codes are read directly by the phone.">
      <div className="divide-y">
        <SwitchRow label="Record scans" hint="Turn off to stop recording new scans. Existing figures are kept until retention removes them." checked={a.enabled} onChange={(enabled) => set({ enabled })} />
        <SwitchRow label="Device categories" hint="Mobile, desktop or tablet, derived from the browser. The raw browser string is not stored." checked={a.devices} onChange={(devices) => set({ devices })} disabled={!a.enabled} />
        <SwitchRow label="Country" hint="Only works when the hosting platform supplies a trusted country header (on Vercel). On other hosts no country is recorded even when this is on." checked={a.geo} onChange={(geo) => set({ geo })} disabled={!a.enabled} />
      </div>
      <Field label="Retention (days)" hint="Between 7 and 365. Daily counters older than this are deleted automatically. Nothing else is removed: your codes and their lifetime scan totals stay." error={errors["analytics.retentionDays"]}>
        {(p) => <NumberInput value={a.retentionDays} min={7} max={365} onChange={(retentionDays) => set({ retentionDays })} {...p} />}
      </Field>
    </Section>
  );
}
