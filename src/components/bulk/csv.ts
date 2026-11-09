export type CsvTable = { rows: string[][]; lines: number[]; delimiter: string };

const DELIMS = [",", ";", "\t"] as const;

function detectDelimiter(text: string): string {
    const counts: Record<string, number> = {",": 0, ";": 0, "\t": 0};
    let inQ = false;
    for (const ch of text) {
        if (ch === '"') inQ = !inQ;
        else if (!inQ && (ch === "\n" || ch === "\r")) {
            if (Object.values(counts).some((n) => n > 0)) break;
        } else if (!inQ && ch in counts) counts[ch] = (counts[ch] ?? 0) + 1;
    }
    return DELIMS.reduce((best, d) => ((counts[d] ?? 0) > (counts[best] ?? 0) || (counts[d] === counts[best] && d === "\t") ? d : best), ",");
}

export function parseCsv(input: string, delimiter?: string): CsvTable {
    const text = input.replace(/^﻿/, "");
    const delim = delimiter ?? detectDelimiter(text);
    const rows: string[][] = [];
    const lines: number[] = [];
    let row: string[] = [];
    let field = "";
    let inQ = false;
    let record = 1;
    let touched = false;

    const endField = () => {
        row.push(field);
        field = "";
    };
    const endRecord = () => {
        endField();
        if (touched && row.some((c) => c.trim() !== "")) {
            rows.push(row.map((c) => c.trim()));
            lines.push(record);
        }
        row = [];
        touched = false;
        record++;
    };

    for (let i = 0; i < text.length; i++) {
        const ch = text[i]!;
        if (inQ) {
            if (ch === '"') {
                if (text[i + 1] === '"') {
                    field += '"';
                    i++;
                } else inQ = false;
            } else field += ch;
        } else if (ch === '"' && field === "") {
            inQ = true;
            touched = true;
        } else if (ch === delim) {
            touched = true;
            endField();
        } else if (ch === "\r" || ch === "\n") {
            if (ch === "\r" && text[i + 1] === "\n") i++;
            endRecord();
        } else {
            touched = true;
            field += ch;
        }
    }
    if (touched || field !== "" || row.length) endRecord();
    return {rows, lines, delimiter: delim};
}

export function parseLines(input: string): CsvTable {
    const rows: string[][] = [];
    const lines: number[] = [];
    input
        .replace(/^﻿/, "")
        .split(/\r\n|\r|\n/)
        .forEach((l, i) => {
            if (l.trim()) {
                rows.push([l.trim()]);
                lines.push(i + 1);
            }
        });
    return {rows, lines, delimiter: "\n"};
}

const URLISH = /^(https?:\/\/\S+|www\.\S+|[^\s/@:]+\.[a-z]{2,}([/:?#]\S*)?)$/i;
export const looksLikeUrl = (s: string) => URLISH.test(s.trim());

export const detectHeader = (first: string[] | undefined) => Boolean(first && first.length > 0 && !first.some(looksLikeUrl));
