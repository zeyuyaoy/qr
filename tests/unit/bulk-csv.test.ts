import { describe, expect, it } from "vitest";
import { detectHeader, parseCsv, parseLines } from "@/components/bulk/csv";
import { buildRows, guessMapping, NO_MAPPING, uniqueNames } from "@/components/bulk/rows";

describe("bulk CSV", () => {
  const csv = '﻿Name,URL,Tags\r\n"Acme, Inc",https://acme.com/a?x=1,"a|b"\r\n\r\n"Say ""hi""",example.org,\r\n"multi\nline",https://acme.com/a?x=1,c;d';

  it("parses quotes, commas in quotes, CRLF, BOM and multi-line fields", () => {
    const t = parseCsv(csv);
    expect(t.rows[0]).toEqual(["Name", "URL", "Tags"]);
    expect(t.rows[1]).toEqual(["Acme, Inc", "https://acme.com/a?x=1", "a|b"]);
    expect(t.rows[2]).toEqual(['Say "hi"', "example.org", ""]);
    expect(t.rows[3]?.[0]).toBe("multi\nline");
    expect(t.lines).toEqual([1, 2, 4, 5]);
  });

  it("detects delimiters and headers", () => {
    expect(parseCsv("a\tb\n1\t2").delimiter).toBe("\t");
    expect(parseCsv("a;b\n1;2").delimiter).toBe(";");
    expect(detectHeader(["Name", "URL"])).toBe(true);
    expect(detectHeader(["Menu", "example.com/menu"])).toBe(false);
  });

  it("maps columns from the header and validates every row", () => {
    const t = parseCsv(csv);
    const mapping = guessMapping(t, true);
    expect(mapping).toEqual({ url: 1, name: 0, tags: 2, slug: -1, folder: -1 });
    const { rows } = buildRows(t, { mode: "dynamic", header: true, mapping, folders: [] });
    expect(rows.map((r) => r.error)).toEqual([null, null, null]);
    expect(rows[0]?.tags).toEqual(["a", "b"]);
    expect(rows[1]?.payload).toBe("https://example.org");
    expect(rows[2]?.duplicateOf).toBe(2);
  });

  it("excludes invalid rows with the exact error", () => {
    const { rows } = buildRows(parseLines("https://ok.com\nnot a url\n\nhttp://localhost/x"), { mode: "static", header: false, mapping: NO_MAPPING, folders: null });
    expect(rows).toHaveLength(3);
    expect(rows[0]?.error).toBeNull();
    expect(rows[1]?.error).toBe("URL contains spaces or control characters");
    expect(rows[2]?.error).toMatch(/public domain/);
  });

  it("keeps generated file names unique", () => {
    const m = uniqueNames([{ key: "a", name: "x.png" }, { key: "b", name: "X.png" }]);
    expect(m.get("b")).toBe("X-2.png");
  });
});
