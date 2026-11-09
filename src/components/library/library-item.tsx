"use client";
import {
    Archive,
    ArchiveRestore,
    Check,
    Clipboard,
    Copy,
    Download,
    MoreVertical,
    Pencil,
    Pin,
    PinOff,
    RefreshCw,
    Star,
    StarOff,
    Trash2,
    X
} from "lucide-react";
import Link from "next/link";
import {memo} from "react";
import {Button} from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import type {CachedView, PendingOp} from "@/lib/client/offline";
import {TYPES} from "@/lib/qr/payload";
import {cn} from "@/lib/utils";
import {ItemBadges} from "./badges";
import {TAP} from "./common";
import {LazyQr} from "./lazy-qr";
import {itemData} from "./library-actions";

export type ItemAction =
    "duplicate"
    | "favorite"
    | "unfavorite"
    | "pin"
    | "unpin"
    | "archive"
    | "restore"
    | "trash"
    | "purge"
    | "png"
    | "svg"
    | "copy-link";
export type PendingAction = "retry-slug" | "discard";
export type FolderInfo = { name: string; color: string | null };

type Props = {
    item: CachedView;
    layout: "grid" | "list";
    selecting: boolean;
    selected: boolean;
    offline: boolean;
    folder?: FolderInfo;
    op?: PendingOp;
    syncing: boolean;
    onToggle: (id: string) => void;
    onAction: (a: ItemAction, item: CachedView) => void;
    onPending: (a: PendingAction, op: PendingOp) => void;
};

const MI = "min-h-10 md:min-h-8";

function SelectBox({selected, name, onClick, className}: {
    selected: boolean;
    name: string;
    onClick: () => void;
    className?: string
}) {
    return (
        <button type="button" onClick={onClick} aria-pressed={selected} aria-label={`Select ${name}`}
                className={cn("grid size-11 shrink-0 place-items-center rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50", className)}>
            <span
                className={cn("grid size-5 place-items-center rounded-md border-2 bg-background", selected && "border-primary bg-primary text-primary-foreground")}>{selected ?
                <Check className="size-3.5" aria-hidden/> : null}</span>
        </button>
    );
}

