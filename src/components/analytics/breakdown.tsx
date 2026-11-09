"use client";

const MAX_ROWS = 8;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function Breakdown({title, note, data, label = cap}: {
    title: string;
    note?: string;
    data: Record<string, number>;
    label?: (key: string) => string
}) {
    const rows = Object.entries(data).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
    if (rows.length === 0) return null;
    const total = rows.reduce((n, [, v]) => n + v, 0);
    const shown = rows.slice(0, MAX_ROWS).map(([k, v]) => ({k: label(k), v}));
    const rest = rows.slice(MAX_ROWS).reduce((n, [, v]) => n + v, 0);
    if (rest) shown.push({k: "Other", v: rest});
    return (
        <section className="rounded-xl bg-card p-4 ring-1 ring-foreground/10" aria-label={title}>
            <h2 className="font-medium">{title}</h2>
            {note ? <p className="mt-1 text-xs text-muted-foreground">{note}</p> : null}
            <ul className="mt-3 space-y-2.5">
                {shown.map(({k, v}) => (
                    <li key={k} className="text-sm">
                        <div className="flex justify-between gap-2">
                            <span className="truncate">{k}</span>
                            <span
                                className="shrink-0 tabular-nums text-muted-foreground">{v.toLocaleString()} · {Math.round((v / total) * 100)}%</span>
                        </div>
                        <div aria-hidden className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                            <div className="h-full rounded-full bg-[var(--chart-2)]"
                                 style={{width: `${(v / total) * 100}%`}}/>
                        </div>
                    </li>
                ))}
            </ul>
        </section>
    );
}

export function countryName(code: string) {
    try {
        return new Intl.DisplayNames(["en"], {type: "region"}).of(code.toUpperCase()) ?? code;
    } catch {
        return code;
    }
}
