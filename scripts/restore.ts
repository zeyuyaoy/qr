/**
 * Disaster-recovery CLI. Restores a QR Studio snapshot into Redis without needing the web app.
 *
 *   bun run restore --list                          list snapshots in the GitHub backup repo
 *   bun run restore --github                        DRY RUN of the newest snapshot
 *   bun run restore --github --name qr-2026….qrbackup.json --apply --yes
 *   bun run restore --file ./export.qrbackup.json --mode replace --apply --yes
 *
 * Environment (or .env.local / .env in the current directory):
 *   REDIS_URL, BACKUP_ENCRYPTION_KEY, and for --github: BACKUP_GITHUB_REPO, BACKUP_GITHUB_TOKEN [, BACKUP_GITHUB_BRANCH]
 * Only keys under the `qr:v1:` namespace are ever written or deleted. Dry run is the default.
 */
import { existsSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { BackupFormatError } from "../src/lib/backup/envelope";
import { fetchRemote, listRemote } from "../src/lib/backup/github";
import { restoreSnapshot, unpackSnapshot, type RestoreReport } from "../src/lib/backup/snapshot";
import { closeRedis } from "../src/lib/redis/client";
import { getMeta } from "../src/lib/redis/repo";
import { prefix } from "../src/lib/redis/keys";

for (const f of [".env.local", ".env"]) if (existsSync(f)) (process as unknown as { loadEnvFile(p: string): void }).loadEnvFile(f);

const { values: a } = parseArgs({
  options: {
    list: { type: "boolean", default: false },
    github: { type: "boolean", default: false },
    name: { type: "string" },
    file: { type: "string" },
    apply: { type: "boolean", default: false },
    yes: { type: "boolean", default: false },
    mode: { type: "string", default: "merge" },
    prefer: { type: "string", default: "newer" },
    "redis-url": { type: "string" },
    help: { type: "boolean", default: false },
  },
  allowPositionals: false,
  strict: true,
});

const usage = () => console.log(readFileSync(new URL(import.meta.url), "utf8").split("*/")[0]!.replace(/^\/\*\*\n|^ \* ?/gm, ""));
const die = (m: string): never => (console.error(`\nError: ${m}`), process.exit(1));

async function main() {
  if (a.help) return usage();
  if (a["redis-url"]) process.env.REDIS_URL = a["redis-url"];
  const mode = a.mode as "merge" | "replace";
  const prefer = a.prefer as "newer" | "snapshot" | "existing";
  if (!["merge", "replace"].includes(mode)) die("--mode must be merge or replace");
  if (!["newer", "snapshot", "existing"].includes(prefer)) die("--prefer must be newer, snapshot or existing");

  if (a.list) {
    const snaps = await listRemote();
    if (!snaps.length) return console.log("No snapshots found.");
    for (const s of snaps) console.log(`${s.createdAt}  ${String(s.size).padStart(9)} B  ${s.name}`);
    return;
  }

  let text: string;
  if (a.file) {
    if (!existsSync(a.file)) die(`file not found: ${a.file}`);
    text = readFileSync(a.file, "utf8");
  } else if (a.github) {
    const name = a.name || (await listRemote())[0]?.name;
    if (!name) die("no snapshots found in the backup repository");
    console.log(`Downloading ${name} …`);
    text = await fetchRemote(name!);
  } else {
    usage();
    return die("choose a source: --github [--name <snapshot>] or --file <path> (or --list)");
  }

  const { snapshot, envelope } = unpackSnapshot(text, process.env.BACKUP_ENCRYPTION_KEY);
  console.log(`Snapshot verified: created ${envelope.createdAt}, ${envelope.recordCount} code(s), schema v${envelope.schemaVersion}, checksum OK`);

  const url = new URL(process.env.REDIS_URL ?? die("REDIS_URL is not set"));
  const local = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname);
  console.log(`Target Redis: ${url.hostname}:${url.port || 6379}  namespace: ${prefix()}  (${(await getMeta()) ? "library initialised" : "no library marker — looks empty or wiped"})`);

  const apply = a.apply === true;
  if (apply && (!local || mode === "replace") && !a.yes) {
    die(`refusing to write${local ? "" : " to a non-local Redis"}${mode === "replace" ? " in replace mode" : ""} without --yes`);
  }
  const report = await restoreSnapshot(snapshot, { dryRun: !apply, mode, prefer });
  print(report);
  if (!apply) console.log("\nDry run only — nothing was written. Re-run with --apply (and --yes where required) to restore.");
  else console.log("\nRestore complete. Changes made after this snapshot was taken are not recovered.");
}

function print(r: RestoreReport) {
  const c = r.codes;
  console.log(`\n${r.dryRun ? "DRY RUN" : "APPLIED"} (mode=${r.mode}, prefer=${r.prefer})`);
  console.log(`  codes:   create ${c.create} · update ${c.update} · unchanged ${c.unchanged} · kept existing ${c.keptExisting} · delete ${c.delete}`);
  console.log(`  skipped: slug conflicts ${c.slugConflicts} · invalid ${c.invalid}`);
  console.log(`  other:   folders ${r.folders} · templates ${r.templates} · logo assets ${r.assets} · stats keys ${r.statsKeys}`);
  console.log(`  init marker will be ${r.metaWillBeCreated ? "created" : "left as is"}`);
  for (const x of r.conflicts.slice(0, 20)) console.log(`  ! ${x.id} "${x.name}": ${x.reason}`);
  if (r.conflicts.length > 20) console.log(`  … ${r.conflicts.length - 20} more`);
}

main()
  .catch((e) => die(e instanceof BackupFormatError ? e.message : e instanceof Error ? e.message : String(e)))
  .finally(() => closeRedis().then(() => process.exit(process.exitCode ?? 0)));
