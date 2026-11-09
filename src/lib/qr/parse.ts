import type {ContentType} from "../schema";

export type Parsed = {
    type: ContentType;
    fields: Record<string, unknown>;
    label: string;
    summary: { label: string; value: string }[];
    sensitive: boolean;
};

const unesc = (v: string) => v.replace(/\\([\\;,:"])/g, "$1");
const textUnesc = (v: string) => v.replace(/\\(n|N)|\\([\\;,])/g, (_m, nl: string | undefined, c: string | undefined) => (nl ? "\n" : c!));
const splitUnescaped = (v: string): string[] => {
    const out: string[] = [];
    let cur = "";
    for (let i = 0; i < v.length; i++) {
        const c = v[i]!;
        if (c === "\\" && i + 1 < v.length) cur += c + v[++i];
        else if (c === ";") {
            out.push(cur);
            cur = "";
        } else cur += c;
    }
    out.push(cur);
    return out;
};

export function parseScanned(raw: string): Parsed {
    const t = raw.trim();
    const text = (): Parsed => ({
        type: "text",
        fields: {text: raw},
        label: "Text",
        summary: [{label: "Text", value: raw}],
        sensitive: false
    });

    if (/^WIFI:/i.test(t)) {
        const get = (k: string) => {
            const m = new RegExp(`(?:^|;)${k}:((?:\\\\.|[^;])*)`, "i").exec(t.slice(5));
            return m ? unesc(m[1]!) : "";
        };
        const security = (get("T") || "nopass").toUpperCase();
        const sec = security === "WEP" ? "WEP" : security === "NOPASS" || !get("P") ? "nopass" : "WPA";
        return {
            type: "wifi",
            fields: {ssid: get("S"), password: get("P"), security: sec, hidden: /^true$/i.test(get("H"))},
            label: "Wi-Fi network",
            summary: [{label: "Network", value: get("S")}, {
                label: "Security",
                value: sec === "nopass" ? "None" : sec
            }, ...(get("P") ? [{label: "Password", value: "••••••••"}] : [])],
            sensitive: true,
        };
    }
    if (/^BEGIN:VCARD/i.test(t)) {
        const rawLine = (k: string) => new RegExp(`^${k}(?:;[^:]*)?:(.*)$`, "im").exec(t)?.[1]?.trim() ?? "";
        const line = (k: string) => textUnesc(rawLine(k));
        const [last = "", first = ""] = splitUnescaped(rawLine("N")).map(textUnesc);
        const fields = {
            firstName: first,
            lastName: last,
            org: line("ORG"),
            title: line("TITLE"),
            mobile: line("TEL"),
            email: line("EMAIL"),
            url: line("URL"),
            note: line("NOTE")
        };
        return {
            type: "vcard",
            fields,
            label: "Contact card",
            summary: [{
                label: "Name",
                value: line("FN") || `${first} ${last}`.trim()
            }, ...(fields.org ? [{
                label: "Organisation",
                value: fields.org
            }] : []), ...(fields.mobile ? [{
                label: "Phone",
                value: fields.mobile
            }] : []), ...(fields.email ? [{label: "Email", value: fields.email}] : [])],
            sensitive: true
        };
    }
    if (/^BEGIN:VCALENDAR/i.test(t)) {
        const rawLine = (k: string) => new RegExp(`^${k}(?:;[^:]*)?:(.*)$`, "im").exec(t)?.[1]?.trim() ?? "";
        const line = (k: string) => textUnesc(rawLine(k));
        const d = (v: string) => (v.length >= 8 ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}${v.length >= 13 ? `T${v.slice(9, 11)}:${v.slice(11, 13)}` : ""}` : "");
        const allDay = !rawLine("DTSTART").includes("T");
        const lastDay = (v: string) => {
            const x = d(v);
            if (!x) return "";
            const prev = new Date(Date.UTC(+x.slice(0, 4), +x.slice(5, 7) - 1, +x.slice(8, 10) - 1)).toISOString().slice(0, 10);
            return prev < d(rawLine("DTSTART")) ? d(rawLine("DTSTART")) : prev;
        };
        return {
            type: "event",
            fields: {
                title: line("SUMMARY"),
                start: d(rawLine("DTSTART")),
                end: allDay ? lastDay(rawLine("DTEND")) : d(rawLine("DTEND")),
                allDay,
                timezone: "UTC",
                location: line("LOCATION"),
                description: line("DESCRIPTION")
            },
            label: "Calendar event",
            summary: [{label: "Title", value: line("SUMMARY")}, {label: "Starts", value: d(rawLine("DTSTART"))}],
            sensitive: false
        };
    }
    const mail = /^mailto:([^?]+)(?:\?(.*))?$/i.exec(t);
    if (mail) {
        const q = new URLSearchParams(mail[2] ?? "");
        return {
            type: "email",
            fields: {to: decodeURIComponent(mail[1]!), subject: q.get("subject") ?? "", body: q.get("body") ?? ""},
            label: "Email",
            summary: [{label: "To", value: decodeURIComponent(mail[1]!)}, ...(q.get("subject") ? [{
                label: "Subject",
                value: q.get("subject")!
            }] : [])],
            sensitive: false
        };
    }
    const tel = /^tel:(.+)$/i.exec(t);
    if (tel) return {
        type: "phone",
        fields: {number: tel[1]},
        label: "Phone number",
        summary: [{label: "Number", value: tel[1]!}],
        sensitive: false
    };
    const sms = /^sms(?:to)?:([^?:]+)(?:[?:&](?:body=)?(.*))?$/i.exec(t);
    if (sms) return {
        type: "sms",
        fields: {number: sms[1], message: sms[2] ? decodeURIComponent(sms[2]) : ""},
        label: "SMS",
        summary: [{label: "To", value: sms[1]!}, ...(sms[2] ? [{
            label: "Message",
            value: decodeURIComponent(sms[2])
        }] : [])],
        sensitive: false
    };
    const geo = /^geo:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/i.exec(t);
    if (geo) return {
        type: "geo",
        fields: {lat: Number(geo[1]), lng: Number(geo[2]), label: ""},
        label: "Location",
        summary: [{label: "Coordinates", value: `${geo[1]}, ${geo[2]}`}],
        sensitive: false
    };
    if (/^https?:\/\//i.test(t) && !/\s/.test(t)) {
        try {
            const u = new URL(t);
            if (u.hostname === "wa.me") return {
                type: "whatsapp",
                fields: {phone: `+${u.pathname.slice(1)}`, message: u.searchParams.get("text") ?? ""},
                label: "WhatsApp chat",
                summary: [{label: "Number", value: `+${u.pathname.slice(1)}`}],
                sensitive: false
            };
            if (u.hostname === "doi.org" || u.hostname === "dx.doi.org") return {
                type: "doi",
                fields: {doi: decodeURIComponent(u.pathname.slice(1))},
                label: "Publication (DOI)",
                summary: [{label: "DOI", value: decodeURIComponent(u.pathname.slice(1))}],
                sensitive: false
            };
            return {
                type: "url",
                fields: {url: t},
                label: "Website",
                summary: [{label: "Host", value: u.hostname}, {label: "URL", value: t}],
                sensitive: false
            };
        } catch {
        }
    }
    return text();
}
