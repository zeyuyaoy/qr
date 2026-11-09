import {zonedToUtc} from "../qr/payload";

export function utcToLocalInput(iso: string | null | undefined, timeZone: string): string {
    if (!iso) return "";
    try {
        const s = new Intl.DateTimeFormat("sv-SE", {
            timeZone,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            hourCycle: "h23"
        }).format(new Date(iso));
        return s.replace(" ", "T");
    } catch {
        return iso.slice(0, 16);
    }
}

export function localInputToUtc(value: string, timeZone: string): string | null {
    if (!value) return null;
    try {
        return zonedToUtc(value, timeZone).toISOString();
    } catch {
        return null;
    }
}

export const deviceTimeZone = () => {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch {
        return "UTC";
    }
};
export const timeZones = (): string[] => {
    try {
        return (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf("timeZone");
    } catch {
        return ["UTC", "America/New_York", "America/Los_Angeles", "Europe/London", "Europe/Berlin", "Asia/Singapore", "Asia/Tokyo", "Australia/Sydney"];
    }
};
