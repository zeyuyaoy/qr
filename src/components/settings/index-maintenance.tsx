"use client";
import {Loader2, Wrench} from "lucide-react";
import {useState} from "react";
import {toast} from "sonner";
import {Button} from "@/components/ui/button";
import {api, type IndexReport} from "@/lib/client/api";
import {useOnline} from "@/lib/client/hooks";

function Row({k, v}: { k: string; v: number }) {
    return (
        <>
            <dt className="text-muted-foreground">{k}</dt>
            <dd className={v ? "font-medium" : ""}>{v}</dd>
        </>
    );
}

export function IndexMaintenance() {
    const online = useOnline();
    const [busy, setBusy] = useState<"verify" | "repair" | null>(null);
    const [report, setReport] = useState<IndexReport | null>(null);
    const [verified, setVerified] = useState(false);

    const run = async (apply: boolean) => {
        setBusy(apply ? "repair" : "verify");
        try {
            const r = await api.admin.repair(apply);
            setReport(r);
            setVerified(true);
            toast.success(apply ? "Indexes repaired" : "Verification finished");
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Index check failed");
        } finally {
            setBusy(null);
        }
    };

    const problems = report ? report.corrupt.length + report.missingFromIndex.length + report.staleIndexEntries.length + report.slugFixed + report.slugConflicts.length + report.folderFixed + report.tagFixed + report.orphanAssets : 0;

    return (
        <div className="space-y-3" aria-labelledby="idx-title" role="group">
            <div>
                <h3 id="idx-title" className="text-sm font-medium">Index maintenance</h3>
                <p className="text-sm text-muted-foreground">The library list, short-link lookups, folders and tags are
                    derived from the code records. If they ever disagree (for example after an interrupted write),
                    verify first, then repair. Verify changes nothing. Repair rebuilds those indexes and removes
                    uploaded logo images that no code, template or default uses. It never deletes a code.</p>
            </div>
            <div className="flex flex-wrap gap-2">
                <Button variant="outline" className="tap" onClick={() => void run(false)}
                        disabled={!online || busy !== null}>
                    {busy === "verify" ? <Loader2 className="animate-spin"/> : <Wrench/>} Verify indexes
                </Button>
                <Button variant="outline" className="tap" onClick={() => void run(true)}
                        disabled={!online || busy !== null || !verified || (report !== null && !report.applied && problems === 0)}>
                    {busy === "repair" ? <Loader2 className="animate-spin"/> : <Wrench/>} Repair indexes
                </Button>
            </div>
            {!verified &&
                <p className="text-xs text-muted-foreground">Run Verify first. Repair becomes available afterwards.</p>}
            {report && (
                <div role="status" className="rounded-lg border p-3 text-sm">
                    <p className="mb-2 font-medium">
                        {report.applied ? "Repair applied. " : "Dry run only, nothing changed. "}
                        {problems === 0 ? "No problems found." : `${problems} issue${problems === 1 ? "" : "s"} ${report.applied ? "fixed or reported" : "found"}.`}
                    </p>
                    <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-1">
                        <Row k="Codes scanned" v={report.codes}/>
                        <Row k="Unreadable records" v={report.corrupt.length}/>
                        <Row k="Missing from the list index" v={report.missingFromIndex.length}/>
                        <Row k="Stale list entries" v={report.staleIndexEntries.length}/>
                        <Row k="Short-link entries to fix" v={report.slugFixed}/>
                        <Row k="Duplicate short links" v={report.slugConflicts.length}/>
                        <Row k="Folder entries to fix" v={report.folderFixed}/>
                        <Row k="Tag entries to fix" v={report.tagFixed}/>
                        <Row k="Unused logo images (removed on repair)" v={report.orphanAssets}/>
                    </dl>
                    {report.slugConflicts.length > 0 && (
                        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
                            {report.slugConflicts.map((c) => <li key={c.droppedId}>Slug <span
                                className="font-mono">{c.slug}</span> is used by two codes. The older one ({c.keptId})
                                keeps it; {c.droppedId} loses its short link.</li>)}
                        </ul>
                    )}
                    {report.corrupt.length > 0 &&
                        <p className="mt-2 text-xs text-muted-foreground">Unreadable record ids: <span
                            className="font-mono">{report.corrupt.slice(0, 10).join(", ")}</span>. Repair cannot fix
                            these; restore them from a backup.</p>}
                </div>
            )}
        </div>
    );
}
