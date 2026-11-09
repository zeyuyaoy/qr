const get = (k: string) => {
    const v = process.env[k];
    return v && v.trim() ? v.trim() : undefined;
};

export const env = {
    redisUrl: () => get("REDIS_URL") ?? get("QR_REDIS_URL"),
    appUrl: () => (get("NEXT_PUBLIC_APP_URL") ?? get("APP_URL") ?? "http://localhost:3000").replace(/\/+$/, ""),
    ownerEmails: () =>
        (get("OWNER_EMAILS") ?? "")
            .split(",")
            .map((e) => e.trim().toLowerCase())
            .filter(Boolean),
    cronSecret: () => get("CRON_SECRET"),
    dataKey: () => get("DATA_ENCRYPTION_KEY"),
    backupKey: () => get("BACKUP_ENCRYPTION_KEY"),
    github: () => {
        const repo = get("BACKUP_GITHUB_REPO");
        const token = get("BACKUP_GITHUB_TOKEN");
        return repo && token ? {repo, token, branch: get("BACKUP_GITHUB_BRANCH") ?? "main"} : null;
    },
    keyPrefix: () => (process.env.NODE_ENV === "test" && get("QR_KEY_PREFIX")) || "qr:v1:",
    testAuthEnabled: () => get("ENABLE_TEST_AUTH") === "1" && !process.env.VERCEL,
    trustGeoHeaders: () => process.env.VERCEL === "1",
};

export type ConfigReport = {
    redis: boolean;
    auth: boolean;
    ownerEmails: number;
    backup: boolean;
    backupKey: boolean;
    githubRepo: boolean;
    githubToken: boolean;
    cron: boolean;
    sealing: boolean;
    appUrl: string;
    issues: string[];
};
export const configReport = (): ConfigReport => ({
    redis: Boolean(env.redisUrl()),
    auth: Boolean(get("AUTH_SECRET") && get("AUTH_GOOGLE_ID") && get("AUTH_GOOGLE_SECRET")),
    ownerEmails: env.ownerEmails().length,
    backup: Boolean(env.github() && env.backupKey()),
    backupKey: Boolean(env.backupKey()),
    githubRepo: Boolean(get("BACKUP_GITHUB_REPO")),
    githubToken: Boolean(get("BACKUP_GITHUB_TOKEN")),
    cron: Boolean(env.cronSecret()),
    sealing: Boolean(env.dataKey()),
    appUrl: env.appUrl(),
    issues: configIssues(),
});

function configIssues(): string[] {
    const issues: string[] = [];
    const url = (name: string, value: string | undefined, schemes: string[]) => {
        try {
            if (!value || !schemes.includes(new URL(value).protocol)) throw new Error();
        } catch {
            issues.push(`${name} must be a valid ${schemes.join(" or ")} URL`);
        }
    };
    url("REDIS_URL", env.redisUrl(), ["redis:", "rediss:"]);
    url("NEXT_PUBLIC_APP_URL", env.appUrl(), ["https:", "http:"]);
    for (const name of ["DATA_ENCRYPTION_KEY", "BACKUP_ENCRYPTION_KEY"]) {
        if (Buffer.from(get(name) ?? "", "base64").length !== 32) issues.push(`${name} must contain 32 random bytes encoded as base64`);
    }
    for (const name of ["AUTH_SECRET", "AUTH_GOOGLE_ID", "AUTH_GOOGLE_SECRET", "OWNER_EMAILS", "CRON_SECRET"]) {
        if (!get(name)) issues.push(`${name} is missing`);
    }
    if (env.github() && !/^[\w.-]+\/[\w.-]+$/.test(env.github()!.repo)) issues.push("BACKUP_GITHUB_REPO must be owner/name");
    return issues;
}
