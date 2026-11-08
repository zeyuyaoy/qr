"use client";
import { useId, useState } from "react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

type AriaProps = { id: string; "aria-describedby"?: string; "aria-invalid"?: true };

/** Label + hint + error, with ids wired up through aria-describedby. */
export function Field({ label, hint, error, className, children }: { label: string; hint?: React.ReactNode; error?: string; className?: string; children: (p: AriaProps) => React.ReactNode }) {
  const id = useId();
  const described = [hint ? `${id}-hint` : "", error ? `${id}-err` : ""].filter(Boolean).join(" ");
  return (
    <div className={cn("grid gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-medium">{label}</label>
      {children({ id, ...(described ? { "aria-describedby": described } : {}), ...(error ? { "aria-invalid": true as const } : {}) })}
      {hint ? <p id={`${id}-hint`} className="text-xs text-muted-foreground">{hint}</p> : null}
      {error ? <p id={`${id}-err`} className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

export function Section({ id, title, description, children }: { id: string; title: string; description?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-16 space-y-4 rounded-xl bg-card p-4 ring-1 ring-foreground/10 sm:p-5">
      <div>
        <h2 id={`${id}-title`} className="text-base font-semibold">{title}</h2>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

export const selectClass =
  "h-11 w-full rounded-lg border border-input bg-transparent px-2.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive md:text-sm dark:bg-input/30 [&>option]:bg-popover [&>option]:text-popover-foreground";

export function SwitchRow({ label, hint, checked, onChange, disabled }: { label: string; hint?: React.ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  const id = useId();
  return (
    <label className={cn("flex min-h-11 items-center justify-between gap-4 py-1", disabled && "opacity-60")}>
      <span className="min-w-0">
        <span id={`${id}-l`} className="block text-sm font-medium">{label}</span>
        {hint ? <span id={`${id}-h`} className="block text-xs text-muted-foreground">{hint}</span> : null}
      </span>
      <Switch checked={checked} onCheckedChange={(v) => onChange(v)} disabled={disabled} aria-labelledby={`${id}-l`} aria-describedby={hint ? `${id}-h` : undefined} />
    </label>
  );
}

/** Native radio group. Keyboard and screen-reader behaviour comes for free. */
export function Choice<T extends string>({ legend, value, options, onChange, name, disabled }: { legend: string; value: T; options: { value: T; label: string; hint?: string }[]; onChange: (v: T) => void; name: string; disabled?: boolean }) {
  return (
    <fieldset disabled={disabled} className="grid gap-2">
      <legend className="mb-1 text-sm font-medium">{legend}</legend>
      <div className="grid gap-2 sm:grid-cols-[repeat(auto-fit,minmax(9rem,1fr))]">
        {options.map((o) => (
          <label key={o.value} className="flex min-h-11 cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 text-sm has-[:checked]:border-primary has-[:checked]:bg-muted has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50">
            <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} className="mt-0.5 size-4 accent-[var(--primary)]" />
            <span>
              <span className="block font-medium">{o.label}</span>
              {o.hint ? <span className="block text-xs text-muted-foreground">{o.hint}</span> : null}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Number input that keeps what the user typed and reports only finite numbers; follows external changes to `value`. */
export function NumberInput({ value, onChange, min, max, ...aria }: { value: number; onChange: (n: number) => void; min: number; max: number } & Partial<AriaProps>) {
  const [text, setText] = useState(String(value));
  const [prev, setPrev] = useState(value);
  if (value !== prev) {
    setPrev(value);
    if (Number(text) !== value) setText(String(value));
  }
  return (
    <Input
      type="number"
      inputMode="numeric"
      className="h-11"
      min={min}
      max={max}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const n = e.target.value === "" ? NaN : Number(e.target.value);
        if (Number.isFinite(n)) onChange(n);
      }}
      onBlur={() => setText(String(value))}
      {...aria}
    />
  );
}

/** Native colour picker paired with a hex text box. */
export function ColorField({ value, onChange, ...aria }: { value: string; onChange: (v: string) => void } & Partial<AriaProps>) {
  const valid = /^#[0-9a-fA-F]{6}$/.test(value);
  return (
    <div className="flex items-center gap-2">
      <input type="color" aria-label="Pick colour" value={valid ? value : "#000000"} onChange={(e) => onChange(e.target.value)} className="h-11 w-14 shrink-0 cursor-pointer rounded-lg border border-input bg-transparent p-1" />
      <Input className="h-11 font-mono" value={value} onChange={(e) => onChange(e.target.value.trim())} maxLength={7} spellCheck={false} autoComplete="off" {...aria} />
    </div>
  );
}
