import type {Settings} from "@/lib/schema";

export type SectionProps = {
    draft: Settings;
    update: (fn: (s: Settings) => Settings) => void;
    errors: Record<string, string>;
};
