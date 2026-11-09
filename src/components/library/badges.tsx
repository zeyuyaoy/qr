import {Archive, Link2, Lock, Trash2} from "lucide-react";
import {Badge} from "@/components/ui/badge";
import type {CachedView} from "@/lib/client/offline";
import type {QrView} from "@/lib/schema";
import {cn} from "@/lib/utils";

const AMBER = "bg-amber-500/15 text-amber-800 dark:text-amber-200";
const LINK_STATE: Partial<Record<QrView["linkState"], { label: string; cls: string }>> = {
    paused: {label: "Paused", cls: AMBER},
    expired: {label: "Expired", cls: "bg-destructive/10 text-destructive"},
    not_yet: {label: "Scheduled", cls: "bg-sky-500/15 text-sky-800 dark:text-sky-200"},
    exhausted: {label: "Limit reached", cls: "bg-destructive/10 text-destructive"},
};

export function ItemBadges({item, showStatus = false, className}: {
    item: Pick<CachedView, "mode" | "linkState" | "hasPassword" | "status" | "_pending" | "_error">;
    showStatus?: boolean;
    className?: string
}) {
    const ls = item.mode === "dynamic" ? LINK_STATE[item.linkState] : undefined;
    return (
        <div className={cn("flex flex-wrap items-center gap-1", className)}>
            {item._error ? (
                <Badge className="bg-destructive/10 text-destructive">Sync error</Badge>
            ) : item._pending ? (
                <Badge className={AMBER}>Pending sync</Badge>
            ) : null}
            <Badge variant={item.mode === "dynamic" ? "secondary" : "outline"}>
                {item.mode === "dynamic" ? <Link2 aria-hidden/> : null}
                {item.mode === "dynamic" ? "Dynamic" : "Static"}
            </Badge>
            {ls ? <Badge className={ls.cls}>{ls.label}</Badge> : null}
            {item.hasPassword ? (
                <Badge variant="outline">
                    <Lock aria-hidden/> Password
                </Badge>
            ) : null}
            {showStatus && item.status === "archived" ? (
                <Badge variant="outline">
                    <Archive aria-hidden/> Archived
                </Badge>
            ) : null}
            {showStatus && item.status === "trashed" ? (
                <Badge variant="outline">
                    <Trash2 aria-hidden/> In trash
                </Badge>
            ) : null}
        </div>
    );
}
