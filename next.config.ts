import type {NextConfig} from "next";

const csp = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "production" ? "" : " 'unsafe-eval'"}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "worker-src 'self'",
    "manifest-src 'self'",
    "media-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self' https://accounts.google.com",
    "frame-ancestors 'none'",
    ...(process.env.VERCEL ? ["upgrade-insecure-requests"] : []),
].join("; ");

const security = [
    {key: "Content-Security-Policy", value: csp},
    {key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload"},
    {key: "X-Content-Type-Options", value: "nosniff"},
    {key: "X-Frame-Options", value: "DENY"},
    {key: "Referrer-Policy", value: "strict-origin-when-cross-origin"},
    {key: "Cross-Origin-Opener-Policy", value: "same-origin"},
    {
        key: "Permissions-Policy",
        value: "camera=(self), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()"
    },
];

const config: NextConfig = {
    distDir: process.env.NEXT_DIST_DIR || ".next",
    reactStrictMode: true,
    poweredByHeader: false,
    env: {NEXT_PUBLIC_SW_VERSION: process.env.VERCEL_GIT_COMMIT_SHA || Date.now().toString(36)},
    async headers() {
        return [
            {source: "/:path*", headers: security},
            {
                source: "/sw.js",
                headers: [{
                    key: "Cache-Control",
                    value: "no-cache, no-store, must-revalidate"
                }, {key: "Service-Worker-Allowed", value: "/"}]
            },
            {source: "/api/:path*", headers: [{key: "Cache-Control", value: "no-store"}]},
        ];
    },
};
export default config;
