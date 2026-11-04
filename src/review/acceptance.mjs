// Run: node src/review/acceptance.mjs. All fixtures are synthetic; no vault is read.
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { fsrs, generatorParameters } from "ts-fsrs";

const root = fileURLToPath(new URL("../", import.meta.url));
const temporary = await mkdtemp(path.join(tmpdir(), "marginstudy-review-"));
let passed = 0;
const test = (name, run) => { run(); passed++; process.stdout.write(`✓ ${name}\n`); };

function memoryHost(seed) {
  let main = structuredClone(seed);
  const content = new Map();
  const directories = new Set();
  const encoder = new TextEncoder(), decoder = new TextDecoder();
  const hooks = {};
  const adapter = {
    exists: async (name) => content.has(name) || directories.has(name),
    mkdir: async (name) => { directories.add(name); },
    read: async (name) => { if (!content.has(name)) throw new Error(`Missing ${name}`); return decoder.decode(content.get(name)); },
    write: async (name, text) => { if (hooks.write) await hooks.write(name, text); content.set(name, encoder.encode(text)); },
    readBinary: async (name) => { if (hooks.readBinary) await hooks.readBinary(name); if (!content.has(name)) throw new Error(`Missing ${name}`); return content.get(name).slice().buffer; },
    writeBinary: async (name, bytes) => { content.set(name, new Uint8Array(bytes).slice()); },
    remove: async (name) => { content.delete(name); },
    rename: async (from, to) => { if (!content.has(from)) throw new Error(`Missing ${from}`); content.set(to, content.get(from)); content.delete(from); },
  };
  return {
    hooks, adapter, content,
    readMain: () => structuredClone(main), replaceMain: (next) => { main = structuredClone(next); },
    text: (name, text) => { content.set(name, encoder.encode(text)); },
    host: { loadData: async () => structuredClone(main), saveData: async (next) => { if (hooks.saveMain) await hooks.saveMain(next); main = structuredClone(next); },
      app: { vault: { adapter, getFiles: () => [...content.keys()].map((name) => ({ path: name })) } } },
  };
}

