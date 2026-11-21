// Card A stage 2 fixtures.
//   node mkfixture.mjs import  <root>   -> writes <root>/import-fixture.marginstudy-set.zip
//   node mkfixture.mjs legacy  <root>   -> seeds the vault with a legacy main state (no fingerprints, bare dates)
import fs from "node:fs";
import path from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { strToU8, zipSync } from "fflate";
import { createHash } from "node:crypto";
import { jsonWrite, sha256 } from "./lib.mjs";

const [kind, rootArg] = process.argv.slice(2);
const root = path.resolve(rootArg);
const setup = JSON.parse(fs.readFileSync(path.join(root, "setup.json"), "utf8"));
const vault = setup.vault;

async function pdf(label, pages) {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let page = 1; page <= pages; page++) doc.addPage([300, 400]).drawText(`${label} page ${page}`, { x: 24, y: 340, font, size: 12 });
  return doc.save();
}

if (kind === "import") {
  const TIME = "2026-11-20T02:00:00.000Z";
  const source = await pdf("Card A import source", 2);
  const pages = strToU8(JSON.stringify({ format: "marginstudy-page-collection", version: 1,
    pages: [{ sourcePath: "import-source.pdf", page: 1 }, { sourcePath: "import-source.pdf", page: 2 }] }));
  const cardA = { id: "seed-card-a", type: "qa", docPath: "import-source.pdf", page: 1, front: "卡 A 导入卡片 A",
    back: "答案 A", tags: ["card-a"], links: [], createdAt: TIME };
  const cardB = { id: "seed-card-b", type: "excerpt", docPath: "import-source.pdf", page: 2, anchorAnnId: "seed-ann-b",
    front: "卡 A 导入卡片 B", back: "答案 B", tags: [], links: ["seed-card-a"], createdAt: TIME };
  const set = { id: "seed-set", name: "卡 A 导入学习集", docPaths: ["import-source.pdf", "import-pages.msref"],
    cardIds: [cardA.id, cardB.id], createdAt: TIME };
  const canvas = { id: "seed-canvas", studySetId: set.id, name: "卡 A 主脑图", createdAt: TIME };
  const nodeA = { id: "seed-node-a", cardId: cardA.id, canvasId: canvas.id, title: cardA.front, x: 40, y: 60 };
  const nodeB = { id: "seed-node-b", cardId: cardB.id, canvasId: canvas.id, title: cardB.front, x: 40, y: 180, parentId: nodeA.id };
  const annotation = { id: "seed-ann-b", docPath: "import-source.pdf", cardId: cardB.id, type: "highlight", page: 2,
    text: "卡 A 标注", rects: [], createdAt: TIME };
  const documents = [{ id: "seed-doc-source", path: "import-source.pdf", kind: "pdf", createdAt: TIME },
    { id: "seed-doc-pages", path: "import-pages.msref", kind: "msref", createdAt: TIME }];
  // Legacy schedule dates are date-only on purpose: import must write UTC ISO.
  const srs = {
    [cardA.id]: { due: "2026-12-01", lastReviewed: "2026-11-25", interval: 10, reps: 2, ease: 2.5, state: 2 },
    [cardB.id]: { due: "2026-12-08", lastReviewed: "2026-12-01", interval: 8, reps: 1, ease: 2.4, state: 2 },
  };
  const payload = { format: "marginstudy-study-set", version: 1, cards: [cardA, cardB], nodes: [nodeA, nodeB],
    edges: [{ id: "seed-edge", from: nodeA.id, to: nodeB.id, label: ["卡A关联"] }], studySets: [set], canvases: [canvas],
    documents, srs, annotations: { "import-source.pdf": [annotation] }, docMeta: {}, reviewDecks: [], reviewLogs: [], reviewPending: [] };
  const files = { "documents/import-source.pdf": source, "documents/import-pages.msref": pages, "studyset.json": strToU8(JSON.stringify(payload)) };
  files["MANIFEST.json"] = strToU8(JSON.stringify({ format: "marginstudy-study-set-manifest", version: 1,
    studySetId: set.id, createdAt: TIME,
    files: Object.entries(files).map(([path, bytes]) => ({ path, bytes: bytes.length, sha256: sha256(bytes) })) }));
  const archive = zipSync(files, { mtime: new Date(TIME) });
  const out = path.join(root, "import-fixture.marginstudy-set.zip");
  fs.writeFileSync(out, archive);
  const report = { archive: out, archiveSha256: sha256(archive), entries: Object.fromEntries(Object.entries(files).map(([p, b]) => [p, sha256(b)])),
    sourcePdfSha256: sha256(source), pagesCollectionSha256: sha256(pages), payload,
    srsIntent: { cardA: srs[cardA.id], cardB: srs[cardB.id] }, time: TIME };
  jsonWrite(path.join(root, "fixture.json"), report);
  console.log(JSON.stringify({ archive: out, archiveSha256: report.archiveSha256, entries: report.entries }));
}

