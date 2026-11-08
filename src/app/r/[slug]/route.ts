import { handleResolve } from "@/lib/resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };
const run = async (req: Request, { params }: Ctx) => handleResolve(req, (await params).slug);
export { run as GET, run as POST, run as HEAD };
