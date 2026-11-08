"use client";
import { FileUp } from "lucide-react";
import { useId, useRef } from "react";
import { toast } from "sonner";
import { errMsg, readTextFile, TAP } from "@/components/library/common";
import { Button } from "@/components/ui/button";
import { Field, NativeSelect } from "@/components/ui/field";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { CsvTable } from "./csv";
import { MAX_ROWS, type Mapping } from "./rows";

export type Source = "urls" | "csv";
const DELIM_NAME: Record<string, string> = { ",": "comma-separated", ";": "semicolon-separated", "\t": "tab-separated" };

export function BulkInput({ source, onSource, text, onText, header, onHeader, table }: { source: Source; onSource: (s: Source) => void; text: string; onText: (t: string) => void; header: boolean; onHeader: (v: boolean) => void; table: CsvTable }) {
  const fileId = useId();
  const textId = useId();
  const file = useRef<HTMLInputElement>(null);

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      const content = await readTextFile(f, 5 * 1024 * 1024);
      onText(content.replace(/^﻿/, ""));
      if (/\.(csv|tsv)$/i.test(f.name) || f.type === "text/csv") onSource("csv");
      toast.success(`Loaded ${f.name}`);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      if (file.current) file.current.value = "";
    }
  };

  return (
    <div className="grid gap-3">
      <Tabs value={source} onValueChange={(v) => onSource(v as Source)}>
        <TabsList aria-label="Input format" className="h-auto group-data-horizontal/tabs:h-auto">
          <TabsTrigger value="urls" className="min-h-10 px-3 md:min-h-7">URLs, one per line</TabsTrigger>
          <TabsTrigger value="csv" className="min-h-10 px-3 md:min-h-7">CSV / spreadsheet</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="grid gap-1.5">
        <label htmlFor={textId} className="text-sm font-medium">{source === "urls" ? "Paste URLs" : "Paste CSV or spreadsheet cells"}</label>
        <Textarea
          id={textId}
          value={text}
          onChange={(e) => onText(e.target.value)}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          rows={6}
          placeholder={source === "urls" ? "https://example.com/menu\nhttps://example.com/about\nexample.org/contact" : "name,url,tags\nMenu,https://example.com/menu,food|print\nAbout,https://example.com/about,"}
          className="max-h-80 min-h-40 overflow-y-auto font-mono text-sm"
        />
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <input ref={file} id={fileId} type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" className="sr-only" onChange={(e) => void onFile(e.target.files?.[0])} />
        <Button variant="outline" className={TAP} onClick={() => file.current?.click()}>
          <FileUp /> Upload a file
        </Button>
        {source === "csv" ? (
          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm md:min-h-8">
            <input type="checkbox" className="size-5 accent-primary md:size-4" checked={header} onChange={(e) => onHeader(e.target.checked)} />
            First row has column names
          </label>
        ) : null}
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {table.rows.length ? (
            <>
              {table.rows.length.toLocaleString()} {table.rows.length === 1 ? "row" : "rows"} read
              {source === "csv" ? <> ({DELIM_NAME[table.delimiter] ?? "comma-separated"})</> : null}. Up to {MAX_ROWS} are used.
            </>
          ) : (
            "Nothing to read yet."
          )}
        </p>
      </div>
    </div>
  );
}

const FIELDS: { id: keyof Mapping; label: string; required?: boolean }[] = [
  { id: "url", label: "URL", required: true },
  { id: "name", label: "Name" },
  { id: "tags", label: "Tags (separated by | or ;)" },
  { id: "slug", label: "Slug (dynamic only)" },
  { id: "folder", label: "Folder name" },
];

/** Column-mapping step for CSV input. URL is required; everything else is optional. */
export function BulkMapping({ table, header, mapping, onMapping, mode }: { table: CsvTable; header: boolean; mapping: Mapping; onMapping: (m: Mapping) => void; mode: "static" | "dynamic" }) {
  const cols = Math.max(0, ...table.rows.slice(0, 100).map((r) => r.length));
  const head = header ? (table.rows[0] ?? []) : [];
  const sample = table.rows[header ? 1 : 0] ?? [];
  const label = (i: number) => {
    const name = head[i]?.trim() || `Column ${i + 1}`;
    const ex = (sample[i] ?? "").trim();
    return ex ? `${name} (e.g. ${ex.length > 28 ? `${ex.slice(0, 28)}…` : ex})` : name;
  };
  if (!cols) return <p className="text-sm text-muted-foreground">Add some data above, then choose which column is which.</p>;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {FIELDS.map((f) => (
        <Field key={f.id} label={f.label} hint={f.id === "slug" && mode === "static" ? "Ignored in static mode." : f.required ? "Required." : undefined}>
          {(a) => (
            <NativeSelect {...a} value={String(mapping[f.id])} onChange={(e) => onMapping({ ...mapping, [f.id]: Number(e.target.value) })}>
              {f.required ? null : <option value="-1">Not in my data</option>}
              {Array.from({ length: cols }, (_, i) => <option key={i} value={i}>{label(i)}</option>)}
            </NativeSelect>
          )}
        </Field>
      ))}
    </div>
  );
}