function ItemMenu({item, offline, onAction}: Pick<Props, "item" | "offline" | "onAction">) {
    const onServer = item.rev > 0;
    const act = (a: ItemAction) => () => onAction(a, item);
    const server = offline || !onServer;
    return (
        <DropdownMenu>
            <DropdownMenuTrigger
                render={<Button variant="ghost" size="icon" className="tap" aria-label={`Actions for ${item.name}`}/>}>
                <MoreVertical aria-hidden/>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-52">
                <DropdownMenuGroup>
                    <DropdownMenuLabel>{item.name}</DropdownMenuLabel>
                    {onServer ? (
                        <DropdownMenuItem className={MI} render={<Link href={`/library/${item.id}`}/>}>
                            <Pencil/> Open / Edit
                        </DropdownMenuItem>
                    ) : null}
                    <DropdownMenuItem className={MI} disabled={server} onClick={act("duplicate")}>
                        <Copy/> Duplicate
                    </DropdownMenuItem>
                    <DropdownMenuItem className={MI} disabled={server}
                                      onClick={act(item.favorite ? "unfavorite" : "favorite")}>
                        {item.favorite ? <StarOff/> : <Star/>} {item.favorite ? "Remove favorite" : "Favorite"}
                    </DropdownMenuItem>
                    <DropdownMenuItem className={MI} disabled={server || item.status === "trashed"}
                                      onClick={act(item.pinned ? "unpin" : "pin")}>
                        {item.pinned ? <PinOff/> : <Pin/>} {item.pinned ? "Unpin" : "Pin to top"}
                    </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator/>
                <DropdownMenuGroup>
                    {item.status === "active" ? (
                        <DropdownMenuItem className={MI} disabled={server} onClick={act("archive")}>
                            <Archive/> Archive
                        </DropdownMenuItem>
                    ) : (
                        <DropdownMenuItem className={MI} disabled={server} onClick={act("restore")}>
                            <ArchiveRestore/> Restore
                        </DropdownMenuItem>
                    )}
                    {item.status !== "trashed" ? (
                        <DropdownMenuItem className={MI} disabled={server} onClick={act("trash")}>
                            <Trash2/> Move to trash
                        </DropdownMenuItem>
                    ) : (
                        <DropdownMenuItem className={MI} variant="destructive" disabled={server} onClick={act("purge")}>
                            <Trash2/> Delete forever
                        </DropdownMenuItem>
                    )}
                </DropdownMenuGroup>
                <DropdownMenuSeparator/>
                <DropdownMenuGroup>
                    <DropdownMenuItem className={MI} onClick={act("png")}>
                        <Download/> Download PNG
                    </DropdownMenuItem>
                    <DropdownMenuItem className={MI} onClick={act("svg")}>
                        <Download/> Download SVG
                    </DropdownMenuItem>
                    {item.mode === "dynamic" && item.slug && onServer ? (
                        <DropdownMenuItem className={MI} onClick={act("copy-link")}>
                            <Clipboard/> Copy short link
                        </DropdownMenuItem>
                    ) : null}
                </DropdownMenuGroup>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

function PendingActions({
                            item,
                            op,
                            offline,
                            syncing,
                            onPending
                        }: Pick<Props, "item" | "op" | "offline" | "syncing" | "onPending">) {
    const error = item._error ?? op?.error;
    const canRetrySlug = op?.kind === "create" && op.input.mode === "dynamic" && op.status === "failed";
    return (
        <div className="flex flex-wrap items-center gap-2 border-t px-3 py-2">
            <p className={cn("min-w-0 flex-1 text-xs", error ? "text-destructive" : "text-muted-foreground")}
               role={error ? "alert" : undefined}>
                {error ?? (offline ? "Waiting for a connection." : syncing ? "Syncing…" : "Waiting to sync.")}
            </p>
            {canRetrySlug && op ? (
                <Button size="sm" variant="outline" className={cn(TAP, "md:min-h-7")} disabled={offline}
                        onClick={() => onPending("retry-slug", op)}>
                    <RefreshCw/> Retry with new slug
                </Button>
            ) : null}
            {op ? (
                <Button size="sm" variant="ghost" className={cn(TAP, "md:min-h-7")}
                        onClick={() => onPending("discard", op)}>
                    <X/> Discard
                </Button>
            ) : null}
        </div>
    );
}

export const LibraryItem = memo(function LibraryItem({
                                                         item,
                                                         layout,
                                                         selecting,
                                                         selected,
                                                         offline,
                                                         folder,
                                                         op,
                                                         syncing,
                                                         onToggle,
                                                         onAction,
                                                         onPending
                                                     }: Props) {
    const onServer = item.rev > 0;
    const grid = layout === "grid";
    const data = itemData(item);
    const toggle = () => onToggle(item.id);
    const nameCls = "min-w-0 truncate text-left text-sm font-medium";
    const name = selecting ? (
        <button type="button" onClick={toggle}
                className={cn(nameCls, "rounded outline-none focus-visible:ring-2 focus-visible:ring-ring/50")}>
            {item.name}
        </button>
    ) : onServer ? (
        <Link href={`/library/${item.id}`}
              className={cn(nameCls, "rounded outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50")}>
            {item.name}
        </Link>
    ) : (
        <span className={nameCls}>{item.name}</span>
    );

    const marks = (
        <>
            {item.favorite ? <Star role="img" aria-label="Favorite"
                                   className="size-3.5 shrink-0 fill-amber-400 text-amber-500"/> : null}
            {item.pinned ?
                <Pin role="img" aria-label="Pinned" className="size-3.5 shrink-0 text-muted-foreground"/> : null}
        </>
    );
    const meta = (
        <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
            <span>{TYPES[item.type].label}</span>
            {folder ? (
                <>
                    <span aria-hidden>·</span>
                    <span className="inline-flex min-w-0 items-center gap-1">
            <span aria-hidden className="size-2 shrink-0 rounded-full border"
                  style={folder.color ? {background: folder.color} : undefined}/>
            <span className="truncate">{folder.name}</span>
          </span>
                </>
            ) : null}
            {item.mode === "dynamic" ? (
                <>
                    <span aria-hidden>·</span>
                    <span>{item.scans.toLocaleString()} {item.scans === 1 ? "scan" : "scans"}</span>
                </>
            ) : null}
        </p>
    );
    const thumb = <LazyQr data={data} style={item.style} size={grid ? 220 : 112} label={`QR code for ${item.name}`}
                          className={grid ? "rounded-xl" : "rounded-lg"}/>;

    return (
        <article aria-label={item.name}
                 className={cn("flex min-w-0 flex-col text-card-foreground", grid ? "overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10" : "border-b hover:bg-muted/40", selected && "ring-2 ring-primary", item.status !== "active" && "opacity-90")}>
            {grid ? (
                <>
                    <div className="relative p-3 pb-0">
                        {onServer && !selecting ? (
                            <Link href={`/library/${item.id}`} tabIndex={-1} aria-hidden className="block">
                                {thumb}
                            </Link>
                        ) : (
                            <div onClick={selecting ? toggle : undefined}>{thumb}</div>
                        )}
                        {selecting ? <SelectBox selected={selected} name={item.name} onClick={toggle}
                                                className="absolute left-1 top-1 bg-background/85 backdrop-blur"/> : null}
                        <div className="absolute right-1 top-1 rounded-lg bg-background/85 backdrop-blur">
                            <ItemMenu item={item} offline={offline} onAction={onAction}/>
                        </div>
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col gap-1.5 p-3">
                        <div className="flex min-w-0 items-center gap-1.5">
                            {name}
                            {marks}
                        </div>
                        {meta}
                        <ItemBadges item={item} showStatus={Boolean(op) || item.status !== "active"}/>
                    </div>
                </>
            ) : (
                <div className="flex min-h-16 items-center gap-3 px-1 py-2">
                    {selecting ? <SelectBox selected={selected} name={item.name} onClick={toggle}/> : null}
                    <div className="size-12 shrink-0">{thumb}</div>
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <div className="flex min-w-0 items-center gap-1.5">
                            {name}
                            {marks}
                        </div>
                        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="text-xs text-muted-foreground">{TYPES[item.type].label}</span>
                            <ItemBadges item={item} showStatus={item.status !== "active" || Boolean(op)}/>
                        </div>
                    </div>
                    <ItemMenu item={item} offline={offline} onAction={onAction}/>
                </div>
            )}
            {op ?
                <PendingActions item={item} op={op} offline={offline} syncing={syncing} onPending={onPending}/> : null}
        </article>
    );
});
