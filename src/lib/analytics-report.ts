import { dayKey } from "./redis/keys";
import { daysBetween, listCodes, readStats, recentActivity, getSettings, toView } from "./redis/repo";

export type AnalyticsReport = {
  range: { from: string; to: string };
  enabled: boolean;
  retentionDays: number;
  totals: { scans: number; codes: number; active: number; expired: number; paused: number; scheduled: number; exhausted: number };
  daily: { day: string; scans: number }[];
  devices: Record<string, number>;
  countries: Record<string, number>;
  top: { id: string; name: string; scans: number; mode: string }[];
  recent: { at: string; id: string; name: string; device: string }[];
};

const iso = (d: string) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;

export async function buildReport(from: Date, to: Date, id?: string): Promise<AnalyticsReport> {
  const days = daysBetween(from, to);
  const [stats, settings, { records, scans }] = await Promise.all([readStats(days, id), getSettings(), listCodes()]);
  const views = records.map((r) => toView(r, scans.get(r.id) ?? 0));
  const names = new Map(records.map((r) => [r.id, r]));
  const devices: Record<string, number> = {};
  const countries: Record<string, number> = {};
  const perCode: Record<string, number> = {};
  let total = 0;
  for (const s of stats) {
    total += s.total;
    for (const [k, v] of Object.entries(s.devices)) devices[k] = (devices[k] ?? 0) + v;
    for (const [k, v] of Object.entries(s.countries)) countries[k] = (countries[k] ?? 0) + v;
    for (const [k, v] of Object.entries(s.codes)) perCode[k] = (perCode[k] ?? 0) + v;
  }
  const count = (k: string) => views.filter((v) => v.status === "active" && v.linkState === k).length;
  return {
    range: { from: iso(days[0] ?? dayKey(from)), to: iso(days[days.length - 1] ?? dayKey(to)) },
    enabled: settings.analytics.enabled,
    retentionDays: settings.analytics.retentionDays,
    totals: {
      scans: total,
      codes: views.filter((v) => v.status !== "trashed").length,
      active: views.filter((v) => v.status === "active" && v.linkState === "ok").length,
      expired: count("expired"),
      paused: views.filter((v) => v.status === "archived" || v.linkState === "paused").length,
      scheduled: count("not_yet"),
      exhausted: count("exhausted"),
    },
    daily: stats.map((s) => ({ day: iso(s.day), scans: s.total })),
    devices,
    countries,
    top: Object.entries(perCode)
      .filter(([cid]) => names.has(cid))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([cid, n]) => ({ id: cid, name: names.get(cid)!.name, scans: n, mode: names.get(cid)!.mode })),
    recent: id ? [] : (await recentActivity(30)).map((r) => ({ ...r, name: names.get(r.id)?.name ?? "(deleted)" })),
  };
}

const csvCell = (v: string | number) => {
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // neutralise spreadsheet formula injection
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const toCsv = (rows: (string | number)[][]) => rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";

export function reportCsv(r: AnalyticsReport): string {
  const rows: (string | number)[][] = [["section", "key", "value"]];
  r.daily.forEach((d) => rows.push(["daily", d.day, d.scans]));
  Object.entries(r.devices).forEach(([k, v]) => rows.push(["device", k, v]));
  Object.entries(r.countries).forEach(([k, v]) => rows.push(["country", k, v]));
  r.top.forEach((t) => rows.push(["top", t.name, t.scans]));
  return toCsv(rows);
}
