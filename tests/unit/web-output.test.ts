import {describe, expect, it} from "vitest";
import {type AnalyticsReport, reportCsv, toCsv} from "@/lib/analytics-report";
import {DEFAULT_BRAND, esc, gatePage, page, PAGE_HEADERS, PAGES} from "@/lib/public-pages";
import {deviceCategory} from "@/lib/resolve";
import type {Settings} from "@/lib/schema";

const brand = (o: Partial<Settings["brand"]> = {}): Settings["brand"] => ({...DEFAULT_BRAND, ...o});

describe("toCsv", () => {
    it("joins rows with CRLF and ends with a final CRLF", () => {
        expect(toCsv([["a", "b"], [1, 2]])).toBe("a,b\r\n1,2\r\n");
    });
    it("quotes cells containing commas, quotes, CR or LF and doubles quotes", () => {
        expect(toCsv([['he said "hi"', "a,b", "l1\nl2", "l1\r\nl2", "plain"]])).toBe('"he said ""hi""","a,b","l1\nl2","l1\r\nl2",plain\r\n');
        expect(toCsv([["a\rb"]])).toBe('"a\rb"\r\n');
    });
    it.each(["=1+1", "+SUM(A1)", "-2+3", "@cmd", "\tTAB", "\rCR", '=HYPERLINK("http://evil","x")'])("neutralises spreadsheet formula %j", (cell) => {
        const out = toCsv([[cell]]);
        expect(out.startsWith("'") || out.startsWith('"\'')).toBe(true);
        expect(out).not.toMatch(/^[=+\-@\t\r]/);
    });
    it("leaves harmless cells and ordinary numbers alone", () => {
        expect(toCsv([["name = x", "a-b", "5", 42, 0]])).toBe("name = x,a-b,5,42,0\r\n");
    });
    it("neutralises formulas that also need quoting", () => {
        expect(toCsv([['=A1,"x"']])).toBe('"\'=A1,""x"""\r\n');
    });
    it("an empty table is just the terminator", () => {
        expect(toCsv([])).toBe("\r\n");
    });
});

describe("reportCsv", () => {
    const report: AnalyticsReport = {
        range: {from: "2027-01-01", to: "2027-01-02"},
        enabled: true,
        retentionDays: 90,
        totals: {scans: 3, codes: 1, active: 1, expired: 0, paused: 0, scheduled: 0, exhausted: 0},
        daily: [{day: "2027-01-01", scans: 1}, {day: "2027-01-02", scans: 2}],
        devices: {mobile: 2, desktop: 1},
        countries: {US: 3},
        top: [{id: "abcdefgh1", name: "=EVIL()", scans: 3, mode: "dynamic"}],
        recent: [],
    };
    it("emits a header and one row per metric, neutralising code names", () => {
        expect(reportCsv(report).split("\r\n")).toEqual([
            "section,key,value",
            "daily,2027-01-01,1",
            "daily,2027-01-02,2",
            "device,mobile,2",
            "device,desktop,1",
            "country,US,3",
            "top,'=EVIL(),3",
            "",
        ]);
    });
});

describe("esc", () => {
    it("escapes the five HTML metacharacters", () => {
        expect(esc(`<a href="x" onclick='y'>&</a>`)).toBe("&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;");
        expect(esc("plain")).toBe("plain");
        expect(esc("&amp;")).toBe("&amp;amp;");
    });
});