try {
  const result = await build({
    stdin: { contents: ["srs", "review/questions", "review/content", "review/templates", "utils/markdown", "model/store", "model/conflicts"].map((name) => `export * from ${JSON.stringify(`./${name}.ts`)};`).join("\n"), resolveDir: root },
    platform: "node", format: "cjs", bundle: true, write: false,
    plugins: [{ name: "synthetic-obsidian", setup(builder) {
      builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "synthetic" }));
      builder.onLoad({ filter: /.*/, namespace: "synthetic" }, () => ({ contents: "export class Component {} export class App {} export class TFile {} export class Notice {} export const MarkdownRenderer = { render: async () => {} };", loader: "js" }));
    } }],
  });
  const bundle = path.join(temporary, "review.cjs"); await writeFile(bundle, result.outputFiles[0].contents);
  const review = createRequire(import.meta.url)(bundle);
  const now = new Date("2026-10-15T10:00:00+08:00");
  const upstream = fsrs(generatorParameters({ request_retention: 0.9, enable_fuzz: false, enable_short_term: true, learning_steps: ["1m", "10m"], relearning_steps: ["10m"] }));
  const initial = review.freshState(2.5, now);

  for (const [name, source] of [
    ["new", initial],
    ["learning", review.schedule(initial, 1, new Date(now.getTime() - 60_000))],
    ["review", review.normalizeState({ due: "2026-10-15", interval: 20, ease: 2.5, reps: 6, stability: 20, difficulty: 5, lapses: 1, state: 2, lastReviewed: "2026-09-25" }, 2.5, now)],
    ["relearning", review.normalizeState({ due: "2026-10-15", interval: 0, ease: 2.5, reps: 7, stability: 1, difficulty: 7, lapses: 2, state: 3, lastReviewed: "2026-10-15" }, 2.5, now)],
  ]) for (const grade of [1, 2, 3, 4]) test(`FSRS upstream agreement: ${name}, grade ${grade}`, () => {
    const before = structuredClone(source);
    const expected = upstream.next(review.toFsrsCard(source, now), now, grade).card;
    const actual = review.schedule(source, grade, now);
    assert.equal(actual.due, expected.due.toISOString());
    for (const field of ["stability", "difficulty", "reps", "lapses", "state"]) assert.equal(actual[field], expected[field], field);
    assert.equal(actual.learningSteps, expected.learning_steps);
    assert.equal(review.previewInterval(source, grade, now), actual.interval);
    assert.deepEqual(source, before, "preview/grading must not mutate input");
  });

  test("legacy SM-2 progress is preserved and gets a usable last review", () => {
    const state = review.normalizeState({ due: "2026-10-15", interval: 7, ease: 2.1, reps: 3 }, 2.5, now);
    assert.equal(state.reps, 3); assert.equal(state.interval, 7); assert.equal(state.ease, 2.1); assert.ok(state.lastReviewed);
    assert.equal(new Date(state.due).getHours(), 0, "date-only means local midnight");
    assert.ok(Number.isFinite(review.schedule(state, 3, now).stability));
  });
  test("minute-precision due times and invalid grade handling", () => {
    const after = review.schedule(initial, 1, now);
    assert.equal(new Date(after.due).getTime() - now.getTime(), 60_000);
    assert.equal(review.isDue(after, now), false); assert.equal(review.isDue(after, new Date(now.getTime() + 60_000)), true);
    assert.equal(review.intervalLabel(after.interval), "1 分钟");
    assert.throws(() => review.schedule(initial, 0, now));
  });
  test("overdue recall uses actual elapsed time", () => {
    const state = review.normalizeState({ due: "2026-10-01", interval: 10, ease: 2.5, reps: 5, stability: 10, difficulty: 5, state: 2, lastReviewed: "2026-09-21" }, 2.5, now);
    const onTime = review.schedule(state, 3, new Date("2026-10-01T10:00:00+08:00"));
    const late = review.schedule(state, 3, now);
    assert.notEqual(late.stability, onTime.stability);
  });
  const card = { id: "synthetic", docPath: "fixtures/book.pdf", type: "flashcard", front: "首都 {{c1::北京::城市}}，{{c2::中国}}；同题 {{c1::京}}", back: "补充答案不能提前泄露", tags: [], links: [], createdAt: "2026-10-15" };
  const questions = review.questionsForCard(card);
  test("each cN is one stable question, repeated c1 shares its state", () => {
    assert.deepEqual(questions.map((question) => question.id), ["synthetic::cloze:1", "synthetic::cloze:2"]);
    assert.equal(review.clozeForQuestion(card.front, 1), "首都 [城市]，中国；同题 [•••]");
    assert.equal(review.clozeForQuestion(card.front, 1, true), "首都 北京，中国；同题 京");
  });
  test("revealing cloze shows real answers; normal back remains hidden before reveal", () => {
    const prompt = review.questionText(card, questions[0], false);
    assert.ok(!prompt.includes("北京")); assert.ok(!prompt.includes(card.back));
    const answer = review.questionText(card, questions[0], true); assert.ok(answer.includes("北京")); assert.ok(answer.includes(card.back));
  });
  test("cloze preserves LaTeX braces and leaves malformed markers untouched", () => {
    const formula = "{{c1::\\frac{a}{b}}}";
    assert.equal(review.clozeForQuestion(formula, 1, true), "\\frac{a}{b}");
    assert.equal(review.clozeForQuestion("{{c1::未完成", 1, true), "{{c1::未完成");
    assert.equal(review.hasCloze("{{c0::无效索引}}"), false);
  });
  test("back-side cloze is also independently testable", () => {
    const backCard = { ...card, front: "回答", back: "{{c3::正确答案}}" };
    const question = review.questionsForCard(backCard)[0];
    assert.equal(question.clozeIndex, 3); assert.ok(!review.questionText(backCard, question, false).includes("正确答案"));
    assert.ok(review.questionText(backCard, question, true).includes("正确答案"));
  });
  test("image occlusions validate normalized geometry and get independent ids", () => {
    const imageCard = { ...card, front: "OCR 答案", back: "", image: "data:image/png;base64,fixture", occlusions: [
      { id: "a", x: 0.1, y: 0.2, width: 0.2, height: 0.3 }, { id: "b", x: 0.5, y: 0.1, width: 0.2, height: 0.3 },
      { id: "invalid", x: -1, y: 0, width: 2, height: 2 },
    ] };
    const result = review.questionsForCard(imageCard);
    assert.deepEqual(result.map((question) => question.id), ["synthetic::occlusion:a", "synthetic::occlusion:b"]);
    assert.ok(!review.questionText(imageCard, result[0], false).includes("OCR 答案"));
    assert.ok(review.questionText(imageCard, result[0], true).includes("OCR 答案"));
  });
  test("image occlusions on comment-attached images create independent review questions", () => {
    const imageCard = { ...card, front: "OCR 答案", back: "", commentMedia: [{ id: "image-1", kind: "image", image: "data:image/png;base64,fixture" }], occlusions: [
      { id: "mask-1", x: 0.1, y: 0.2, width: 0.2, height: 0.3 },
    ] };
    const result = review.questionsForCard(imageCard);
    assert.deepEqual(result.map((question) => question.kind), ["occlusion"]);
    assert.equal(result[0].maskId, "mask-1");
  });
  test("Again returns in the same session at its real FSRS due time, with undo", () => {
    const session = new review.ReviewSession(questions);
    const next = review.schedule(initial, 1, now);
    session.grade(questions[0], next, "log-1", now.getTime());
    assert.equal(session.current(now.getTime()).id, questions[1].id);
    session.grade(questions[1], { ...next, state: 2 }, "log-2", now.getTime());
    assert.equal(session.current(now.getTime()), undefined); assert.equal(session.remaining, 1);
    assert.equal(session.current(now.getTime() + 60_000).id, questions[0].id);
    session.undo(); assert.equal(session.current(now.getTime()).id, questions[1].id); assert.equal(session.answered, 1);
    session.undo(); assert.equal(session.current(now.getTime()).id, questions[0].id); assert.equal(session.answered, 0);
  });
  test("wrong question history ignores undone reviews and is independent of due", () => {
    const logs = [{ questionId: questions[0].id, rating: 1 }, { questionId: questions[0].id, rating: 3, undoneAt: now.toISOString() }];
    assert.equal(review.questionWasWrong({ ...card, wrong: false }, questions[0], logs), true);
    assert.equal(review.questionWasWrong({ ...card, wrong: false }, questions[1], logs), false);
  });
  test("multi-source images are retained and deduplicated", () => {
    assert.deepEqual(review.cardImages({ ...card, image: "one", images: ["one", "two"], sources: [{ docPath: "another.pdf", image: "three" }] }), ["one", "two", "three"]);
  });
  test("saved text templates expand fields and keep cloze syntax intact", () => {
    assert.deepEqual(review.applyTemplate({ id: "t", name: "test", front: "{{source}}: {{front}} {{c1::答案}}", back: "{{back}}" }, { front: "题干", back: "答案", docPath: "book.pdf" }, now), { front: "book.pdf: 题干 {{c1::答案}}", back: "答案" });
  });
  // Exercise the same Store seam used by the UI, with an in-memory disk adapter.
  let disk = { cards: [structuredClone(card)], srs: { [card.id]: initial }, nodes: [], edges: [] };
  const files = new Map();
  const host = { loadData: async () => structuredClone(disk), saveData: async (data) => { disk = structuredClone(data); },
    app: { vault: { adapter: { exists: async (name) => files.has(name), mkdir: async (name) => files.set(name, ""), write: async (name, data) => files.set(name, data), read: async (name) => files.get(name) }, getFiles: () => [] } } };
  const store = new review.Store(host); await store.load();
  store.gradeCard(card.id, 1, { questionId: questions[0].id, elapsedMs: 1200, now });
  store.gradeCard(card.id, 4, { questionId: questions[1].id, elapsedMs: 800, now });
  test("Store grading isolates cN states, appends complete logs and retains sibling wrong flag", () => {
    assert.equal(store.getReviewState(card.id, questions[0].id).reps, 1);
    assert.equal(store.getReviewState(card.id, questions[1].id).reps, 1);
    assert.equal(store.srs[card.id].reps, 0);
    assert.equal(store.reviewLogs.length, 2); assert.equal(store.reviewLogs[0].questionId, questions[0].id);
    assert.equal(store.reviewLogs[0].elapsedMs, 1200); assert.ok(store.reviewLogs[0].before); assert.ok(store.reviewLogs[0].after);
    assert.equal(store.getCard(card.id).wrong, true);
  });
  store.undoLastReview();
  test("Store undo restores prior state and daily counts without deleting audit evidence", () => {
    assert.equal(store.getReviewState(card.id, questions[1].id).reps, 0);
    assert.equal(store.reviewLogs.filter((log) => !log.undoneAt).length, 1);
    assert.equal(store.reviewHistory[review.fmtDate(now)], 1);
  });
  store.upsertCardTemplate({ id: "persisted-template", name: "可保存", front: "{{front}}", back: "{{back}}" });
  await store.flush();
  const reloaded = new review.Store(host); await reloaded.load();
  test("question schedules, templates, audit history and undo survive a save/reload", () => {
    assert.equal(reloaded.getReviewState(card.id, questions[0].id).reps, 1);
    assert.equal(reloaded.getReviewState(card.id, questions[1].id).reps, 0);
    assert.equal(reloaded.reviewLogs.length, 2); assert.ok(reloaded.reviewLogs[1].undoneAt);
    assert.equal(reloaded.cardTemplates[0].id, "persisted-template");
    reloaded.undoLastReview(); assert.equal(reloaded.getReviewState(card.id, questions[0].id).reps, 0);
  });
  await reloaded.flush();

  // Conflict fixtures exercise the pure merge interface, without Store's repair step.
  const mergeState = JSON.parse(JSON.stringify(initial));
  const emptyData = () => ({ settings: {}, cards: [], nodes: [], edges: [], srs: {} });
  const node = (id, patch = {}) => ({ id, title: id, parentId: null, collapsed: false, x: 0, y: 0, ...patch });
  const first = { ...card, id: "a", front: "local A", links: ["b"], templateId: "t" };
  const second = { ...card, id: "b", front: "B", links: ["a"] };
  const log = (id, patch = {}) => ({ id, cardId: "a", questionId: "a::cloze:1", rating: 3, reviewedAt: now.toISOString(), elapsedMs: 1000, before: mergeState, after: mergeState, previousWrong: false, algorithm: "FSRS-6", ...patch });
  const day = review.fmtDate(now);
  const local = {
    ...emptyData(), cards: [first, second],
    cardTemplates: [{ id: "t", name: "local template", front: "local front" }],
    studySets: [{ id: "s", name: "same set", docPaths: [card.docPath], cardIds: ["a", "b"], createdAt: card.createdAt }],
    canvases: [{ id: "v", studySetId: "s", name: "same canvas", createdAt: card.createdAt }],
    nodes: [node("parent", { cardId: "a", canvasId: "v" }), node("child", { parentId: "parent", cardId: "b", canvasId: "v" }), node("reference", { reference: true, sourceNodeId: "child", canvasId: "v" })],
    edges: [{ from: "parent", to: "child", label: "local link" }],
    srs: { a: mergeState, "a::cloze:1": mergeState, "a::occlusion:m": mergeState, "a::merged:b::cloze:2": mergeState, b: mergeState },
    documents: [{ id: "document", path: card.docPath, kind: "pdf", sourceUrl: "https://local.invalid", createdAt: card.createdAt }],
    reviewLogs: [log("shared"), log("local-only"), log("log-conflict")], reviewHistory: { [day]: 7 },
    settings: { theme: "dark", tagColors: { local: "red" } }, docMeta: { "same.pdf": { brightness: 1 } },
  };
  const remote = structuredClone(local);
  remote.cards[0].front = "remote A";
  remote.cardTemplates[0].front = "remote template front";
  remote.documents[0].sourceUrl = "https://remote.invalid";
  remote.edges[0].label = "remote link";
  remote.srs.a = { ...mergeState, reps: 8 };
  remote.srs["a::cloze:1"] = { ...mergeState, reps: 9 };
  remote.reviewLogs = [log("shared"), log("remote-only"), log("log-conflict", { elapsedMs: 2500 })];
  remote.settings = { theme: "light", tagColors: { remote: "blue" } };
  remote.docMeta = { "same.pdf": { brightness: 0.5 }, "remote.pdf": { bookmarks: [2] } };
  remote.activeStudySetId = "s"; remote.activeCanvasId = "v";
  remote.cards[0].mergedCards = structuredClone([first, second]);
  remote.cards[0].mergedReviewStates = { a: mergeState, "b::cloze:2": mergeState };
  remote.cards[0].mergeArchive = { nodes: structuredClone(remote.nodes), edges: structuredClone(remote.edges), memberships: [{ studySetId: "s", cardIds: ["a", "b"] }] };
  const localBefore = structuredClone(local), remoteBefore = structuredClone(remote);
  const merged = review.mergePreservingVersions(local, remote);
  const remoteA = merged.cards.find((entry) => entry.front === "remote A");
  const remoteB = merged.cards.find((entry) => entry.id !== "b" && entry.front === "B");
  const remoteSet = merged.studySets.find((entry) => entry.id !== "s");
  const remoteCanvas = merged.canvases.find((entry) => entry.id !== "v");
  test("conflict merge never mutates its inputs and retains the local graph", () => {
    assert.deepEqual(local, localBefore); assert.deepEqual(remote, remoteBefore);
    assert.deepEqual(merged.cards.slice(0, local.cards.length), local.cards);
    assert.deepEqual(merged.nodes.slice(0, local.nodes.length), local.nodes);
    assert.deepEqual(merged.srs.a, mergeState);
  });
  test("conflict merge propagates card links and template identities", () => {
    assert.ok(remoteA && remoteB); assert.notEqual(remoteA.id, "a");
    assert.deepEqual(remoteA.links, [remoteB.id]); assert.deepEqual(remoteB.links, [remoteA.id]);
    assert.equal(merged.cardTemplates.find((entry) => entry.id === remoteA.templateId).front, "remote template front");
    assert.equal(merged.documents.filter((entry) => entry.path === card.docPath).length, 2);
  });
  test("raw-equal study sets and canvases retain a separate coherent remote graph", () => {
    assert.ok(remoteSet && remoteCanvas);
    assert.deepEqual(remoteSet.cardIds, [remoteA.id, remoteB.id]);
    assert.equal(remoteCanvas.studySetId, remoteSet.id);
    assert.equal(merged.activeStudySetId, remoteSet.id); assert.equal(merged.activeCanvasId, remoteCanvas.id);
  });
  test("conflict merge maps parents, source nodes and edges without crossing graph versions", () => {
    const parent = merged.nodes.find((entry) => entry.cardId === remoteA.id);
    const child = merged.nodes.find((entry) => entry.cardId === remoteB.id);
    const reference = merged.nodes.find((entry) => entry.sourceNodeId === child.id);
    assert.equal(child.parentId, parent.id); assert.equal(parent.canvasId, remoteCanvas.id);
    assert.equal(reference.canvasId, remoteCanvas.id);
    assert.ok(merged.edges.some((edge) => edge.from === parent.id && edge.to === child.id && edge.label === "remote link"));
    assert.ok(merged.edges.some((edge) => edge.from === "parent" && edge.to === "child" && edge.label === "local link"));
  });
  test("conflict schedules and logs remap basic, cloze, mask and nested merged question IDs", () => {
    assert.equal(merged.srs[remoteA.id].reps, 8);
    assert.equal(merged.srs[remoteA.id + "::cloze:1"].reps, 9);
    assert.deepEqual(merged.srs[remoteA.id + "::occlusion:m"], mergeState);
    assert.deepEqual(merged.srs[remoteA.id + "::merged:" + remoteB.id + "::cloze:2"], mergeState);
    const remoteLog = merged.reviewLogs.find((entry) => entry.id === "remote-only");
    assert.equal(remoteLog.cardId, remoteA.id); assert.equal(remoteLog.questionId, remoteA.id + "::cloze:1");
    assert.equal(merged.reviewLogs.filter((entry) => review.reviewEventId(entry) === "shared").length, 2, "each card version retains its historical reference");
    assert.equal(review.effectiveReviewCounts(merged.reviewLogs)[day], 4, "a copied event counts only once");
    assert.equal(merged.reviewHistory[day], 8, "four legacy reviews plus four distinct logged events");
  });
  test("conflict copies retain coherent unmerge snapshots and memberships", () => {
    assert.deepEqual(remoteA.mergedCards.map((entry) => entry.id), [remoteA.id, remoteB.id]);
    assert.deepEqual(remoteA.mergedReviewStates[remoteB.id + "::cloze:2"], mergeState);
    const parent = remoteA.mergeArchive.nodes.find((entry) => entry.cardId === remoteA.id);
    const child = remoteA.mergeArchive.nodes.find((entry) => entry.cardId === remoteB.id);
    assert.equal(child.parentId, parent.id); assert.equal(child.canvasId, remoteCanvas.id);
    assert.deepEqual(remoteA.mergeArchive.memberships[0], { studySetId: remoteSet.id, cardIds: [remoteA.id, remoteB.id] });
    assert.ok(remoteA.mergeArchive.edges.some((edge) => edge.from === parent.id && edge.to === child.id));
  });
  test("conflict merge uses local settings/metadata and preserves remote-only keys", () => {
    assert.equal(merged.settings.theme, "dark"); assert.deepEqual(merged.settings.tagColors, { local: "red", remote: "blue" });
    assert.deepEqual(merged.docMeta["same.pdf"], local.docMeta["same.pdf"]);
    assert.deepEqual(merged.docMeta["remote.pdf"], remote.docMeta["remote.pdf"]);
  });
  test("equal-content cards with divergent schedules retain both scheduling versions", () => {
    const a = { ...emptyData(), cards: [structuredClone(first)], srs: { a: mergeState } };
    const b = { ...structuredClone(a), srs: { a: { ...mergeState, reps: 12 } } };
    const result = review.mergePreservingVersions(a, b), copied = result.cards.find((entry) => entry.id !== "a");
    assert.equal(result.cards.length, 2); assert.equal(result.srs.a.reps, 0); assert.equal(result.srs[copied.id].reps, 12);
  });
  test("a withdrawn review cannot be resurrected by merging an older event copy", () => {
    const a = { ...emptyData(), reviewLogs: [log("withdrawn")], reviewHistory: { [day]: 1 } };
    const b = { ...emptyData(), reviewLogs: [log("withdrawn", { undoneAt: now.toISOString() })], reviewHistory: { [day]: 0 } };
    const result = review.mergePreservingVersions(a, b);
    assert.equal(result.reviewLogs.length, 2); assert.ok(result.reviewLogs.every((entry) => entry.undoneAt));
    assert.equal(result.reviewHistory[day], 0); assert.deepEqual(review.effectiveReviewCounts(result.reviewLogs), {});
  });
  test("identical shared logs and legacy daily counts are not doubled", () => {
    const a = { ...emptyData(), reviewLogs: [log("old-event")], reviewHistory: { [day]: 6 } };
    const result = review.mergePreservingVersions(a, structuredClone(a));
    assert.equal(result.reviewLogs.length, 1); assert.equal(result.reviewHistory[day], 6);
    assert.deepEqual(review.effectiveReviewCounts([log("invalid", { rating: 9 }), log("invalid-date", { reviewedAt: "bad" })]), {});
  });
  test("different labels on otherwise identical endpoints remain recoverable", () => {
    const result = review.mergePreservingVersions({ ...emptyData(), edges: [{ from: "x", to: "y", label: "local" }] }, { ...emptyData(), edges: [{ from: "x", to: "y", label: "remote" }] });
    assert.deepEqual(result.edges.map((edge) => edge.label), ["local", "remote"]);
  });
  process.stdout.write(`\n${passed} review acceptance checks passed.\n`);

  if (process.argv.includes("--audit")) {
    let failures = 0;
    const stores = [];
    const audit = async (name, run) => {
      try { await run(); process.stdout.write(`✓ audit: ${name}\n`); }
      catch (error) { failures++; process.stdout.write(`ISSUE: ${name}\n  ${error.message}\n`); }
    };
    const makeStore = async (seed = { cards: [structuredClone(card)], srs: { [card.id]: initial }, nodes: [], edges: [] }) => {
      const memory = memoryHost(seed), store = new review.Store(memory.host); await store.load(); stores.push(store); return { store, memory };
    };
    const realError = console.error; console.error = () => {};
    try {
      await audit("an empty first launch can save when the host returns undefined", async () => {
        const memory = memoryHost(undefined), store = new review.Store(memory.host); stores.push(store);
        await store.load(); assert.equal(store.cards.length, 0);
        store.save(); await store.flush(); assert.equal(memory.readMain().schemaVersion, 2);
      });
      await audit("await flush must include an edit arriving during its main write", async () => {
        const { store, memory } = await makeStore();
        let release, entered;
        const atWrite = new Promise((resolve) => { entered = resolve; });
        const gate = new Promise((resolve) => { release = resolve; });
        let first = true;
        memory.hooks.saveMain = async () => { if (first) { first = false; entered(); await gate; } };
        store.updateCard(card.id, { front: "first version" });
        const flushing = store.flush(); await atWrite;
        store.updateCard(card.id, { front: "last edit while saving" });
        release(); await flushing;
        assert.equal(memory.readMain().cards[0].front, "last edit while saving");
      });
      await audit("undo a library edit must not erase a later review log or schedule", async () => {
        const { store } = await makeStore();
        store.updateCard(card.id, { color: "#abcdef" });
        store.gradeCard(card.id, 3, { questionId: questions[0].id, now });
        store.undoLibraryChange();
        assert.equal(store.reviewLogs.length, 1, "a later review log disappeared when undoing card color");
        assert.equal(store.getReviewState(card.id, questions[0].id).reps, 1);
      });
      await audit("main conflict merge must preserve the remote card's node and schedule relationship", async () => {
        const localCard = { ...card, front: "local content" };
        const { store, memory } = await makeStore({ cards: [localCard], nodes: [], edges: [], srs: { [card.id]: initial } });
        store.updateCard(card.id, { front: "local edited content" });
        const remoteState = { ...initial, reps: 99, interval: 99 };
        memory.replaceMain({ cards: [{ ...card, front: "remote content" }], nodes: [{ id: "remote-node", parentId: null, title: "remote node", cardId: card.id, collapsed: false, x: 0, y: 0 }], edges: [], srs: { [card.id]: remoteState } });
        await assert.rejects(store.flush());
        await store.resolveDataConflict("merge");
        const remoteCard = store.cards.find((candidate) => candidate.front === "remote content");
        assert.ok(remoteCard); assert.equal(store.getNode("remote-node").cardId, remoteCard.id, "remote node now points at the local card");
        assert.equal(store.getReviewState(remoteCard.id).reps, 99, "remote card lost its own schedule");
      });
      await audit("undo after conflict merge must withdraw a shared event and restore both card versions", async () => {
        const { store, memory } = await makeStore();
        store.gradeCard(card.id, 3, { questionId: questions[0].id, now }); await store.flush();
        const remote = memory.readMain(); remote.cards[0].front = "remote {{c1::answer}}";
        store.updateCard(card.id, { front: "local {{c1::answer}}" }); memory.replaceMain(remote);
        await assert.rejects(store.flush()); await store.resolveDataConflict("merge");
        assert.equal(store.reviewHistory[day], 1, "one shared event was counted twice after merge");
        assert.equal(store.reviewLogs.filter((log) => !log.undoneAt).length, 2, "both card versions need their history references");
        store.undoLastReview();
        assert.equal(store.reviewLogs.filter((log) => !log.undoneAt).length, 0, "a second active copy resurrects an undone review");
        assert.equal(store.reviewHistory[day], 0);
        for (const version of store.cards) assert.equal(store.getReviewState(version.id, version.id + "::cloze:1").reps, 0, "a retained card version still has the withdrawn schedule");
      });
      await audit("undo chooses the latest review time after conflict log order changes", async () => {
        const { store } = await makeStore();
        store.gradeCard(card.id, 3, { questionId: questions[0].id, now });
        store.gradeCard(card.id, 4, { questionId: questions[1].id, now: new Date(now.getTime() + 60_000) });
        const latest = store.reviewLogs[1].id; store.reviewLogs.reverse();
        assert.equal(store.undoLastReview().id, latest);
        assert.equal(store.getReviewState(card.id, questions[0].id).reps, 1);
        assert.equal(store.getReviewState(card.id, questions[1].id).reps, 0);
      });
      await audit("unmerge after reload must restore each original node reference and review undo target", async () => {
        const second = { ...card, id: "second", front: "second front" };
        const { store, memory } = await makeStore({ cards: [structuredClone(card), second], nodes: [
          { id: "first-node", parentId: null, title: "first", cardId: card.id, collapsed: false, x: 0, y: 0 },
          { id: "second-node", parentId: null, title: "second", cardId: second.id, collapsed: false, x: 100, y: 0 },
        ], edges: [], srs: { [card.id]: initial, [second.id]: initial } });
        store.gradeCard(second.id, 3, { now }); store.mergeCards(card.id, [second.id]); await store.flush();
        const afterReload = new review.Store(memory.host); await afterReload.load(); stores.push(afterReload);
        afterReload.unmergeCard(card.id);
        assert.equal(afterReload.getNode("second-node").cardId, second.id, "the second node remains attached to the first card");
        afterReload.undoLastReview(); assert.equal(afterReload.getReviewState(second.id).reps, 0);
      });
      await audit("a second backup must not recursively include older backup sidecars", async () => {
        const { store, memory } = await makeStore();
        const annotation = { id: "a", docPath: card.docPath, docKind: "pdf", page: 1, type: "highlight", rects: [], text: "original", color: "#ffd54f", createdAt: "2026-10-15" };
        memory.text(card.docPath, "synthetic PDF bytes");
        memory.text(`${card.docPath}.mstudy.json`, JSON.stringify({ annotations: [annotation] }));
        assert.ok(await store.backupData(true)); const second = await store.backupData(true); assert.ok(second);
        const manifest = JSON.parse(await memory.adapter.read(second));
        assert.ok(!manifest.files.some((file) => file.path.startsWith("MarginStudyBackups/")), "backup includes an older backup's sidecar, which restore explicitly rejects");
        await store.restoreBackup(second);
      });
      await audit("a failed restore must roll back cleanly and permit a later normal flush", async () => {
        const { store, memory } = await makeStore();
        const annotation = { id: "a", docPath: card.docPath, docKind: "pdf", page: 1, type: "highlight", rects: [], text: "original", color: "#ffd54f", createdAt: "2026-10-15" };
        memory.text(card.docPath, "synthetic PDF bytes"); memory.text(`${card.docPath}.mstudy.json`, JSON.stringify({ annotations: [annotation] }));
        const backup = await store.backupData(true); const annotations = await store.loadAnnotations(card.docPath);
        annotations[0].text = "current before restore"; store.saveAnnotationsDebounced(card.docPath, annotations); await store.flush();
        store.updateCard(card.id, { front: "current before restore" }); await store.flush();
        let once = true; memory.hooks.saveMain = async () => { if (once) { once = false; throw new Error("simulated disk failure"); } };
        await assert.rejects(store.restoreBackup(backup));
        assert.equal(store.getCard(card.id).front, "current before restore");
        assert.equal((await store.loadAnnotations(card.docPath))[0].text, "current before restore");
        await store.flush();
      });
      await audit("external sidecar conflict must provide a recovery route without blocking backup restore", async () => {
        const { store, memory } = await makeStore();
        const annotation = { id: "a", docPath: card.docPath, docKind: "pdf", page: 1, type: "highlight", rects: [], text: "original", color: "#ffd54f", createdAt: "2026-10-15" };
        memory.text(card.docPath, "synthetic PDF bytes");
        memory.text(`${card.docPath}.mstudy.json`, JSON.stringify({ annotations: [annotation] }));
        const backup = await store.backupData(true); assert.ok(backup);
        const annotations = await store.loadAnnotations(card.docPath);
        memory.text(`${card.docPath}.mstudy.json`, JSON.stringify({ annotations: [{ ...annotation, text: "external content" }] }));
        annotations[0].text = "local content"; store.saveAnnotationsDebounced(card.docPath, annotations);
        await assert.rejects(store.flush());
        await store.restoreBackup(backup);
        assert.equal((await store.loadAnnotations(card.docPath))[0].text, "original");
      });
    } finally {
      console.error = realError;
      for (const store of stores) if (store.saveTimer !== null) clearTimeout(store.saveTimer);
    }
    process.stdout.write(`\n${failures} persistence audit issue(s).\n`);
    if (failures) process.exitCode = 1;
  }
} finally { await rm(temporary, { recursive: true, force: true }); }
