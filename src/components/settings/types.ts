import type { Settings } from "@/lib/schema";

/** What every settings section receives from the page. */
export type SectionProps = {
  draft: Settings;
  update: (fn: (s: Settings) => Settings) => void;
  /** Validation messages keyed by dotted path, e.g. "brand.accent". */
  errors: Record<string, string>;
};
