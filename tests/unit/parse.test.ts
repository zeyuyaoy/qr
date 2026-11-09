import {describe, expect, it} from "vitest";
import {parseScanned} from "@/lib/qr/parse";
import {encodePayload, TYPES} from "@/lib/qr/payload";
import type {ContentType} from "@/lib/schema";

const enc = (t: ContentType, f: Record<string, unknown>) => {
    const r = encodePayload(t, f);
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    return r.payload;
};
const roundTrip = (t: ContentType, f: Record<string, unknown>) => {
    const payload = enc(t, f);
    const parsed = parseScanned(payload);
    return {payload, parsed, again: encodePayload(parsed.type, parsed.fields)};
};

describe("parseScanned round-trips with the encoders", () => {
    it("url", () => {
        const {parsed, payload} = roundTrip("url", {url: "https://example.com/a?b=1#c"});
        expect(parsed).toMatchObject({type: "url", sensitive: false, fields: {url: payload}});
    });
    it("text falls through", () => {
        for (const text of ["Hello world", "multi\nline", "", "  spaced  ", "https://example.com/has space"]) {
            const p = parseScanned(text);
            expect(p.type, JSON.stringify(text)).toBe("text");
            expect(p.fields).toEqual({text});
        }
    });
    it("email", () => {
        const f = {to: "hello@example.com", subject: "Hi & bye (1)", body: "Line1\nLine2 + 100%"};
        const {parsed, payload, again} = roundTrip("email", f);
        expect(parsed.type).toBe("email");
        expect(parsed.fields).toEqual(f);
        expect(again).toEqual({ok: true, payload});
    });
    it("phone", () => {
        const {parsed, again, payload} = roundTrip("phone", {number: "+1 (415) 555-0132"});
        expect(parsed).toMatchObject({type: "phone", fields: {number: "+14155550132"}});
        expect(again).toEqual({ok: true, payload});
    });
    it("sms", () => {
        const {parsed, again, payload} = roundTrip("sms", {
            number: "+1 415 555 0132",
            message: "Hi there, 100% & more"
        });
        expect(parsed).toMatchObject({type: "sms", fields: {number: "+14155550132", message: "Hi there, 100% & more"}});
        expect(again).toEqual({ok: true, payload});
        expect(parseScanned("SMSTO:+123456:Hello").fields).toMatchObject({number: "+123456", message: "Hello"});
    });
    it("wifi, including every escaped character", () => {
        for (const f of [
            {ssid: "Home", password: "secret123", security: "WPA", hidden: false},
            {ssid: "Hidden", password: "secret123", security: "WPA", hidden: true},
            {ssid: "Open cafe", password: "", security: "nopass", hidden: false},
            {ssid: "Old", password: "abc", security: "WEP", hidden: false},
            {ssid: String.raw`a\b;c,d:e"f`, password: String.raw`p\;,:"word99`, security: "WPA", hidden: false},
            {ssid: "semi;colon", password: "pass;word;P:x", security: "WPA", hidden: false},
        ]) {
            const {parsed, again, payload} = roundTrip("wifi", f);
            expect(parsed.type).toBe("wifi");
            expect(parsed.sensitive).toBe(true);
            expect(parsed.fields, payload).toEqual(f);
            expect(again).toEqual({ok: true, payload});
        }
    });
    it("does not let an SSID containing ';P:' hijack the password field", () => {
        const f = {ssid: "x;P:evil;H:true", password: "realpass99", security: "WPA", hidden: false};
        const {parsed} = roundTrip("wifi", f);
        expect(parsed.fields).toEqual(f);
    });
    it("wifi summary never prints the password", () => {
        const p = parseScanned("WIFI:T:WPA;S:Home;P:supersecret1;;");
        expect(JSON.stringify(p.summary)).not.toContain("supersecret1");
        expect(p.summary.map((s) => s.label)).toEqual(["Network", "Security", "Password"]);
    });
    it("wifi is case-insensitive and tolerant of missing fields", () => {
        expect(parseScanned("wifi:t:wpa;s:Net;p:pw12345678;;").fields).toMatchObject({
            ssid: "Net",
            password: "pw12345678",
            security: "WPA"
        });
        expect(parseScanned("WIFI:S:Net;;").fields).toMatchObject({ssid: "Net", security: "nopass"});
        expect(parseScanned("WIFI:T:WPA2-EAP;S:Net;P:pw12345678;;").fields).toMatchObject({security: "WPA"});
    });
    it("vcard", () => {
        const f = {
            firstName: "Ada",
            lastName: "Lovelace",
            org: "Analytical Engines",
            title: "Countess",
            mobile: "+44 20 7946 0958",
            email: "ada@example.com",
            url: "example.com",
            note: "hi"
        };
        const {parsed, payload} = roundTrip("vcard", f);
        expect(parsed.type).toBe("vcard");
        expect(parsed.sensitive).toBe(true);
        expect(parsed.fields).toMatchObject({
            firstName: "Ada",
            lastName: "Lovelace",
            org: "Analytical Engines",
            title: "Countess",
            mobile: "+44 20 7946 0958",
            email: "ada@example.com",
            url: "https://example.com",
            note: "hi"
        });
        expect(parsed.summary[0]).toEqual({label: "Name", value: "Ada Lovelace"});
        expect(encodePayload("vcard", parsed.fields)).toEqual({
            ok: true,
            payload: payload.replace("URL:https://example.com", "URL:https://example.com")
        });
    });
    it("vcard unescapes values so re-encoding does not double-escape", () => {
        const f = {firstName: "A;B", lastName: "C,D", org: String.raw`Smith, Jones; back\slash`, note: "line1\nline2"};
        const {parsed, payload, again} = roundTrip("vcard", f);
        expect(parsed.fields).toMatchObject(f);
        expect(again).toEqual({ok: true, payload});
    });
    it("event (UTC)", () => {
        const f = {
            title: "Launch, party; 1",
            start: "2027-03-14T18:00",
            end: "2027-03-14T21:00",
            allDay: false,
            timezone: "UTC",
            location: "Room 1, Floor 2",
            description: "x;y"
        };
        const {parsed, again, payload} = roundTrip("event", f);
        expect(parsed.type).toBe("event");
        expect(parsed.fields).toMatchObject(f);
        expect(again).toEqual({ok: true, payload});
    });
    it("all-day events keep their inclusive end date", () => {
        for (const f of [
            {title: "Trip", start: "2027-03-14", end: "2027-03-16", allDay: true, timezone: "UTC"},
            {title: "Day", start: "2027-12-31", allDay: true, timezone: "UTC"},
        ]) {
            const {parsed, again, payload} = roundTrip("event", f);
            expect(parsed.fields).toMatchObject({allDay: true, start: f.start, end: f.end ?? f.start});
            expect(again).toEqual({ok: true, payload});
        }
    });
    it("geo", () => {
        const {parsed} = roundTrip("geo", {lat: 37.7749, lng: -122.4194, label: "SF"});
        expect(parsed).toMatchObject({type: "geo", fields: {lat: 37.7749, lng: -122.4194}});
        expect(parseScanned("geo:-33.86,151.21").fields).toMatchObject({lat: -33.86, lng: 151.21});
    });
    it("whatsapp", () => {
        const {parsed} = roundTrip("whatsapp", {phone: "+1 415 555 0132", message: "Hello there!"});
        expect(parsed).toMatchObject({type: "whatsapp", fields: {phone: "+14155550132", message: "Hello there!"}});
    });
    it("doi", () => {
        for (const doi of ["10.1038/nature12373", "10.1000/a#b?c", "10.1000/50%", "10.1002/(SICI)1097-4571(199806)49:8<693::AID-ASI4>3.0.CO;2-O"]) {
            const {parsed, again, payload} = roundTrip("doi", {doi});
            expect(parsed, doi).toMatchObject({type: "doi", fields: {doi}});
            expect(again).toEqual({ok: true, payload});
        }
        expect(parseScanned("https://dx.doi.org/10.1038/x1").type).toBe("doi");
    });
    it("social profiles come back as plain URLs", () => {
        expect(parseScanned(enc("social", {platform: "github", handle: "octocat"})).type).toBe("url");
    });
    it("every type's example encodes to something parseScanned classifies sensibly", () => {
        const expected: Record<ContentType, ContentType> = {
            url: "url",
            text: "text",
            email: "email",
            phone: "phone",
            sms: "sms",
            wifi: "wifi",
            vcard: "vcard",
            event: "event",
            geo: "geo",
            whatsapp: "whatsapp",
            social: "url",
            doi: "doi"
        };
        for (const t of Object.keys(TYPES) as ContentType[]) expect(parseScanned(enc(t, TYPES[t].example)).type, t).toBe(expected[t]);
    });
});
