import {describe, expect, it} from "vitest";
import {appHost, checkDestination} from "@/lib/url-safety";

const bad = (u: string, opts?: { appHost?: string }) => {
    const r = checkDestination(u, opts);
    if (r.ok) throw new Error(`expected rejection of ${u}`);
    return r.reason;
};
const good = (u: string, opts?: { appHost?: string }) => {
    const r = checkDestination(u, opts);
    if (!r.ok) throw new Error(`expected ${u} to pass, got: ${r.reason}`);
    return r.url;
};

describe("checkDestination: accepted", () => {
    it("returns the input byte-for-byte (query and fragment untouched)", () => {
        for (const u of [
            "https://example.com",
            "http://example.com/a/b",
            "https://Example.COM:443/a%2Fb?x=1&y=%20&z=%E2%9C%93#frag%C3%A9&more=1",
            "https://example.com/path/../x?q=a+b&empty=&=v#",
            "https://example.com/?redirect=https://other.example/%2e%2e",
            "https://xn--bcher-kva.example/",
            "https://8.8.8.8/",
            "https://[2001:db8::1]/x",
            "https://172.32.0.1/",
            "https://100.63.255.255/",
        ]) {
            expect(good(u), u).toBe(u);
        }
    });
    it("trims surrounding whitespace only", () => {
        expect(good("  https://example.com/a?b#c \n")).toBe("https://example.com/a?b#c");
    });
    it("allows another host and non-/r/ paths on the app host", () => {
        expect(good("https://qr.test/about", {appHost: "qr.test"})).toBe("https://qr.test/about");
        expect(good("https://other.test/r/abc", {appHost: "qr.test"})).toBe("https://other.test/r/abc");
    });
});

describe("checkDestination: rejected", () => {
    it("rejects empty input and over-long URLs", () => {
        expect(bad("")).toBe("URL is empty");
        expect(bad("   ")).toBe("URL is empty");
        expect(bad(`https://example.com/${"a".repeat(2040)}`)).toBe("URL is longer than 2048 characters");
        expect(good(`https://example.com/${"a".repeat(2048 - 20)}`)).toHaveLength(2048);
    });
    it("rejects non-http(s) schemes", () => {
        for (const u of ["javascript:alert(1)", "JavaScript:alert(1)", "data:text/html,<script>alert(1)</script>", "file:///etc/passwd", "ftp://example.com/x", "vbscript:x", "blob:https://example.com/abc", "mailto:a@b.co", "//example.com"]) {
            expect(bad(u), u).toMatch(/Only http and https|Not a valid absolute URL/);
        }
        expect(bad("javascript:alert(1)")).toBe("Only http and https destinations are allowed");
        expect(bad("data:text/html;base64,AAAA")).toBe("Only http and https destinations are allowed");
        expect(bad("file:///etc/passwd")).toBe("Only http and https destinations are allowed");
    });
    it("rejects relative and malformed URLs", () => {
        expect(bad("/relative/path")).toBe("Not a valid absolute URL");
        expect(bad("example.com")).toBe("Not a valid absolute URL");
        expect(bad("https://")).toBe("Not a valid absolute URL");
        expect(bad("http://[::1")).toBe("Not a valid absolute URL");
    });
    it("rejects embedded credentials", () => {
        expect(bad("https://user:pw@example.com/")).toBe("URLs with embedded credentials are not allowed");
        expect(bad("https://user@example.com/")).toBe("URLs with embedded credentials are not allowed");
        expect(bad("https://:pw@example.com/")).toBe("URLs with embedded credentials are not allowed");
    });
    it("rejects whitespace and control characters anywhere", () => {
        for (const u of ["https://exa mple.com/", "https://example.com/a b", "https://example.com/\u0000", "https://example.com/\tx", "https://example.com/\nx", "https://example.com/\u007f", "https://example.com/\u001f", "https://example.com/ x"]) {
            expect(bad(u), JSON.stringify(u)).toBe("URL contains spaces or control characters");
        }
    });
    it("rejects localhost and internal names", () => {
        expect(bad("http://localhost/")).toBe("Host must be a public domain name");
        expect(bad("http://intranet/")).toBe("Host must be a public domain name");
        for (const u of ["http://foo.localhost/", "http://printer.local/", "http://metadata.google.internal/", "http://FOO.LOCALHOST/"]) {
            expect(bad(u), u).toBe("Local and internal hosts are not allowed");
        }
    });
    it("rejects the same names written with a trailing dot", () => {
        for (const u of ["http://localhost./", "http://foo.localhost./", "http://metadata.google.internal./", "http://printer.local./x"]) {
            expect(bad(u), u).toMatch(/not allowed|public domain/);
        }
    });
    it("rejects private, loopback, link-local and CGNAT IPv4 literals", () => {
        for (const ip of ["10.0.0.1", "10.255.255.255", "127.0.0.1", "127.255.0.9", "0.0.0.0", "169.254.169.254", "192.168.0.1", "172.16.0.1", "172.20.1.1", "172.31.255.255", "100.64.0.1", "100.127.255.255"]) {
            expect(bad(`http://${ip}/x`), ip).toBe("Private IP addresses are not allowed");
        }
    });
    it("rejects IPv4 written in alternative notations (the URL parser normalises them)", () => {
        for (const u of ["http://2130706433/", "http://0x7f.0.0.1/", "http://0x7f000001/", "http://127.1/", "http://017700000001/", "http://127.0.0.1./"]) {
            expect(bad(u), u).toBe("Private IP addresses are not allowed");
        }
    });
    it("rejects loopback, unique-local and link-local IPv6 (including IPv4-mapped)", () => {
        for (const ip of ["[::1]", "[::]", "[fc00::1]", "[fd12:3456::1]", "[fe80::1]", "[::ffff:127.0.0.1]", "[::ffff:10.0.0.1]"]) {
            expect(bad(`http://${ip}/`), ip).toBe("Private IPv6 addresses are not allowed");
        }
    });
    it("rejects our own redirector (loop prevention), any case", () => {
        const o = {appHost: "qr.test"};
        expect(bad("https://qr.test/r/abc", o)).toBe("A dynamic link cannot point at another QR Studio link");
        expect(bad("http://QR.TEST/r/abc?x=1#y", o)).toBe("A dynamic link cannot point at another QR Studio link");
        expect(bad("https://qr.test/r/", {appHost: "QR.test"})).toBe("A dynamic link cannot point at another QR Studio link");
    });
    it("does not apply the loop rule without an app host", () => {
        expect(good("https://qr.test/r/abc")).toBe("https://qr.test/r/abc");
    });
});

describe("appHost", () => {
    it("extracts the hostname or undefined", () => {
        expect(appHost("https://qr.example.com:8443/x")).toBe("qr.example.com");
        expect(appHost("not a url")).toBeUndefined();
        expect(appHost(undefined)).toBeUndefined();
        expect(appHost("")).toBeUndefined();
    });
});
