import {parseCsv} from "@/components/bulk/csv";
import {newId} from "./ids";
import {LIBRARY_FORMAT} from "./library-format";
import {defaultStyle} from "./schema";

export function libraryFromCsv(text: string) {
    const {rows} = parseCsv(text);
    const headers = rows.shift()?.map((h) => h.toLowerCase());
    if (!headers) throw new Error("CSV has no header row");
    const payloadColumn = headers.findIndex((h) => ["destination_or_payload", "url", "payload"].includes(h));
    if (payloadColumn < 0) throw new Error("CSV needs a url, payload or destination_or_payload column");
    const now = new Date().toISOString();
    return {
        format: LIBRARY_FORMAT, version: 1, exportedAt: now,
        codes: rows.map((row) => {
            const cell = (name: string) => row[headers.indexOf(name)] || "";
            const payload = row[payloadColumn] || "";
            if (payload.startsWith("(sensitive")) throw new Error("This CSV redacts sensitive codes. Use the JSON export to transfer Wi-Fi or contact cards.");
            return {
                v: 1, id: cell("id") || newId(), name: cell("name") || payload.slice(0, 120) || "Imported code",
                type: cell("type") || "url", mode: cell("mode") || "static", payload, fields: {},
                slug: cell("mode") === "dynamic" ? cell("slug") || null : null,
                tags: cell("tags").split("|").filter(Boolean), folder: null, style: defaultStyle(),
                enabled: false, status: cell("status") || "active", rev: 1,
                createdAt: cell("created") || now, updatedAt: cell("updated") || now,
            };
        }),
    };
}
