"use client";
import {memo, useEffect, useRef, useState} from "react";
import {useLogoUrl} from "@/lib/client/logo";
import {compositeLogo, loadQrLib} from "@/lib/qr/render";
import {renderKey, toStylingOptions} from "@/lib/qr/style";
import type {QrStyle} from "@/lib/schema";
import {cn} from "@/lib/utils";

export const QrPreview = memo(function QrPreview({data, style, size = 256, className, label}: {
    data: string;
    style: QrStyle;
    size?: number;
    className?: string;
    label?: string
}) {
    const host = useRef<HTMLDivElement>(null);
    const last = useRef<string>("");
    const logoUrl = useLogoUrl(style.logo.assetId);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const key = renderKey(data, style, logoUrl) + size;
        if (key === last.current) return;
        let cancelled = false;
        const t = setTimeout(async () => {
            try {
                const QR = await loadQrLib();
                const logo = await compositeLogo(logoUrl, style.logo);
                if (cancelled || !host.current) return;
                const opts = {...toStylingOptions(data || " ", style, {size, logoUrl: logo}), type: "svg" as const};
                // Updating an existing renderer retains omitted options such as gradients and logos.
                const qr = new QR(opts);
                host.current.replaceChildren();
                qr.append(host.current);
                last.current = key;
                setError(null);
            } catch (e) {
                if (!cancelled) setError(e instanceof Error ? e.message : "Could not render");
            }
        }, last.current ? 60 : 0);
        return () => {
            cancelled = true;
            clearTimeout(t);
        };
    }, [data, style, size, logoUrl]);

    return (
        <div
            role="img"
            aria-label={label ?? "QR code preview"}
            data-testid="qr-preview"
            data-qr-data={data}
            className={cn("relative aspect-square w-full overflow-hidden rounded-xl bg-[repeating-conic-gradient(#e5e5e5_0%_25%,#fff_0%_50%)] bg-[length:16px_16px] [&>div>svg]:h-full [&>div>svg]:w-full", className)}
        >
            <div ref={host} className="h-full w-full"/>
            {error ?
                <p className="absolute inset-0 grid place-items-center p-3 text-center text-sm text-destructive">{error}</p> : null}
        </div>
    );
});
