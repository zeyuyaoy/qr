import {NextResponse} from "next/server";
import {health} from "@/lib/redis/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
    const h = await health();
    return NextResponse.json({ok: h.ok}, {status: h.ok ? 200 : 503, headers: {"Cache-Control": "no-store"}});
}
