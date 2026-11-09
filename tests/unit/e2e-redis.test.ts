import {expect, it} from "vitest";
import {e2eRedisUrl} from "../e2e/helpers/redis";

it.each([
    "redis://localhost:6390/5",
    "redis://127.0.0.1:6390/6",
    "redis://[::1]:6390/7",
])("accepts an explicit local test database (%s)", (url) => {
    expect(e2eRedisUrl(url)).toBe(url);
});

it.each([
    "redis://localhost:6379@remote.example/5",
    "redis://user:password@localhost:6390/5",
    "redis://localhost.example:6390/5",
    "rediss://localhost:6390/5",
    "redis://localhost:6390",
    "redis://localhost:6390/0",
    "redis://localhost:6390/1.5",
    "redis://localhost:6390/9007199254740992",
    "redis://localhost:6390/5?db=0",
    "malformed",
])("refuses unsafe test targets (%s)", (url) => {
    expect(() => e2eRedisUrl(url)).toThrow("explicit nonzero database");
});
