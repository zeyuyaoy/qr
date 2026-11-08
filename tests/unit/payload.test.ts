import { describe, expect, it } from "vitest";
import { CONTENT_TYPES } from "@/lib/schema";
import {
  BYTE_CAPACITY,
  CONTENT_TYPE_OPTIONS,
  TYPES,
  byteLength,
  encodePayload,
  isDynamicCapable,
  payloadFits,
  qrData,
  shortUrl,
  zonedToUtc,
} from "@/lib/qr/payload";
import { withScheme } from "@/lib/url-safety";

const enc = (type: Parameters<typeof encodePayload>[0], fields: Record<string, unknown>) => {
  const r = encodePayload(type, fields);
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r.errors)}`);
  return r.payload;
};
const err = (type: Parameters<typeof encodePayload>[0], fields: Record<string, unknown>) => {
  const r = encodePayload(type, fields);
  if (r.ok) throw new Error(`expected failure, got ${r.payload}`);
  return r.errors;
};

describe("every content type", () => {
  it("has a definition whose example encodes", () => {
    expect(Object.keys(TYPES).sort()).toEqual([...CONTENT_TYPES].sort());
    for (const t of CONTENT_TYPES) {
      const r = encodePayload(t, TYPES[t].example);
      expect(r.ok, `${t} example`).toBe(true);
    }
  });
  it("exposes options and dynamic capability consistently", () => {
    expect(CONTENT_TYPE_OPTIONS.map((o) => o.id)).toEqual([...CONTENT_TYPES]);
    for (const o of CONTENT_TYPE_OPTIONS) expect(isDynamicCapable(o.id)).toBe(o.dynamic);
    expect(CONTENT_TYPE_OPTIONS.filter((o) => o.dynamic).map((o) => o.id).sort()).toEqual(["doi", "social", "url", "whatsapp"].sort());
  });
});

describe("url", () => {
  it("adds https:// to bare hosts and keeps query/fragment bytes", () => {
    expect(enc("url", { url: "example.com/menu?table=4#top" })).toBe("https://example.com/menu?table=4#top");
    expect(enc("url", { url: "  https://Example.com/A%20b?x=1&y=%7E  " })).toBe("https://Example.com/A%20b?x=1&y=%7E");
  });
  it("rejects unsafe and empty input with readable messages", () => {
    expect(err("url", { url: "" }).url).toBe("Enter a URL");
    expect(err("url", { url: "javascript:alert(1)" }).url).toBe("Only http and https destinations are allowed");
    expect(err("url", { url: "http://10.0.0.1/admin" }).url).toBe("Private IP addresses are not allowed");
    expect(err("url", { url: "http://localhost:3000" }).url).toBe("Host must be a public domain name");
  });
});

describe("text", () => {
  it("is verbatim and bounded", () => {
    expect(enc("text", { text: "  keep\nspaces  " })).toBe("  keep\nspaces  ");
    expect(err("text", { text: "" }).text).toBe("Enter some text");
    expect(err("text", { text: "x".repeat(2001) }).text).toBeTruthy();
  });
});

describe("email", () => {
  it("builds mailto: with RFC 6068 percent-encoding", () => {
    expect(enc("email", { to: "a@b.com" })).toBe("mailto:a@b.com");
    expect(enc("email", { to: "a@b.com", subject: "Hello & welcome (1)!" })).toBe("mailto:a@b.com?subject=Hello%20%26%20welcome%20%281%29%21");
    expect(enc("email", { to: "a@b.com", subject: "Hi", body: "Line1\nLine 2 + more" })).toBe("mailto:a@b.com?subject=Hi&body=Line1%0ALine%202%20%2B%20more");
    expect(enc("email", { to: "a@b.com", body: "é/ü?" })).toBe("mailto:a@b.com?body=%C3%A9%2F%C3%BC%3F");
  });
  it("validates the address", () => {
    expect(err("email", { to: "nope" }).to).toBe("Enter a valid email address");
  });
});

describe("tel: and sms:", () => {
  it("normalises phone numbers", () => {
    expect(enc("phone", { number: "+1 (415) 555-0132" })).toBe("tel:+14155550132");
    expect(enc("phone", { number: "020 7946 0958" })).toBe("tel:02079460958");
    expect(err("phone", { number: "call me" }).number).toBe("Use digits, spaces and an optional leading +");
  });
  it("encodes sms: per RFC 5724 with ?body=", () => {
    expect(enc("sms", { number: "+1 415 555 0132" })).toBe("sms:+14155550132");
    expect(enc("sms", { number: "+14155550132", message: "Hi there, 100% & more" })).toBe("sms:+14155550132?body=Hi%20there%2C%20100%25%20%26%20more");
  });
});

describe("wifi", () => {
  it("follows WIFI:T:..;S:..;P:..;; exactly", () => {
    expect(enc("wifi", { ssid: "Home", password: "secret123", security: "WPA" })).toBe("WIFI:T:WPA;S:Home;P:secret123;;");
    expect(enc("wifi", { ssid: "Home", password: "secret123", security: "WPA", hidden: true })).toBe("WIFI:T:WPA;S:Home;P:secret123;H:true;;");
    expect(enc("wifi", { ssid: "Cafe", security: "nopass" })).toBe("WIFI:T:nopass;S:Cafe;;");
    expect(enc("wifi", { ssid: "Old", password: "abc", security: "WEP" })).toBe("WIFI:T:WEP;S:Old;P:abc;;");
  });
  it("defaults to WPA", () => {
    expect(enc("wifi", { ssid: "Home", password: "secret123" })).toBe("WIFI:T:WPA;S:Home;P:secret123;;");
  });
  it("escapes backslash ; , : and quote in ssid and password", () => {
    expect(enc("wifi", { ssid: String.raw`a\b;c,d:e"f`, password: String.raw`p\;,:"word`, security: "WPA" })).toBe(
      String.raw`WIFI:T:WPA;S:a\\b\;c\,d\:e\"f;P:p\\\;\,\:\"word;;`,
    );
  });
  it("does not leak the password for open networks", () => {
    expect(enc("wifi", { ssid: "Open", password: "ignored-ignored", security: "nopass" })).not.toContain("ignored");
  });
  it("validates", () => {
    expect(err("wifi", { ssid: "", password: "secret123" }).ssid).toBe("Network name is required");
    expect(err("wifi", { ssid: "x", password: "short", security: "WPA" }).password).toBe("WPA passwords are 8–63 characters");
    expect(err("wifi", { ssid: "x", password: "", security: "WPA" }).password).toMatch(/Enter the password/);
    expect(err("wifi", { ssid: "x".repeat(33), password: "secret123" }).ssid).toBeTruthy();
  });
});

