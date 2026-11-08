import { styleSchema, type QrStyle, type Template } from "@/lib/schema";

export const TEMPLATE_FILE_FORMAT = "qr-studio-templates";
export const LOGO_NOTE = "Logos are stored in the QR Studio database and referenced by id. A template that uses a logo only shows it when imported into the same database.";
export const SAMPLE_DATA = "https://example.com/qr-studio";
const MAX_TEMPLATES = 200;

export type TemplateEntry = { name: string; style: QrStyle };

export function buildExport(templates: Template[]): string {
  return JSON.stringify(
    { format: TEMPLATE_FILE_FORMAT, version: 1, note: LOGO_NOTE, exportedAt: new Date().toISOString(), templates: templates.map((t) => ({ name: t.name, style: t.style })) },
    null,
    2,
  );
}

export type ParsedTemplates = { valid: TemplateEntry[]; invalid: { label: string; error: string }[]; withLogo: number };

/** Parse and validate a templates file. Throws with a user-readable message when the file as a whole is unusable. */
export function parseTemplateFile(text: string): ParsedTemplates {
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^﻿/, ""));
  } catch {
    throw new Error("That file is not valid JSON.");
  }
  if (typeof raw !== "object" || raw === null || (raw as { format?: unknown }).format !== TEMPLATE_FILE_FORMAT) throw new Error(`This is not a QR Studio templates file (expected format “${TEMPLATE_FILE_FORMAT}”).`);
  const file = raw as { version?: unknown; templates?: unknown };
  if (file.version !== 1) throw new Error(`Unsupported templates file version: ${String(file.version)}.`);
  if (!Array.isArray(file.templates)) throw new Error("The file has no “templates” list.");
  if (file.templates.length > MAX_TEMPLATES) throw new Error(`The file has ${file.templates.length} templates; the limit is ${MAX_TEMPLATES}.`);

  const out: ParsedTemplates = { valid: [], invalid: [], withLogo: 0 };
  file.templates.forEach((entry: unknown, i: number) => {
    const e = typeof entry === "object" && entry !== null ? (entry as { name?: unknown; style?: unknown }) : {};
    const name = typeof e.name === "string" ? e.name.trim() : "";
    const label = name || `Template #${i + 1}`;
    if (!name) return void out.invalid.push({ label, error: "Missing name" });
    if (name.length > 60) return void out.invalid.push({ label: name.slice(0, 40) + "…", error: "Name is longer than 60 characters" });
    const style = styleSchema.safeParse(e.style);
    if (!style.success) {
      const issue = style.error.issues[0];
      return void out.invalid.push({ label, error: issue ? `${issue.path.join(".") || "style"}: ${issue.message}` : "Invalid style" });
    }
    if (style.data.logo.assetId) out.withLogo++;
    out.valid.push({ name, style: style.data });
  });
  return out;
}

/** Same look? Ignores the preset label and nothing else. */
export const sameStyle = (a: QrStyle, b: QrStyle) => JSON.stringify({ ...a, preset: null }) === JSON.stringify({ ...b, preset: null });