describe("public pages", () => {
    const XSS = `<script>alert(1)</script><img src=x onerror=alert(2)>"'`;
    const noInjection = (html: string) => {
        expect(html).not.toContain("<script");
        expect(html).not.toMatch(/<img/i);
        expect(html).not.toContain("onerror=alert(2)>");
        expect(html).not.toContain("alert(1)</script>");
    };
    it("neutralises script injection in brand fields and messages", () => {
        const b = brand({name: XSS, footer: XSS, expiredTitle: XSS, expiredMessage: XSS});
        for (const html of [
            page(b, {title: XSS, message: XSS, icon: "!"}),
            PAGES.notFound(b),
            PAGES.expired(b, XSS),
            PAGES.expired(b, null),
            PAGES.exhausted(b, XSS),
            PAGES.removed(b),
            PAGES.paused(b),
            PAGES.unavailable(b),
            PAGES.limited(b),
            PAGES.badDestination(b),
            gatePage(b, XSS, XSS),
            gatePage(b, `"><script>alert(1)</script>`),
        ]) {
            noInjection(html);
        }
        expect(page(b, {title: "t", message: XSS})).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    });
    it("does not let an invalid accent inject CSS or markup", () => {
        const html = page(brand({accent: "red;}</style><script>alert(1)</script>"}), {title: "t", message: "m"});
        noInjection(html);
        expect(html).toContain("--ac:#4f46e5");
        expect(page(brand({accent: "#aabbcc"}), {title: "t", message: "m"})).toContain("--ac:#aabbcc");
    });
    it("renders the password gate form posting back to the encoded slug", () => {
        const html = gatePage(brand(), "my-slug");
        expect(html).toContain('<form method="post" action="/r/my-slug"');
        expect(html).toContain('type="password"');
        expect(html).not.toContain('id="err"');
        const withErr = gatePage(brand(), "my-slug", "Incorrect password.");
        expect(withErr).toContain('role="alert"');
        expect(withErr).toContain("Incorrect password.");
    });
    it("shows the activation time for not-yet pages and tolerates bad dates", () => {
        expect(PAGES.notYet(brand(), "2027-03-14T18:00:00.000Z")).toContain("Sun, 14 Mar 2027 18:00:00 GMT");
        expect(() => PAGES.notYet(brand(), "garbage")).not.toThrow();
    });
    it("uses the brand's expired copy unless a custom message is given", () => {
        const b = brand({expiredTitle: "Gone fishing", expiredMessage: "Back soon"});
        expect(PAGES.expired(b, null)).toContain("Gone fishing");
        expect(PAGES.expired(b, null)).toContain("Back soon");
        expect(PAGES.expired(b, "Custom note")).toContain("Custom note");
        expect(PAGES.expired(b, "Custom note")).not.toContain("Back soon");
    });
    it("is a self-contained, script-free document", () => {
        const html = PAGES.notFound(DEFAULT_BRAND);
        expect(html.startsWith("<!doctype html>")).toBe(true);
        expect(html).toContain('<meta name="robots" content="noindex">');
        expect(html).not.toMatch(/<script|<link|<iframe|src=/i);
    });
    it("ships strict response headers", () => {
        expect(PAGE_HEADERS["Content-Security-Policy"]).toContain("default-src 'none'");
        expect(PAGE_HEADERS["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
        expect(PAGE_HEADERS["Cache-Control"]).toMatch(/no-store/);
        expect(PAGE_HEADERS["X-Content-Type-Options"]).toBe("nosniff");
        expect(PAGE_HEADERS["Referrer-Policy"]).toBe("no-referrer");
        expect(PAGE_HEADERS["X-Robots-Tag"]).toMatch(/noindex/);
        expect(PAGE_HEADERS["Content-Type"]).toBe("text/html; charset=utf-8");
    });
});

describe("deviceCategory", () => {
    it.each([
        [null, "other"],
        ["", "other"],
        ["Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1", "mobile"],
        ["Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36", "mobile"],
        ["Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1", "tablet"],
        ["Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36", "tablet"],
        ["Mozilla/5.0 (Linux; U; Android 4.0; Kindle Fire) Silk/3.0", "tablet"],
        ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36", "desktop"],
        ["Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0", "desktop"],
        ["Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)", "bot"],
        ["Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)", "bot"],
        ["facebookexternalhit/1.1", "bot"],
        ["WhatsApp/2.23.20 A", "bot"],
        ["TelegramBot (like TwitterBot)", "bot"],
        ["Mozilla/5.0 (Windows NT 10.0) Preview/1.0", "bot"],
    ] as const)("%s -> %s", (ua, out) => expect(deviceCategory(ua)).toBe(out));
});
