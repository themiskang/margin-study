// Card A · A3 re-do fixtures.
//   node a3r-fixture.mjs <root>
// Writes <root>/a3r-legacy-import.zip: three source documents + a full object graph,
// with legacy date-only schedules and no source fingerprints in the payload.
import fs from "node:fs";
import path from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { strToU8, zipSync } from "fflate";
import { jsonWrite, sha256 } from "./lib.mjs";

const root = path.resolve(process.argv[2]);
fs.mkdirSync(root, { recursive: true });
const TIME = "2026-10-28T09:15:00.000Z";

async function pdf(label, pages) {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let page = 1; page <= pages; page++) doc.addPage([300, 400]).drawText(`${label} page ${page}`, { x: 24, y: 340, font, size: 12 });
  return doc.save();
}

const DOC1 = "a3-old-01.pdf";
const DOC2 = "a3-old-02.pdf";
const DOC3 = "a3-old-03.msref";

const source1 = await pdf("A3 legacy source one", 2);
const source2 = await pdf("A3 legacy source two", 1);
const source3 = strToU8(JSON.stringify({ format: "marginstudy-page-collection", version: 1,
  pages: [{ sourcePath: DOC1, page: 1 }, { sourcePath: DOC1, page: 2 }] }));

const cards = [
  { id: "a3-card-1", type: "qa", docPath: DOC1, page: 1, front: "旧库历史卡片一", back: "旧答案一",
    tags: ["历史"], links: ["a3-card-2"], createdAt: TIME },
  { id: "a3-card-2", type: "qa", docPath: DOC2, page: 1, front: "旧库历史卡片二", back: "旧答案二",
    tags: [], links: [], createdAt: TIME },
  { id: "a3-card-3", type: "excerpt", docPath: DOC3, page: 1, anchorAnnId: "a3-ann-3", front: "旧库摘录卡片三",
    back: "旧摘录答案三", tags: ["历史"], links: [], createdAt: TIME },
];
const set = { id: "a3-set", name: "A3 真实旧库学习集", docPaths: [DOC1, DOC2, DOC3],
  cardIds: cards.map(card => card.id), createdAt: TIME };
const canvas = { id: "a3-canvas", studySetId: set.id, name: "A3 主脑图", createdAt: TIME };
const nodes = [
  { id: "a3-node-1", cardId: "a3-card-1", canvasId: canvas.id, title: "旧库历史卡片一", x: 40, y: 60, docPath: DOC1 },
  { id: "a3-node-2", cardId: "a3-card-2", canvasId: canvas.id, title: "旧库历史卡片二", x: 40, y: 200, parentId: "a3-node-1", docPath: DOC2 },
  { id: "a3-node-3", cardId: "a3-card-3", canvasId: canvas.id, title: "旧库摘录卡片三", x: 320, y: 130, parentId: "a3-node-1", docPath: DOC3 },
];
const edges = [{ id: "a3-edge-1", from: "a3-node-1", to: "a3-node-3", label: ["旧库关联"] }];
const annotations = {
  [DOC1]: [{ id: "a3-ann-1", docPath: DOC1, cardId: "a3-card-1", type: "highlight", page: 1, text: "旧库标注一",
    rects: [{ x: 20, y: 300, w: 120, h: 16 }], createdAt: TIME }],
  [DOC3]: [{ id: "a3-ann-3", docPath: DOC3, cardId: "a3-card-3", type: "highlight", page: 1, text: "旧库标注三",
    rects: [], createdAt: TIME }],
};
const documents = [
  { id: "a3-doc-1", path: DOC1, kind: "pdf", createdAt: TIME },
  { id: "a3-doc-2", path: DOC2, kind: "pdf", createdAt: TIME },
  { id: "a3-doc-3", path: DOC3, kind: "msref", createdAt: TIME },
];
// Legacy schedules are date-only on purpose; the old import path stores them as-is.
const srs = {
  "a3-card-1": { due: "2026-12-01", lastReviewed: "2026-11-25", interval: 6, reps: 1, ease: 2.5, state: 2 },
  "a3-card-2": { due: "2026-12-03", lastReviewed: "2026-11-27", interval: 6, reps: 1, ease: 2.5, state: 2 },
  "a3-card-3": { due: "2026-12-06", lastReviewed: "2026-11-29", interval: 7, reps: 2, ease: 2.4, state: 2 },
};
const docMeta = { [DOC1]: { bookmarks: [1], foldedPages: [2], scale: 1.5 } };

const payload = {
  format: "marginstudy-study-set", version: 1,
  cards, nodes, edges, studySets: [set], canvases: [canvas], documents, srs, annotations, docMeta,
  reviewDecks: [], reviewLogs: [], reviewPending: [], cardTemplates: [],
};

const files = {
  [`documents/${DOC1}`]: source1,
  [`documents/${DOC2}`]: source2,
  [`documents/${DOC3}`]: source3,
  "studyset.json": strToU8(JSON.stringify(payload)),
};
files["MANIFEST.json"] = strToU8(JSON.stringify({ format: "marginstudy-study-set-manifest", version: 1,
  studySetId: set.id, createdAt: TIME,
  files: Object.entries(files).map(([filePath, bytes]) => ({ path: filePath, bytes: bytes.length, sha256: sha256(bytes) })) }));

const archive = zipSync(files, { mtime: new Date(TIME) });
const out = path.join(root, "a3r-legacy-import.zip");
fs.writeFileSync(out, archive);

const report = {
  archive: out,
  archiveSha256: sha256(archive),
  archiveSize: archive.length,
  entries: Object.fromEntries(Object.entries(files).map(([filePath, bytes]) => [filePath, { sha256: sha256(bytes), bytes: bytes.length }])),
  payload,
  sourceDocuments: { [DOC1]: { sha256: sha256(source1), size: source1.length, pages: 2 },
    [DOC2]: { sha256: sha256(source2), size: source2.length, pages: 1 },
    [DOC3]: { sha256: sha256(source3), size: source3.length, kind: "page-collection" } },
  legacyTraits: {
    documentsWithoutFingerprint: 3,
    bareDateFields: Object.entries(srs).flatMap(([id, state]) => ["due", "lastReviewed"]
      .filter(field => /^\d{4}-\d{2}-\d{2}$/.test(state[field])).map(field => ({ id, field, value: state[field] }))),
  },
  time: TIME,
};
jsonWrite(path.join(root, "a3r-fixture.json"), report);
console.log(JSON.stringify({ archive: out, archiveSha256: report.archiveSha256, archiveSize: report.archiveSize,
  entries: Object.keys(report.entries), bareDateFields: report.legacyTraits.bareDateFields.length }, null, 2));