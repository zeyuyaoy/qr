"use client";
import {memo, useEffect, useRef, useState} from "react";
import {QrPreview} from "@/components/qr/qr-preview";
import type {QrStyle} from "@/lib/schema";
import {cn} from "@/lib/utils";

let io: IntersectionObserver | null = null;
const callbacks = new WeakMap<Element, (visible: boolean) => void>();

function watch(el: Element, cb: (visible: boolean) => void): () => void {
    io ??= new IntersectionObserver((entries) => entries.forEach((e) => callbacks.get(e.target)?.(e.isIntersecting)), {rootMargin: "400px"});
    callbacks.set(el, cb);
    io.observe(el);
    return () => {
        io?.unobserve(el);
        callbacks.delete(el);
    };
}

export const LazyQr = memo(function LazyQr({data, style, size = 160, className, label}: {
    data: string;
    style: QrStyle;
    size?: number;
    className?: string;
    label?: string
}) {
    const ref = useRef<HTMLDivElement>(null);
    const [visible, setVisible] = useState(false);
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        if (typeof IntersectionObserver === "undefined") {
            setVisible(true);
            return;
        }
        return watch(el, setVisible);
    }, []);
    return (
        <div ref={ref} className={cn("aspect-square w-full", className)}>
            {visible ? <QrPreview data={data} style={style} size={size} label={label} className="size-full"/> :
                <div aria-hidden className="size-full animate-pulse rounded-xl bg-muted"/>}
        </div>
    );
});
