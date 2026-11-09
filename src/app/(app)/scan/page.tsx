"use client";
import {History, Trash2} from "lucide-react";
import {useEffect, useRef, useState} from "react";
import {CameraScanner} from "@/components/scan/camera-scanner";
import {ImageScanner} from "@/components/scan/image-scanner";
import {ResultCard} from "@/components/scan/result-card";
import {PageHeader} from "@/components/page-header";
import {Button} from "@/components/ui/button";
import {formatDateTime, useSettings} from "@/lib/client/hooks";
import {parseScanned} from "@/lib/qr/parse";

type Scan = { key: number; raw: string; at: string };
const MAX_HISTORY = 20;
let seq = 0;

function preview(raw: string) {
    const p = parseScanned(raw);
    if (p.type === "wifi") return `Wi-Fi: ${p.summary[0]?.value ?? ""}`;
    return raw.replace(/\s+/g, " ").slice(0, 70);
}

export default function ScanPage() {
    const {settings} = useSettings();
    const [scans, setScans] = useState<Scan[]>([]);
    const [current, setCurrent] = useState<Scan | null>(null);
    const headingRef = useRef<HTMLHeadingElement>(null);

    const onResult = (raw: string) => {
        const s = {key: ++seq, raw, at: new Date().toISOString()};
        setScans((l) => [s, ...l].slice(0, MAX_HISTORY));
        setCurrent(s);
    };

    useEffect(() => {
        if (current) headingRef.current?.focus({preventScroll: false});
    }, [current]);

    return (
        <>
            <PageHeader title="Scan" description="Scans stay on this device."/>
            <div className="max-w-2xl space-y-4">
                {current && <ResultCard key={current.key} raw={current.raw} headingRef={headingRef}
                                        onScanAgain={() => setCurrent(null)}/>}

                {!current && (
                    <>
                        <section aria-label="Camera">
                            <CameraScanner onResult={onResult}/>
                        </section>
                        <section aria-label="Scan an image">
                            <ImageScanner onResult={onResult}/>
                        </section>
                    </>
                )}

                {scans.length > 0 && (
                    <section aria-labelledby="scan-hist" className="space-y-2">
                        <div className="flex items-center justify-between gap-2">
                            <h2 id="scan-hist" className="flex items-center gap-2 font-medium"><History
                                className="size-4"/> This session</h2>
                            <Button variant="ghost" className="tap" onClick={() => {
                                setScans([]);
                                setCurrent(null);
                            }}><Trash2/> Clear</Button>
                        </div>
                        <p className="text-xs text-muted-foreground">Kept in memory only. Leaving this page or reloading
                            clears it.</p>
                        <ul className="divide-y rounded-xl border">
                            {scans.map((s) => (
                                <li key={s.key}>
                                    <button type="button" onClick={() => setCurrent(s)}
                                            aria-current={current?.key === s.key}
                                            className="tap flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring aria-[current=true]:bg-muted">
                                        <span className="w-full truncate text-sm">{preview(s.raw)}</span>
                                        <span
                                            className="text-xs text-muted-foreground">{formatDateTime(s.at, settings.timezone)}</span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </section>
                )}
            </div>
        </>
    );
}
