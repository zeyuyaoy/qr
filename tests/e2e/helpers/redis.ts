export function e2eRedisUrl(value = process.env.E2E_REDIS_URL ?? "redis://localhost:6390/5"): string {
    const url = URL.parse(value);
    if (
        url?.protocol !== "redis:" ||
        !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname.toLowerCase()) ||
        url.username || url.password || url.search || url.hash ||
        !/^\/[1-9]\d*$/.test(url.pathname) ||
        !Number.isSafeInteger(Number(url.pathname.slice(1)))
    ) {
        throw new Error("E2E_REDIS_URL must use credential-free local Redis with an explicit nonzero database");
    }
    return url.href;
}
