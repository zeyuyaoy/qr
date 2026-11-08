import { ok } from "@/lib/api";
import { ownerRoute } from "@/lib/guard";
import { buildStatus } from "@/lib/server-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = ownerRoute(async (_req, { owner }) => ok({ ...(await buildStatus()), user: { email: owner.email } }));
