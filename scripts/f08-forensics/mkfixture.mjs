// Rebuild the a3 host archive so it carries review records (srs / reviewLogs / reviewPending).
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { strToU8, zipSync } from "fflate";

const root = process.argv[2];
const setup = JSON.parse(fs.readFileSync(path.join(root, "setup.json"), "utf8"));
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const json = value => JSON.stringify(value, null, 2) + "\n";

const original = fs.readFileSync(setup.archive);
const { unzipSync } = await import("fflate");
const entries = Object.fromEntries(Object.entries(unzipSync(new Uint8Array(original))).map(([k, v]) => [k, v]));
const payload = JSON.parse(Buffer.from(entries["studyset.json"]).toString("utf8"));
const card = payload.cards[0];
const state = { due: "2026-11-25", interval: 3, ease: 250, reps: 4, stability: 3.42, difficulty: 5.1, lapses: 1, state: 2,
  lastReviewed: "2026-11-18", learningSteps: 0, elapsedDays: 3, scheduledDays: 3, algorithm: "fsrs" };
payload.srs = { [card.id]: { ...state } };
payload.reviewLogs = [
  { id: "review-log-fixture-1", cardId: card.id, questionId: card.id, rating: 3, reviewedAt: "2026-11-17T09:12:00.000Z", elapsedMs: 4200,
    before: { ...state, reps: 2, state: 1 }, after: { ...state, reps: 3 }, previousWrong: false, algorithm: "fsrs" },
  { id: "review-log-fixture-2", cardId: card.id, questionId: card.id, rating: 4, reviewedAt: "2026-11-18T10:31:00.000Z", elapsedMs: 3600,
    before: { ...state, reps: 3 }, after: { ...state, reps: 4 }, previousWrong: false, algorithm: "fsrs" },
];
payload.reviewPending = [
  { id: "review-pending-fixture-1", cardId: card.id, questionId: card.id, due: "2026-11-25", queuedAt: "2026-11-18T10:31:00.000Z" },
];
const files = { "studyset.json": strToU8(json(payload)) };
for (const [name, bytes] of Object.entries(entries)) if (name.startsWith("documents/")) files[name] = bytes;
files["MANIFEST.json"] = strToU8(json({ format: "marginstudy-study-set-manifest", version: 1, studySetId: payload.studySets[0].id,
  createdAt: "2026-11-19T10:00:00.000Z", files: Object.entries(files).map(([path, bytes]) => ({ path, bytes: bytes.length, sha256: sha(bytes) })) }));
const archive = zipSync(files, { mtime: new Date("2026-11-19T10:00:00.000Z") });
fs.writeFileSync(setup.archive, archive);
const record = { archive: setup.archive, archiveSha256: sha(archive), studySetId: payload.studySets[0].id, cardId: card.id,
  reviewLogIds: payload.reviewLogs.map(l => l.id), reviewPendingIds: payload.reviewPending.map(r => r.id), srsKey: card.id,
  memberHashes: Object.fromEntries(Object.entries(files).map(([n, b]) => [n, sha(b)])) };
setup.archiveSha256 = record.archiveSha256;
setup.reviewFixture = record;
fs.writeFileSync(path.join(root, "setup.json"), json(setup));
fs.writeFileSync(path.join(root, "fixture.json"), json(record));
console.log(JSON.stringify(record));