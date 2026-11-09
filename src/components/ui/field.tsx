"use client";
import {useEffect, useId, useState} from "react";
import {cn} from "@/lib/utils";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";

export function Field({label, hint, error, children, className}: {
    label: string;
    hint?: React.ReactNode;
    error?: string;
    className?: string;
    children: (p: { id: string; "aria-describedby"?: string; "aria-invalid"?: boolean }) => React.ReactNode
}) {
    const id = useId();
    const desc = error ? `${id}-e` : hint ? `${id}-h` : undefined;
    return (
        <div className={cn("grid min-w-0 gap-1.5", className)}>
            <Label htmlFor={id} className="text-sm font-medium">{label}</Label>
            {children({id, "aria-describedby": desc, "aria-invalid": error ? true : undefined})}
            {error ? <p id={`${id}-e`} role="alert" className="text-xs text-destructive">{error}</p> : hint ?
                <p id={`${id}-h`} className="text-xs text-muted-foreground">{hint}</p> : null}
        </div>
    );
}

export function NativeSelect({className, ...p}: React.ComponentProps<"select">) {
    return (
        <select
            {...p}
            className={cn("h-10 w-full min-w-0 rounded-md border border-input bg-transparent px-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive [&>option]:bg-popover [&>option]:text-popover-foreground", className)}
        />
    );
}

export function TextField({label, hint, error, className, ...p}: {
    label: string;
    hint?: React.ReactNode;
    error?: string
} & React.ComponentProps<"input">) {
    return (
        <Field label={label} hint={hint} error={error} className={className}>
            {(a) => <Input {...a} {...p} className="h-10"/>}
        </Field>
    );
}

export function RangeField({label, value, min, max, step = 1, onChange, format, disabled}: {
    label: string;
    value: number;
    min: number;
    max: number;
    step?: number;
    onChange: (v: number) => void;
    format?: (v: number) => string;
    disabled?: boolean
}) {
    return (
        <Field label={label}>
            {(a) => (
                <div className="flex items-center gap-3">
                    <input {...a} type="range" min={min} max={max} step={step} value={value} disabled={disabled}
                           onChange={(e) => onChange(Number(e.target.value))} className="h-6 w-full accent-primary"/>
                    <span
                        className="w-14 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{format ? format(value) : value}</span>
                </div>
            )}
        </Field>
    );
}

export function ColorField({label, value, onChange, disabled}: {
    label: string;
    value: string;
    onChange: (v: string) => void;
    disabled?: boolean
}) {
    const [text, setText] = useState(value);
    useEffect(() => setText(value), [value]);
    return (
        <Field label={label}>
            {(a) => (
                <div className="flex items-center gap-2">
                    <input {...a} type="color" value={value} disabled={disabled}
                           onChange={(e) => onChange(e.target.value)}
                           className="size-10 shrink-0 cursor-pointer rounded-md border border-input bg-transparent p-1 disabled:opacity-50"/>
                    <Input
                        aria-label={`${label} hex value`}
                        value={text}
                        disabled={disabled}
                        onChange={(e) => {
                            setText(e.target.value);
                            if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) onChange(e.target.value.toLowerCase());
                        }}
                        onBlur={() => setText(value)}
                        className="h-10 font-mono text-sm uppercase"
                        maxLength={7}
                        spellCheck={false}
                    />
                </div>
            )}
        </Field>
    );
}
