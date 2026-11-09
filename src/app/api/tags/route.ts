import {z} from "zod";
import {ok, readJson} from "@/lib/api";
import {ownerRoute} from "@/lib/guard";
import {listTags, retag} from "@/lib/redis/repo";
import {tagSchema} from "@/lib/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z.object({from: tagSchema, to: tagSchema.nullable()});

export const GET = ownerRoute(async () => ok(await listTags()));
export const POST = ownerRoute(async (req) => {
    const {from, to} = body.parse(await readJson(req));
    return ok({updated: await retag(from, to)});
});
