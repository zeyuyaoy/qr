import {NextResponse} from "next/server";
import {ZodError} from "zod";
import type {ApiErrorCode, ApiResult} from "./schema";
import {RedisUnavailableError} from "./redis/client";
import {RepoError} from "./redis/repo";
import {SealError} from "./seal";

const STATUS: Record<ApiErrorCode, number> = {
    UNAUTHENTICATED: 401,
    FORBIDDEN: 403,
    BAD_REQUEST: 400,
    NOT_FOUND: 404,
    CONFLICT: 409,
    SLUG_TAKEN: 409,
    REV_MISMATCH: 409,
    RATE_LIMITED: 429,
    REDIS_UNAVAILABLE: 503,
    RECOVERY_REQUIRED: 409,
    PAYLOAD_TOO_LARGE: 413,
    NOT_CONFIGURED: 501,
    INTERNAL: 500,
};

const HEADERS = {"Cache-Control": "no-store"} as const;

export class ApiError extends Error {
    constructor(public code: ApiErrorCode, message: string, public details?: unknown, public headers?: Record<string, string>) {
        super(message);
    }
}

export function ok<T>(data: T, init?: { status?: number; headers?: Record<string, string> }) {
    return NextResponse.json({ok: true, data} satisfies ApiResult<T>, {
        status: init?.status ?? 200,
        headers: {...HEADERS, ...init?.headers}
    });
}

export function fail(code: ApiErrorCode, message: string, details?: unknown, headers?: Record<string, string>) {
    return NextResponse.json({ok: false, error: {code, message, details}} satisfies ApiResult<never>, {
        status: STATUS[code],
        headers: {...HEADERS, ...headers},
    });
}

export function toErrorResponse(e: unknown) {
    if (e instanceof ApiError) return fail(e.code, e.message, e.details, e.headers);
    if (e instanceof RepoError) return fail(e.code, e.message, e.details);
    if (e instanceof RedisUnavailableError) return fail("REDIS_UNAVAILABLE", "The database is temporarily unavailable. Try again shortly.");
    if (e instanceof SealError) return fail("NOT_CONFIGURED", e.message);
    if (e instanceof ZodError) {
        return fail("BAD_REQUEST", "Invalid request", e.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message
        })));
    }
    console.error("[api] unhandled", e instanceof Error ? e.name : typeof e);
    return fail("INTERNAL", "Something went wrong");
}

export async function readJson<T = unknown>(req: Request, maxBytes = 256 * 1024): Promise<T> {
    const len = Number(req.headers.get("content-length") ?? 0);
    if (len > maxBytes) throw new ApiError("PAYLOAD_TOO_LARGE", "Request body is too large");
    const reader = req.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader) {
        for (; ;) {
            const {value, done} = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > maxBytes) {
                await reader.cancel();
                throw new ApiError("PAYLOAD_TOO_LARGE", "Request body is too large");
            }
            chunks.push(value);
        }
    }
    const text = Buffer.concat(chunks).toString("utf8");
    try {
        return JSON.parse(text || "{}") as T;
    } catch {
        throw new ApiError("BAD_REQUEST", "Body must be valid JSON");
    }
}
