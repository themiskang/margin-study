// Synthetic storage only. Run: node src/review/pending-acceptance.mjs
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { build } from "esbuild";

const source = fileURLToPath(new URL("../", import.meta.url));
const temporary = await mkdtemp(path.join(tmpdir(), "marginstudy-pending-"));
const stores = [];
let passed = 0, failures = 0;
async function test(name, run) {
  try { await run(); passed++; process.stdout.write(`✓ ${name}\n`); }
  catch (error) { failures++; process.stdout.write(`FAIL: ${name}\n${error.stack}\n`); }
}

try {
  const result = await build({
    stdin: { contents: ["srs", "review/questions", "review/reviewView", "model/store", "model/conflicts"].map(name => `export * from ${JSON.stringify(`./${name}.ts`)};`).join("\n"), resolveDir: source },
    platform: "node", format: "cjs", bundle: true, write: false,
    plugins: [{ name: "memory-obsidian", setup(builder) {
      builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "memory" }));
      builder.onLoad({ filter: /.*/, namespace: "memory" }, () => ({ contents: "export class Component {} export class App {} export class TFile {} export class Notice {} export const MarkdownRenderer = { render: async () => {} };", loader: "js" }));
    } }],
  });
  const bundle = path.join(temporary, "pending.cjs"); await writeFile(bundle, result.outputFiles[0].contents);
  const api = createRequire(import.meta.url)(bundle);
  const now = new Date("2020-01-02T03:04:05.000Z"), later = new Date(now.getTime() + 60_000), day = api.fmtDate(now);
  const card = { id: "card", type: "flashcard", docPath: "fixture.pdf", front: "Question", back: "Answer", tags: [], links: [], createdAt: now.toISOString() };
  const state = api.freshState(2.5, now);
  const log = (id, patch = {}) => ({ id, cardId: card.id, questionId: card.id, rating: 3, reviewedAt: now.toISOString(), elapsedMs: 1000, before: state, after: state, previousWrong: false, algorithm: "independent-fixture", ...patch });
  const seed = (patch = {}) => ({ cards: [structuredClone(card)], nodes: [], edges: [], srs: {}, reviewPending: [],
    studySets: [{ id: "study", name: "Study", docPaths: [], cardIds: [card.id], createdAt: now.toISOString() }],
    canvases: ["a", "b"].map(id => ({ id, studySetId: "study", name: id, createdAt: now.toISOString() })), activeStudySetId: "study", activeCanvasId: "a", ...patch });
  const fresh = async (patch = {}) => {
    let disk = structuredClone(seed(patch));
    const files = new Map(), encoder = new TextEncoder(), decoder = new TextDecoder();
    const adapter = { exists: async name => files.has(name), mkdir: async name => files.set(name, new Uint8Array()),
      write: async (name, value) => files.set(name, encoder.encode(value)), read: async name => decoder.decode(files.get(name)),
      writeBinary: async (name, value) => files.set(name, new Uint8Array(value).slice()), readBinary: async name => files.get(name).slice().buffer,
      remove: async name => files.delete(name), rename: async (from, to) => { files.set(to, files.get(from)); files.delete(from); } };
    const host = { loadData: async () => structuredClone(disk), saveData: async value => { disk = structuredClone(value); }, app: { vault: { adapter, getFiles: () => [] } } };
    const store = new api.Store(host); await store.load(); stores.push(store);
    return { store, host, disk: () => structuredClone(disk) };
  };
  const activePending = store => store.reviewPending.filter(item => item.visited !== true);

  await test("scoped basic/cloze/mask identities are stable, while unscoped IDs remain compatible", () => {
    assert.equal(api.questionsForCard(card)[0].id, "card");
    assert.equal(api.questionsForCard(card, "a")[0].id, "card::scope:a::basic");
    const composite = { ...card, front: "{{c1::one}} {{c2::two}}", image: "fixture", occlusions: [{ id: "mask", x: 0, y: 0, width: 0.5, height: 0.5 }] };
    assert.deepEqual(api.questionsForCard(composite, "b").map(item => [item.id, item.scopeId]), [
      ["card::scope:b::cloze:1", "b"], ["card::scope:b::cloze:2", "b"], ["card::scope:b::occlusion:mask", "b"],
    ]);
    assert.deepEqual(api.questionsForCard(composite).map(item => item.id), ["card::cloze:1", "card::cloze:2", "card::occlusion:mask"]);
  });
  await test("plain text cloze and cN extensions keep separate question identities", () => {
    const result = api.questionsForCard({ ...card, front: "{{plain answer}} and {{c1::another}}" }, "a");
    assert.deepEqual(result.map(item => item.id), ["card::scope:a::cloze:0", "card::scope:a::cloze:1"]);
  });
  await test("normal review selects only enrolled due questions in the requested canvas", () => {
    const a = api.questionsForCard(card, "a")[0], b = api.questionsForCard(card, "b")[0];
    const fake = { store: { activeCanvasId: "a", canvases: [], reviewLogs: [], cardsForStudySet: () => [card], pendingQuestions: scope => scope === "a" ? [a] : [b], getReviewState: () => state } };
    assert.deepEqual(api.questionsForReview(fake).map(item => item.id), [a.id]);
    assert.deepEqual(api.questionsForReview(fake, { scopeId: "b" }).map(item => item.id), [b.id]);
    assert.deepEqual(api.questionsForReview(fake, { cardIds: [] }), []);
    fake.store.pendingQuestions = () => []; assert.deepEqual(api.questionsForReview(fake), [], "fresh scheduling state alone does not enroll a card");
    fake.store.pendingQuestions = () => [a]; fake.store.getReviewState = () => ({ ...state, due: "2999-01-01T00:00:00.000Z" });
    assert.deepEqual(api.questionsForReview(fake), [], "future pending must remain outside normal due review");
  });
  await test("an explicit canvas selects its owning study set instead of the currently active set", async () => {
    const other = { ...card, id: "other-set-card", docPath: "other.pdf" };
    const { store } = await fresh({ cards: [card, other],
      studySets: [
        { id: "study", name: "Active", docPaths: [], cardIds: [card.id], createdAt: now.toISOString() },
        { id: "other-set", name: "Other", docPaths: [], cardIds: [other.id], createdAt: now.toISOString() },
      ], canvases: [
        { id: "a", studySetId: "study", name: "a", createdAt: now.toISOString() },
        { id: "b", studySetId: "other-set", name: "b", createdAt: now.toISOString() },
      ] });
    store.enqueueReview([card.id], "a", now); store.enqueueReview([other.id], "b", now);
    assert.deepEqual(api.questionsForReview({ store }).map(item => item.cardId), [card.id]);
    assert.deepEqual(api.questionsForReview({ store }, { scopeId: "b" }).map(item => item.cardId), [other.id]);
    assert.equal(store.activeCanvasId, "a", "selection must not change the current canvas");
  });
  await test("wrong practice ignores due/enrollment but never inherits another canvas's wrong flag", () => {
    const a = api.questionsForCard(card, "a")[0], b = api.questionsForCard(card, "b")[0];
    const logs = [log("wrong-a", { questionId: a.id, scopeId: "a", rating: 1 }), log("setup-b", { questionId: b.id, scopeId: "b", rating: 1, initialization: true })];
    const fake = { store: { activeCanvasId: "a", canvases: [], reviewLogs: logs, cardsForStudySet: () => [{ ...card, wrong: true }], pendingQuestions: () => [], getReviewState: () => ({ ...state, due: "2999-01-01" }) } };
    assert.deepEqual(api.questionsForReview(fake, { wrong: true }).map(item => item.id), [a.id]);
    assert.deepEqual(api.questionsForReview(fake, { wrong: true, scopeId: "b" }), []);
    assert.equal(api.questionWasWrong({ ...card, wrong: true }, api.questionsForCard(card)[0], []), false);
    assert.equal(api.questionWasWrong(card, a, [log("new-wrong", { questionId: a.id, rating: 1, reviewedAt: later.toISOString() }), log("older-good", { questionId: a.id, rating: 3 })]), true, "merged log array order must not replace the latest answer");
  });
  await test("wrong practice excludes hidden cards and group members even in the all-cards scope", () => {
    const cards = [card, { ...card, id: "hidden", hidden: true }, { ...card, id: "member", groupId: card.id }];
    const logs = cards.map(item => log("wrong-" + item.id, { cardId: item.id, questionId: api.questionsForCard(item, "a")[0].id, scopeId: "a", rating: 1 }));
    const fake = { store: { activeCanvasId: "a", canvases: [], reviewLogs: logs, cardsForStudySet: () => cards } };
    assert.deepEqual(api.questionsForReview(fake, { wrong: true, studySetId: "*" }).map(item => item.cardId), [card.id]);
  });
  await test("completed-history projection excludes setup audits and preserves withdrawal evidence", () => {
    const history = api.completedReviewHistory([log("setup", { initialization: true }), log("old"), log("new", { reviewedAt: later.toISOString(), undoneAt: later.toISOString() })]);
    assert.deepEqual(history.map(item => item.id), ["new", "old"]);
    assert.equal(api.effectiveReviewCounts([log("setup", { initialization: true })])[day] ?? 0, 0);
    const scoped = [log("legacy"), log("a", { scopeId: "a" }), log("b", { scopeId: "b" }), log("other-card", { cardId: "other", scopeId: "a" })];
    assert.deepEqual(api.completedReviewHistory(scoped).map(item => item.id), ["legacy"]);
    assert.deepEqual(api.completedReviewHistory(scoped, card.id, "a").map(item => item.id), ["a"]);
  });
  await test("creating an ordinary card leaves the explicit review queue empty", async () => {
    const { store } = await fresh();
    store.addCard({ ...card, id: "ordinary", type: "excerpt" });
    assert.equal(activePending(store).length, 0); assert.deepEqual(api.questionsForReview({ store }), []);
  });
  await test("first scoring without pending is an undoable setup audit, not completed history", async () => {
    const { store } = await fresh(); const question = api.questionsForCard(card, "a")[0];
    store.gradeCard(card.id, 3, { questionId: question.id, scopeId: "a", now, commentText: "not a completed review", drawing: [[{ x: 0.1, y: 0.2 }]] });
    assert.equal(activePending(store).length, 1); assert.equal(store.getReviewState(card.id, question.id).reps, 1);
    const audit = store.getLatestReviewLog(); assert.equal(audit.initialization, true);
    assert.equal(audit.commentText, undefined); assert.equal(audit.drawing, undefined);
    assert.equal(store.reviewHistory[day] ?? 0, 0); assert.deepEqual(api.completedReviewHistory(store.reviewLogs), []);
    store.undoLastReview(); assert.equal(activePending(store).length, 0); assert.equal(store.reviewHistory[day] ?? 0, 0); assert.ok(audit.undoneAt);
  });
  await test("explicit enrollment is immediately due and subsequent scoring completes exactly one pending", async () => {
    const { store } = await fresh(); const question = api.questionsForCard(card, "a")[0];
    store.enqueueReview([card.id], "a", now);
    const pending = activePending(store); assert.equal(pending.length, 1); assert.equal(pending[0].due, now.toISOString());
    assert.equal(store.reviewHistory[day] ?? 0, 0); assert.equal(api.completedReviewHistory(store.reviewLogs).length, 0);
    const before = store.getReviewState(card.id, question.id);
    store.gradeCard(card.id, 3, { questionId: question.id, scopeId: "a", now: later });
    assert.equal(activePending(store).length, 1); assert.equal(store.reviewHistory[day], 1);
    assert.deepEqual(store.getLatestReviewLog().before, before); assert.equal(store.getLatestReviewLog().initialization, false);
    assert.equal(store.getReviewState(card.id, question.id).reps, before.reps + 1);
    store.undoLastReview(); assert.equal(store.reviewHistory[day], 0); assert.equal(activePending(store)[0].due, now.toISOString());
  });
  await test("re-enrollment completes the previous pending as Again and forces due to now", async () => {
    const { store } = await fresh(); store.enqueueReview([card.id], "a", now); store.enqueueReview([card.id], "a", later);
    assert.equal(activePending(store).length, 1); assert.equal(activePending(store)[0].due, later.toISOString());
    assert.equal(store.reviewHistory[day], 1); assert.equal(store.getLatestReviewLog().rating, 1);
    assert.equal(store.getLatestReviewLog().initialization, false); assert.equal(store.getLatestReviewLog().after.due, later.toISOString());
  });
  await test("the same source card has independent pending, scheduling and wrong state in two canvases", async () => {
    const { store } = await fresh(); const a = api.questionsForCard(card, "a")[0], b = api.questionsForCard(card, "b")[0];
    store.enqueueReview([card.id], "a", now); store.enqueueReview([card.id], "b", now);
    const untouched = store.getReviewState(card.id, b.id);
    store.gradeCard(card.id, 1, { questionId: a.id, scopeId: "a", now: later });
    assert.deepEqual(store.getReviewState(card.id, b.id), untouched); assert.equal(activePending(store).length, 2);
    assert.equal(api.questionWasWrong(store.getCard(card.id), a, store.reviewLogs), true);
    assert.equal(api.questionWasWrong(store.getCard(card.id), b, store.reviewLogs), false);
    assert.equal(store.reviewHistory[day], 1);
  });
  await test("new scoped questions do not inherit an old unscoped schedule", async () => {
    const { store } = await fresh({ srs: { [card.id]: { ...state, reps: 40, state: 2, interval: 40, stability: 40, difficulty: 5 } } });
    const question = api.questionsForCard(card, "a")[0];
    assert.equal(store.getReviewState(card.id, question.id).reps, 0); assert.equal(activePending(store).length, 0);
    store.enqueueReview([card.id], "a", now); assert.equal(store.getReviewState(card.id, question.id).reps, 1);
    assert.equal(store.srs[card.id].reps, 40);
  });
  await test("undoing initialization restores a retained schedule that was not enrolled", async () => {
    const question = api.questionsForCard(card, "a")[0];
    const previous = { ...state, reps: 40, state: 2, interval: 40, stability: 40, difficulty: 5, due: "2030-01-01T00:00:00.000Z" };
    const { store } = await fresh({ srs: { [question.id]: previous }, reviewPending: [] });
    const retained = store.getReviewState(card.id, question.id);
    store.enqueueReview([card.id], "a", now);
    assert.equal(store.getReviewState(card.id, question.id).reps, 1, "initialization still starts a new schedule");
    store.undoLastReview();
    assert.deepEqual(store.getReviewState(card.id, question.id), retained, "undo restores the retained pre-initialization schedule");
    assert.equal(activePending(store).length, 0); assert.equal(store.reviewHistory[day] ?? 0, 0);
  });
  await test("review snapshots, comments, drawings, pending and undo survive reload without aliasing", async () => {
    const { store, host } = await fresh(); const question = api.questionsForCard(card, "a")[0];
    const drawing = [[{ x: 0.1, y: 0.2 }, { x: 0.5, y: 0.6 }]];
    store.enqueueReview([card.id], "a", now);
    store.gradeCard(card.id, 3, { questionId: question.id, scopeId: "a", now: later, commentText: "reasoning", drawing });
    drawing[0][0].x = 0.9; store.updateCard(card.id, { front: "changed source" }); await store.flush();
    const reloaded = new api.Store(host); await reloaded.load(); stores.push(reloaded);
    const record = api.completedReviewHistory(reloaded.reviewLogs, card.id, "a")[0];
    assert.equal(record.commentText, "reasoning"); assert.equal(record.drawing[0][0].x, 0.1); assert.equal(record.cardSnapshot.front, "Question");
    assert.equal(activePending(reloaded).length, 1); assert.equal(activePending(reloaded)[0].due, record.after.due);
    reloaded.undoLastReview(); assert.equal(reloaded.reviewHistory[day], 0); assert.equal(activePending(reloaded)[0].due, now.toISOString());
  });
  await test("nil and false pending are active while visited records stay outside the queue", async () => {
    const cards = ["nil", "false", "visited"].map(id => ({ ...card, id }));
    const records = cards.map((item, i) => ({ id: "p-" + i, cardId: item.id, questionId: api.questionsForCard(item, "a")[0].id, scopeId: "a", due: now.toISOString(), queuedAt: now.toISOString(), visited: [null, false, true][i] }));
    const srs = Object.fromEntries(records.map(record => [record.questionId, state]));
    const { store } = await fresh({ cards, reviewPending: records, srs });
    assert.deepEqual(store.pendingQuestions("a").map(item => item.cardId).sort(), ["false", "nil"]);
  });
  await test("a review copy has its own identity and source provenance before explicit enrollment", async () => {
    const { store } = await fresh(); const copy = store.createReviewCopy(card.id, "a");
    assert.notEqual(copy.id, card.id); assert.equal(copy.sourceCardId, card.id); assert.equal(copy.front, card.front);
    assert.equal(activePending(store).length, 0);
    store.enqueueReview([copy.id], "a", now); assert.equal(activePending(store)[0].cardId, copy.id);
    assert.equal(store.reviewPending.some(item => item.cardId === card.id), false);
    store.updateCard(copy.id, { front: "independent" }); assert.equal(store.getCard(card.id).front, card.front);
  });
  await test("legacy schedules enroll on load without inventing completed history", async () => {
    const { store } = await fresh({ reviewPending: undefined, srs: { [card.id]: state } });
    assert.equal(activePending(store).length, 1); assert.equal(activePending(store)[0].questionId, card.id);
    assert.equal(store.reviewLogs.length, 0); assert.equal(store.reviewHistory[day] ?? 0, 0);
    store.gradeCard(card.id, 3, { now }); assert.equal(store.reviewHistory[day], 1);
  });
  await test("anchored group members keep their pending and scheduling through merge, reload and unmerge without counting twice", async () => {
    const member = { ...card, id: "member", front: "Second question", page: 1, anchorAnnId: "fixture-annotation" };
    const { store, host } = await fresh({ cards: [card, member],
      studySets: [{ id: "study", name: "Study", docPaths: [], cardIds: [card.id, member.id], createdAt: now.toISOString() }] });
    const memberQuestion = api.questionsForCard(member, "a")[0];
    store.enqueueReview([card.id, member.id], "a", now);
    const memberPending = structuredClone(store.reviewPending.find(item => item.cardId === member.id));
    const memberState = store.getReviewState(member.id, memberQuestion.id);
    store.mergeCards(card.id, [member.id]);
    assert.equal(store.getCard(member.id)?.groupId, card.id, "a group member retains its source identity");
    assert.deepEqual(api.questionsForReview({ store }).map(item => item.cardId), [card.id]);
    assert.deepEqual(store.enqueueReview([member.id], "a", later), [], "a member cannot enroll or count independently while merged");
    assert.equal(store.reviewHistory[day] ?? 0, 0);
    await store.flush(); const reloaded = new api.Store(host); await reloaded.load(); stores.push(reloaded);
    assert.deepEqual(reloaded.reviewPending.find(item => item.cardId === member.id), memberPending);
    assert.deepEqual(reloaded.getReviewState(member.id, memberQuestion.id), memberState);
    assert.deepEqual(api.questionsForReview({ store: reloaded }).map(item => item.cardId), [card.id]);
    reloaded.unmergeCard(card.id);
    assert.deepEqual(api.questionsForReview({ store: reloaded }).map(item => item.cardId).sort(), [card.id, member.id].sort());
    assert.deepEqual(reloaded.getReviewState(member.id, memberQuestion.id), memberState);
    assert.equal(reloaded.reviewHistory[day] ?? 0, 0);
  });
  await test("an unanchored member is archived while its pending survives reload and returns on unmerge", async () => {
    const member = { ...card, id: "unanchored-member", front: "Standalone content" };
    const { store, host } = await fresh({ cards: [card, member],
      studySets: [{ id: "study", name: "Study", docPaths: [], cardIds: [card.id, member.id], createdAt: now.toISOString() }] });
    const question = api.questionsForCard(member, "a")[0];
    store.enqueueReview([card.id, member.id], "a", now);
    const pending = structuredClone(store.reviewPending.find(item => item.cardId === member.id));
    const schedule = store.getReviewState(member.id, question.id);
    store.mergeCards(card.id, [member.id]);
    assert.equal(store.getCard(member.id), undefined, "an unanchored non-draft does not remain a live source entity");
    assert.ok(store.getCard(card.id).mergedCards.some(item => item.id === member.id));
    assert.deepEqual(api.questionsForReview({ store }).map(item => item.cardId), [card.id]);
    await store.flush(); const reloaded = new api.Store(host); await reloaded.load(); stores.push(reloaded);
    assert.deepEqual(reloaded.reviewPending.find(item => item.cardId === member.id), pending, "archival is not loss of enrollment");
    assert.deepEqual(reloaded.getReviewState(member.id, question.id), schedule);
    reloaded.unmergeCard(card.id);
    assert.ok(reloaded.getCard(member.id));
    assert.deepEqual(api.questionsForReview({ store: reloaded }).map(item => item.cardId).sort(), [card.id, member.id].sort());
    assert.deepEqual(reloaded.getReviewState(member.id, question.id), schedule);
    assert.equal(reloaded.reviewHistory[day] ?? 0, 0);
  });
  await test("unmerge preserves a real head review made while grouped", async () => {
    const member = { ...card, id: "member", front: "Second question" };
    const { store } = await fresh({ cards: [card, member] });
    const question = api.questionsForCard(card, "a")[0];
    store.enqueueReview([card.id, member.id], "a", now); store.mergeCards(card.id, [member.id]);
    store.gradeCard(card.id, 3, { questionId: question.id, scopeId: "a", now: later });
    const after = store.getReviewState(card.id, question.id), pending = structuredClone(store.reviewPending.find(item => item.questionId === question.id));
    store.unmergeCard(card.id);
    assert.deepEqual(store.getReviewState(card.id, question.id), after);
    assert.deepEqual(store.reviewPending.find(item => item.questionId === question.id), pending);
    assert.equal(store.reviewHistory[day], 1);
  });
  await test("concurrent pending for one question keeps the newer enrollment regardless of merge order", async () => {
    const question = api.questionsForCard(card, "a")[0];
    const pending = (id, queuedAt, due) => ({ id, cardId: card.id, questionId: question.id, scopeId: "a", queuedAt, due });
    const newer = pending("new-pending", later.toISOString(), later.toISOString()), older = pending("old-pending", now.toISOString(), now.toISOString());
    const local = seed({ srs: { [question.id]: state }, reviewPending: [newer] }), remote = seed({ srs: { [question.id]: state }, reviewPending: [older] });
    for (const merged of [api.mergePreservingVersions(local, remote), api.mergePreservingVersions(remote, local)]) {
      const { store } = await fresh(merged);
      assert.equal(store.reviewPending.length, 1, "one question has one active pending");
      assert.equal(store.reviewPending[0].queuedAt, later.toISOString());
      assert.equal(store.reviewPending[0].due, later.toISOString());
    }
  });
  await test("merging two legacy snapshots does not replace implicit enrollment with an empty explicit queue", async () => {
    const legacy = seed({ reviewPending: undefined, srs: { [card.id]: state } });
    const { store } = await fresh(api.mergePreservingVersions(legacy, structuredClone(legacy)));
    assert.equal(activePending(store).length, 1); assert.equal(activePending(store)[0].questionId, card.id);
    assert.equal(store.reviewLogs.length, 0); assert.equal(store.reviewHistory[day] ?? 0, 0);
  });
  await test("a mixed-format conflict keeps explicit non-enrollment and remote-only legacy enrollment", async () => {
    const remoteCard = { ...card, id: "remote-legacy", docPath: "remote.pdf" };
    const explicit = seed({ srs: { [card.id]: state }, reviewPending: [] });
    const legacy = seed({ cards: [remoteCard], srs: { [remoteCard.id]: state }, reviewPending: undefined,
      studySets: [{ id: "remote-study", name: "Remote", docPaths: [], cardIds: [remoteCard.id], createdAt: now.toISOString() }],
      canvases: [], activeStudySetId: "remote-study", activeCanvasId: undefined });
    const { store } = await fresh(api.mergePreservingVersions(explicit, legacy));
    assert.deepEqual(activePending(store).map(item => item.cardId), [remoteCard.id]);
    assert.equal(store.reviewLogs.length, 0); assert.equal(store.reviewHistory[day] ?? 0, 0);
  });
  process.stdout.write(`\n${passed} pending/history acceptance checks passed.\n`);
  if (failures) { process.stdout.write(`${failures} pending/history checks failed.\n`); process.exitCode = 1; }
} finally {
  for (const store of stores) if (store.saveTimer !== null) clearTimeout(store.saveTimer);
  await rm(temporary, { recursive: true, force: true });
}