if (kind === "legacy") {
  // Historical library built with an older build: documents carry no fingerprint,
  // schedules still hold date-only values.
  const TIME = "2026-10-28T09:15:00.000Z";
  const sourceOld = await pdf("Card A legacy source", 2);
  const sourceReadable = await pdf("Card A legacy readable source", 1);
  const write = (rel, bytes) => {
    const abs = path.join(vault, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, bytes);
    return { path: rel, byteSize: bytes.length, sha256: sha256(bytes) };
  };
  const seeded = {
    "legacy-source.pdf": write("legacy-source.pdf", sourceOld),
    "legacy-source-2.pdf": write("legacy-source-2.pdf", sourceReadable),
  };
  const cardA = { id: "legacy-card-a", type: "qa", docPath: "legacy-source.pdf", page: 1, front: "历史卡片 A",
    back: "旧答案 A", tags: [], links: [], createdAt: TIME };
  const cardB = { id: "legacy-card-b", type: "qa", docPath: "legacy-source-2.pdf", page: 1, front: "历史卡片 B",
    back: "旧答案 B", tags: [], links: [], createdAt: TIME };
  const set = { id: "legacy-set", name: "历史旧库学习集", docPaths: ["legacy-source.pdf", "legacy-source-2.pdf"],
    cardIds: [cardA.id, cardB.id], createdAt: TIME };
  const data = {
    schemaVersion: 3,
    revision: 41,
    writerId: "device-legacy-seed-0041",
    savedAt: "2026-10-28T09:15:00.000Z",
    settings: {},
    cards: [cardA, cardB],
    nodes: [],
    edges: [],
    srs: {
      [cardA.id]: { due: "2026-12-01", lastReviewed: "2026-11-25", interval: 6, reps: 1, ease: 2.5, state: 2 },
      [cardB.id]: { due: "2026-12-03", lastReviewed: "2026-11-27", interval: 6, reps: 1, ease: 2.5, state: 2 },
    },
    docMeta: {},
    reviewHistory: {},
    reviewLogs: [],
    practiceAttempts: [],
    reviewPending: [],
    cardTemplates: [],
    reviewDecks: [],
    studySets: [set],
    canvases: [],
    activeStudySetId: set.id,
    activeCanvasId: undefined,
    documents: [
      { id: "legacy-doc-a", path: "legacy-source.pdf", kind: "pdf", createdAt: TIME },
      { id: "legacy-doc-b", path: "legacy-source-2.pdf", kind: "pdf", createdAt: TIME },
    ],
    localEvents: [{ id: "local-event-legacy-1", at: "2026-10-28T09:15:00.000Z", kind: "saved", objectIds: [], detail: "本地数据已落盘。" }],
  };
  const mainFile = path.join(vault, setup.pluginRel, "data.json");
  const serialized = JSON.stringify(data, null, 2) + "\n";
  fs.writeFileSync(mainFile, serialized);
  const seed = { mainFile, sha256: sha256(fs.readFileSync(mainFile)), size: fs.statSync(mainFile).size,
    seededFiles: seeded, srsSeeded: data.srs, documentsSeeded: data.documents,
    documentsWithoutFingerprint: data.documents.filter(doc => !doc.sha256 || !Number.isSafeInteger(doc.byteSize)).map(doc => doc.path),
    bareDateFields: Object.entries(data.srs).flatMap(([id, state]) => ["due", "lastReviewed"].filter(k => /^\d{4}-\d{2}-\d{2}$/.test(state[k])).map(k => ({ id, field: k, value: state[k] }))) };
  jsonWrite(path.join(root, "legacy-seed.json"), seed);
  console.log(JSON.stringify(seed));
}