describe("vCard 3.0", () => {
  it("uses CRLF, required properties and field order", () => {
    const v = enc("vcard", { firstName: "Ada", lastName: "Lovelace", org: "Analytical Engines", title: "Countess", mobile: "+44 20 7946 0958", phone: "+44 1", email: "ada@example.com", url: "example.com", street: "1 Main St", city: "London", region: "LDN", postal: "N1", country: "UK", note: "hi" });
    expect(v.split("\r\n")).toEqual([
      "BEGIN:VCARD",
      "VERSION:3.0",
      "N:Lovelace;Ada;;;",
      "FN:Ada Lovelace",
      "ORG:Analytical Engines",
      "TITLE:Countess",
      "TEL;TYPE=WORK,VOICE:+44 1",
      "TEL;TYPE=CELL,VOICE:+44 20 7946 0958",
      "EMAIL;TYPE=INTERNET:ada@example.com",
      "URL:https://example.com",
      "ADR;TYPE=WORK:;;1 Main St;London;LDN;N1;UK",
      "NOTE:hi",
      "END:VCARD",
    ]);
    expect(v.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
  });
  it("escapes backslash, comma, semicolon and newlines", () => {
    const v = enc("vcard", { firstName: "A;B", lastName: "C,D", org: "back\\slash", note: "l1\nl2\r\nl3" });
    expect(v).toContain(String.raw`N:C\,D;A\;B;;;`);
    expect(v).toContain(String.raw`ORG:back\\slash`);
    expect(v).toContain(String.raw`NOTE:l1\nl2\nl3`);
    expect(v.split("\r\n")).toHaveLength(7); // a raw newline would add lines
  });
  it("accepts an organisation alone and needs some name", () => {
    expect(enc("vcard", { org: "ACME" }).split("\r\n")).toContain("FN:ACME");
    expect(err("vcard", {}).firstName).toBe("Enter a name or organisation");
  });
});

describe("zonedToUtc", () => {
  it("handles US daylight saving transitions", () => {
    expect(zonedToUtc("2027-03-13T18:00", "America/New_York").toISOString()).toBe("2027-03-13T23:00:00.000Z"); // EST
    expect(zonedToUtc("2027-03-14T18:00", "America/New_York").toISOString()).toBe("2027-03-14T22:00:00.000Z"); // EDT
    expect(zonedToUtc("2027-11-06T12:00", "America/New_York").toISOString()).toBe("2027-11-06T16:00:00.000Z"); // EDT
    expect(zonedToUtc("2027-11-07T12:00", "America/New_York").toISOString()).toBe("2027-11-07T17:00:00.000Z"); // EST
  });
  it("handles European transitions, half-hour zones and UTC", () => {
    expect(zonedToUtc("2027-03-27T12:00", "Europe/London").toISOString()).toBe("2027-03-27T12:00:00.000Z");
    expect(zonedToUtc("2027-03-28T12:00", "Europe/London").toISOString()).toBe("2027-03-28T11:00:00.000Z");
    expect(zonedToUtc("2027-01-01T00:00", "Asia/Kolkata").toISOString()).toBe("2026-12-31T18:30:00.000Z");
    expect(zonedToUtc("2027-06-01 09:30", "UTC").toISOString()).toBe("2027-06-01T09:30:00.000Z");
    expect(zonedToUtc("2027-01-01T08:00", "Pacific/Auckland").toISOString()).toBe("2026-12-31T19:00:00.000Z");
  });
  it("rejects malformed input", () => {
    expect(() => zonedToUtc("tomorrow", "UTC")).toThrow("Invalid date/time");
  });
});

describe("iCalendar events", () => {
  const lines = (f: Record<string, unknown>) => enc("event", f).split("\r\n");
  it("converts to UTC across the DST boundary", () => {
    const before = lines({ title: "T", start: "2027-03-13T18:00", end: "2027-03-13T19:30", timezone: "America/New_York" });
    const after = lines({ title: "T", start: "2027-03-14T18:00", end: "2027-03-14T19:30", timezone: "America/New_York" });
    expect(before).toContain("DTSTART:20270313T230000Z");
    expect(before).toContain("DTEND:20270314T003000Z");
    expect(after).toContain("DTSTART:20270314T220000Z");
    expect(after).toContain("DTEND:20270314T233000Z");
  });
  it("has the iCalendar skeleton and a stable UID", () => {
    const a = lines({ title: "Launch", start: "2027-03-14T18:00", end: "2027-03-14T21:00" });
    expect(a[0]).toBe("BEGIN:VCALENDAR");
    expect(a.slice(1, 4)).toEqual(["VERSION:2.0", "PRODID:-//QR Studio//EN", "BEGIN:VEVENT"]);
    expect(a[4]).toMatch(/^UID:[0-9a-f]{16}@qr-studio$/);
    expect(a[5]).toBe("DTSTAMP:20270314T180000Z");
    expect(a.slice(-2)).toEqual(["END:VEVENT", "END:VCALENDAR"]);
    expect(lines({ title: "Launch", start: "2027-03-14T18:00" })[4]).toBe(a[4]);
    expect(lines({ title: "Other", start: "2027-03-14T18:00" })[4]).not.toBe(a[4]);
  });
  it("defaults to a one hour duration", () => {
    expect(lines({ title: "T", start: "2027-03-14T18:00" })).toContain("DTEND:20270314T190000Z");
  });
  it("encodes all-day events with an exclusive DTEND", () => {
    const one = lines({ title: "Holiday", start: "2027-03-14", allDay: true });
    expect(one).toContain("DTSTART;VALUE=DATE:20270314");
    expect(one).toContain("DTEND;VALUE=DATE:20270315");
    expect(one).toContain("DTSTAMP:20270314T000000Z");
    expect(lines({ title: "Trip", start: "2027-03-14", end: "2027-03-16", allDay: true })).toContain("DTEND;VALUE=DATE:20270317");
    expect(lines({ title: "NYE", start: "2027-12-31", allDay: true })).toContain("DTEND;VALUE=DATE:20280101");
    expect(lines({ title: "Leap", start: "2028-02-28", end: "2028-02-29", allDay: true })).toContain("DTEND;VALUE=DATE:20280301");
  });
  it("escapes text values", () => {
    const l = lines({ title: "A, B; C\nD\\E", start: "2027-03-14T18:00", location: "Room 1, Floor 2", description: "x;y" });
    expect(l).toContain(String.raw`SUMMARY:A\, B\; C\nD\\E`);
    expect(l).toContain(String.raw`LOCATION:Room 1\, Floor 2`);
    expect(l).toContain(String.raw`DESCRIPTION:x\;y`);
  });
  it("validates", () => {
    expect(err("event", { title: "T", start: "2027-03-14T18:00", end: "2027-03-14T17:00" }).end).toBe("End must be after start");
    expect(err("event", { title: "T", start: "2027-03-14T18:00", timezone: "Mars/Olympus" }).timezone).toBe("Unknown time zone");
    expect(err("event", { title: "", start: "2027-03-14T18:00" }).title).toBe("Enter a title");
    expect(err("event", { title: "T", start: "soon" }).start).toBe("Pick a start");
  });
});

describe("geo", () => {
  it("encodes RFC 5870 URIs", () => {
    expect(enc("geo", { lat: 37.7749, lng: -122.4194 })).toBe("geo:37.7749,-122.4194");
    expect(enc("geo", { lat: "37.7749", lng: "-122.4194", label: "San Francisco (HQ)" })).toBe("geo:37.7749,-122.4194?q=37.7749,-122.4194(San%20Francisco%20%28HQ%29)");
    expect(enc("geo", { lat: 0, lng: 0 })).toBe("geo:0,0");
  });
  it("rejects out-of-range coordinates", () => {
    expect(err("geo", { lat: 91, lng: 0 }).lat).toBeTruthy();
    expect(err("geo", { lat: 0, lng: -181 }).lng).toBeTruthy();
  });
});

describe("whatsapp", () => {
  it("uses wa.me with digits only", () => {
    expect(enc("whatsapp", { phone: "+1 (415) 555-0132" })).toBe("https://wa.me/14155550132");
    expect(enc("whatsapp", { phone: "+14155550132", message: "Hello there!" })).toBe("https://wa.me/14155550132?text=Hello%20there%21");
    expect(err("whatsapp", { phone: "12" }).phone).toMatch(/international format/);
  });
});

describe("social", () => {
  it("builds profile URLs", () => {
    expect(enc("social", { platform: "github", handle: "octocat" })).toBe("https://github.com/octocat");
    expect(enc("social", { platform: "instagram", handle: "@me.name_1" })).toBe("https://instagram.com/me.name_1");
    expect(enc("social", { platform: "youtube", handle: "chan" })).toBe("https://youtube.com/@chan");
    expect(enc("social", { platform: "linkedin", handle: "jane-doe" })).toBe("https://www.linkedin.com/in/jane-doe");
    expect(enc("social", { platform: "orcid", handle: "0000-0002-1825-0097" })).toBe("https://orcid.org/0000-0002-1825-0097");
    expect(enc("social", { platform: "custom", handle: "example.com/me" })).toBe("https://example.com/me");
  });
  it("rejects URLs as handles and unsafe custom URLs", () => {
    expect(err("social", { platform: "github", handle: "github.com/x" }).handle).toBe("Enter just the handle, without a URL");
    expect(err("social", { platform: "custom", handle: "javascript:alert(1)" }).handle).toBe("Only http and https destinations are allowed");
    expect(err("social", { platform: "nonsense", handle: "x" }).platform).toBeTruthy();
  });
});

describe("doi", () => {
  const url = "https://doi.org/10.1038/nature12373";
  it("accepts bare DOIs, doi: and URL prefixes", () => {
    for (const d of ["10.1038/nature12373", "doi:10.1038/nature12373", "DOI: 10.1038/nature12373", "https://doi.org/10.1038/nature12373", "http://dx.doi.org/10.1038/nature12373", "  10.1038/nature12373 "]) {
      expect(enc("doi", { doi: d }), d).toBe(url);
    }
  });
  it("escapes characters that would change the URL structure", () => {
    expect(enc("doi", { doi: "10.1000/a#b?c" })).toBe("https://doi.org/10.1000/a%23b%3Fc");
    expect(enc("doi", { doi: "10.1002/(SICI)1097-4571(199806)49:8<693::AID-ASI4>3.0.CO;2-O" })).toBe(
      "https://doi.org/10.1002/(SICI)1097-4571(199806)49:8%3C693::AID-ASI4%3E3.0.CO;2-O",
    );
  });
  it("rejects non-DOIs", () => {
    expect(err("doi", { doi: "not-a-doi" }).doi).toBe("A DOI looks like 10.1038/nature12373");
    expect(err("doi", { doi: "10.12/short" }).doi).toBeTruthy();
  });
});

describe("encodePayload error shape", () => {
  it("reports the first message per field and `_` for unkeyed issues", () => {
    expect(err("wifi", { ssid: "", password: "" })).toMatchObject({ ssid: "Network name is required" });
    expect(Object.keys(err("text", {}))).toContain("text");
  });
});

describe("withScheme", () => {
  it.each([
    ["example.com", "https://example.com"],
    ["  example.com/path?q=1  ", "https://example.com/path?q=1"],
    ["//cdn.example.com/a", "https://cdn.example.com/a"],
    ["example.com:8080/x", "https://example.com:8080/x"],
    ["localhost:3000", "https://localhost:3000"],
    ["http://example.com", "http://example.com"],
    ["HTTPS://EXAMPLE.COM", "HTTPS://EXAMPLE.COM"],
    ["mailto:a@b.co", "mailto:a@b.co"],
    ["javascript:alert(1)", "javascript:alert(1)"],
    ["", ""],
    ["   ", ""],
  ])("%j -> %j", (input, out) => expect(withScheme(input)).toBe(out));
});

describe("capacity and helpers", () => {
  it("measures bytes, not characters", () => {
    expect(byteLength("é")).toBe(2);
    expect(byteLength("日本")).toBe(6);
    expect(payloadFits("a".repeat(BYTE_CAPACITY.H), "H")).toBe(true);
    expect(payloadFits("a".repeat(BYTE_CAPACITY.H + 1), "H")).toBe(false);
    expect(payloadFits("é".repeat(1000), "H")).toBe(false);
  });
  it("builds short URLs and chooses what the QR encodes", () => {
    expect(shortUrl("https://qr.test/", "abc")).toBe("https://qr.test/r/abc");
    expect(qrData({ mode: "dynamic", payload: "https://x.example", slug: "abc" }, "https://qr.test")).toBe("https://qr.test/r/abc");
    expect(qrData({ mode: "static", payload: "hello", slug: null }, "https://qr.test")).toBe("hello");
    expect(qrData({ mode: "dynamic", payload: "https://x.example", slug: null }, "https://qr.test")).toBe("https://x.example");
  });
});
