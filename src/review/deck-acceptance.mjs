// Real model over an in-memory host; never reads a user's vault.
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const temporary = await mkdtemp(path.join(tmpdir(), "marginstudy-decks-"));
const source = fileURLToPath(new URL("../", import.meta.url));
const stores = []; let passed = 0;
const check = async (name, run) => { await run(); passed++; console.log("✓ " + name); };
try {
  const result = await build({ stdin: { contents: ["srs", "model/store", "model/conflicts", "review/questions", "review/reviewView", "review/content"].map(name => `export * from ${JSON.stringify(`./${name}.ts`)};`).join("\n"), resolveDir: source },
    platform: "node", format: "cjs", bundle: true, write: false,
    plugins: [{ name: "memory-host", setup(builder) {
      builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "memory" }));
      builder.onLoad({ filter: /.*/, namespace: "memory" }, () => ({ contents: "export class Component {} export class TFile {} export class Notice {} export class App {} export const MarkdownRenderer = {render: async () => {}};", loader: "js" }));
    } }] });
  const bundle = path.join(temporary, "decks.cjs"); await writeFile(bundle, result.outputFiles[0].contents);
  const api = createRequire(import.meta.url)(bundle), now = new Date("2020-01-02T03:04:05.000Z");
  const card = { id: "card", type: "flashcard", title: "Title", docPath: "", front: "Question", back: "Answer", tags: [], links: [], createdAt: now.toISOString() };
  const seed = patch => ({ cards: [structuredClone(card)], nodes: [], edges: [], srs: {}, reviewPending: [], reviewLogs: [],
    studySets: [{ id: "study", name: "Study", docPaths: [], cardIds: [card.id], createdAt: now.toISOString() }],
    canvases: ["a", "b"].map(id => ({ id, studySetId: "study", name: id, createdAt: now.toISOString() })), activeStudySetId: "study", activeCanvasId: "a", ...patch });
  const fresh = async (patch = {}) => {
    let disk = structuredClone(seed(patch)); const files = new Map();
    const adapter = { exists: async name => files.has(name), mkdir: async name => files.set(name, ""), write: async (name, text) => files.set(name, text), read: async name => files.get(name), remove: async name => files.delete(name) };
    const host = { loadData: async () => structuredClone(disk), saveData: async data => { disk = structuredClone(data); }, app: { vault: { adapter, getFiles: () => [] } } };
    const store = new api.Store(host); await store.load(); stores.push(store); return { store, host, disk: () => structuredClone(disk) };
  };
  await check("creating and binding a named deck does not implicitly enroll source cards", async () => {
    const { store, host } = await fresh(), deck = store.createReviewDeck("Biology", "study");
    assert.equal(store.studySets[0].reviewDeckId, deck.id); assert.deepEqual(deck.studySetIds, ["study"]);
    assert.deepEqual(deck.cardIds, []); assert.deepEqual(store.reviewPending, []); assert.deepEqual(store.cardReviewDecks(card.id), []);
    await store.flush(); const reopened = new api.Store(host); await reopened.load(); stores.push(reopened);
    assert.equal(reopened.reviewDeckForStudySet().name, "Biology"); assert.equal(reopened.activeReviewDeckId, deck.id);
  });
  await check("explicit enrollment adds persistent membership, a deck question and an immediately due queue", async () => {
    const { store } = await fresh(), deck = store.createReviewDeck("Biology", "study");
    const rows = store.enqueueReviewInDeck([card.id, card.id], deck.id, "a", now);
    assert.equal(rows.length, 1); assert.equal(rows[0].questionId, `${card.id}::deck:${deck.id}::basic`);
    assert.deepEqual(store.cardReviewDecks(card.id), [{ id: deck.id, name: "Biology" }]);
    assert.equal(store.pendingQuestionsForDeck(deck.id, now).length, 1);
    assert.deepEqual(store.reviewDeckSummary(deck.id, now), { cards: 1, questions: 1, due: 1, learning: 1, reviewedToday: 0 });
  });
  await check("the same card owns isolated deck schedules, due queues, wrong state and undo", async () => {
    const { store } = await fresh(), a = store.createReviewDeck("A", "study"), b = store.createReviewDeck("B");
    store.enqueueReviewInDeck([card.id], a.id, "a", now); store.enqueueReviewInDeck([card.id], b.id, "b", now);
    const qa = store.deckQuestionsForCard(card.id, a.id)[0], qb = store.deckQuestionsForCard(card.id, b.id)[0];
    const beforeB = structuredClone(store.srs[qb.id]);
    store.gradeCard(card.id, 1, { questionId: qa.id, deckId: a.id, scopeId: "a", now });
    assert.deepEqual(store.srs[qb.id], beforeB); assert.equal(api.questionsForReview({ store }, { wrong: true, deckId: a.id }).length, 1);
    assert.equal(api.questionsForReview({ store }, { wrong: true, deckId: b.id }).length, 0);
    store.undoLastReview(); assert.deepEqual(store.srs[qb.id], beforeB); assert.equal(store.reviewDeckSummary(a.id, now).reviewedToday, 0);
  });
  await check("a deck never inherits an old unscoped schedule", async () => {
    const old = { ...api.freshState(2.5, now), reps: 20, interval: 99, due: "2999-01-01T00:00:00.000Z" };
    const { store } = await fresh({ srs: { card: old } }), deck = store.createReviewDeck("Fresh");
    const q = store.deckQuestionsForCard(card.id, deck.id)[0]; assert.equal(store.getReviewState(card.id, q.id).reps, 0);
    store.enqueueReviewInDeck([card.id], deck.id, "a", now); assert.equal(store.getLatestReviewLog().before.reps, 0); assert.deepEqual(store.srs.card, api.normalizeState(old));
  });
  await check("future scheduling and save/reload keep deck badges and independent queue selection", async () => {
    const { store, host } = await fresh(), deck = store.createReviewDeck("Future", "study");
    store.enqueueReviewInDeck([card.id], deck.id, "a", now); const q = store.deckQuestionsForCard(card.id, deck.id)[0];
    store.gradeCard(card.id, 4, { questionId: q.id, scopeId: "a", deckId: deck.id, now });
    assert.equal(store.pendingQuestionsForDeck(deck.id, now).length, 0); assert.equal(store.cardReviewDecks(card.id).length, 1);
    assert.equal(store.reviewDeckSummary(deck.id, now).reviewedToday, 1);
    await store.flush(); const reopened = new api.Store(host); await reopened.load(); stores.push(reopened);
    assert.deepEqual(reopened.cardReviewDecks(card.id), [{ id: deck.id, name: "Future" }]); assert.equal(reopened.pendingQuestionsForDeck(deck.id, now).length, 0);
    assert.equal(reopened.reviewPending[0].deckId, deck.id); assert.deepEqual(reopened.srs[q.id], store.srs[q.id]);
  });
  await check("legacy scoped and unscoped queues get compatibility decks without rewriting keys or states", async () => {
    const scoped = api.questionsForCard(card, "a")[0], state = api.freshState(2.5, now);
    const pending = [card.id, scoped.id].map((questionId, i) => ({ id: "pending-" + i, cardId: card.id, questionId, ...(i && { scopeId: "a" }), due: now.toISOString(), queuedAt: now.toISOString() }));
    const { store } = await fresh({ srs: { card: state, [scoped.id]: state }, reviewPending: pending });
    assert.equal(store.reviewDecks.length, 2); assert.deepEqual(store.reviewPending, pending); assert.deepEqual(store.srs, { card: state, [scoped.id]: state });
    for (const deck of store.reviewDecks) { assert.equal(store.pendingQuestionsForDeck(deck.id, now).length, 1); assert.equal(store.cardReviewDecks(card.id).length, 2); }
    const deck = store.reviewDeckForStudySet(); assert.equal(deck.legacyScopeId, "a");
    store.gradeCard(card.id, 3, { questionId: scoped.id, scopeId: "a", deckId: deck.id, now });
    assert.equal(store.getLatestReviewLog().initialization, false); assert.deepEqual(store.srs.card, state); store.undoLastReview();
    assert.deepEqual(store.reviewPending.find(row => row.questionId === scoped.id), pending[1]);
  });
  await check("an explicit empty enrollment list never manufactures compatibility membership", async () => {
    const { store } = await fresh({ srs: { card: api.freshState(2.5, now) }, reviewPending: [] });
    assert.deepEqual(store.reviewDecks, []); assert.deepEqual(store.cardReviewDecks(card.id), []);
  });
  await check("legacy enrollment remains discoverable and the legacy API still works after deck-aware scoring", async () => {
    const { store, host } = await fresh(); store.enqueueReview([card.id], "a", now);
    const deck = store.reviewDecks.find(deck => deck.legacyScopeId === "a"), q = store.deckQuestionsForCard(card.id, deck.id)[0];
    assert.equal(store.cardReviewDecks(card.id).length, 1); await store.flush();
    const reopened = new api.Store(host); await reopened.load(); stores.push(reopened); assert.equal(reopened.cardReviewDecks(card.id).length, 1);
    store.gradeCard(card.id, 1, { questionId: q.id, deckId: deck.id, scopeId: "a", now });
    store.reviewPending[0].due = now.toISOString(); store.srs[q.id].due = now.toISOString();
    assert.equal(store.pendingQuestions("a").length, 1); store.gradeCard(card.id, 3, { questionId: q.id, scopeId: "a", now });
    assert.equal(store.getLatestReviewLog().initialization, false); assert.equal(store.reviewPending[0].deckId, deck.id);
  });
  await check("editing questions reconciles each enrolled deck without touching the other deck's progress", async () => {
    const { store } = await fresh(), a = store.createReviewDeck("A"), b = store.createReviewDeck("B");
    store.enqueueReviewInDeck([card.id], a.id, "a", now); store.enqueueReviewInDeck([card.id], b.id, "b", now);
    store.updateCard(card.id, { front: "{{c1::first}} {{c2::second}}" });
    for (const deck of [a,b]) assert.equal(store.pendingQuestionsForDeck(deck.id, now).length, 2);
    const qb = store.deckQuestionsForCard(card.id, b.id)[0], beforeB = structuredClone(store.srs[qb.id]);
    const qa = store.deckQuestionsForCard(card.id, a.id)[0]; store.gradeCard(card.id, 4, { questionId: qa.id, deckId: a.id, scopeId: "a", now });
    assert.deepEqual(store.srs[qb.id], beforeB);
  });
  await check("explicit source refresh overwrites only selected parts and preserves existing question schedules", async () => {
    const { store } = await fresh(), copy = store.createReviewCopy(card.id, "a"), deck = store.createReviewDeck("Copy");
    store.enqueueReviewInDeck([copy.id], deck.id, "a", now); const q = store.deckQuestionsForCard(copy.id, deck.id)[0];
    store.gradeCard(copy.id, 4, { questionId: q.id, deckId: deck.id, scopeId: "a", now }); const schedule = structuredClone(store.srs[q.id]);
    store.updateCard(copy.id, { back: "My independent answer" }); store.updateCard(card.id, { title: "New source title", front: "New question", back: "New source answer" });
    assert.equal(store.getCard(copy.id).front, "Question"); store.refreshReviewCopy(copy.id, { parts: ["title", "excerpt"] });
    assert.equal(copy.title, "New source title"); assert.equal(copy.front, "New question"); assert.equal(copy.back, "My independent answer");
    assert.deepEqual(store.srs[q.id], schedule); assert.deepEqual(copy.reviewCopySelection.parts, ["title", "excerpt"]); assert.ok(copy.sourceSyncedAt);
  });
  await check("refreshing selected image masks keeps local mask geometry independent and sources untouched", async () => {
    const masks = [{ id: "m1", x: 0, y: 0, width: .2, height: .2 }, { id: "m2", x: .5, y: .5, width: .2, height: .2 }];
    const { store } = await fresh({ cards: [{ ...card, image: "synthetic", occlusions: masks }] });
    const copy = store.createReviewCopy(card.id, "a", { parts: ["images"], maskIds: ["m1"] });
    const before = structuredClone(store.getCard(card.id)); store.refreshReviewCopy(copy.id, { parts: ["images"], maskIds: ["m2"] });
    assert.deepEqual(copy.occlusions.map(mask => mask.id), ["m2"]); copy.occlusions[0].x = .1;
    assert.deepEqual(store.getCard(card.id), before);
  });
  await check("conflict copies retain coherent deck, study binding, pending, logs and deck question identities", async () => {
    const { store, disk } = await fresh(), deck = store.createReviewDeck("Local", "study");
    store.enqueueReviewInDeck([card.id], deck.id, "a", now); await store.flush();
    const local = disk(), remote = structuredClone(local); remote.cards[0].front = "Remote question"; remote.reviewDecks[0].name = "Remote";
    const merged = api.mergePreservingVersions(local, remote), remoteCard = merged.cards.find(item => item.front === "Remote question");
    const remoteDeck = merged.reviewDecks.find(item => item.name.startsWith("Remote"));
    assert.notEqual(remoteDeck.id, deck.id); assert.ok(remoteDeck.cardIds.includes(remoteCard.id));
    const remoteSet = merged.studySets.find(item => item.reviewDeckId === remoteDeck.id); assert.ok(remoteSet); assert.ok(remoteDeck.studySetIds.includes(remoteSet.id));
    const pending = merged.reviewPending.find(item => item.deckId === remoteDeck.id); assert.equal(pending.cardId, remoteCard.id);
    assert.ok(pending.questionId.includes(`::deck:${remoteDeck.id}::`)); assert.ok(merged.srs[pending.questionId]);
    assert.ok(merged.reviewLogs.some(log => log.deckId === remoteDeck.id && log.questionId === pending.questionId));
    assert.deepEqual(local, disk(), "merge must not mutate the source snapshot");
  });
  await check("legacy conflict migration retains both decks and old question keys", async () => {
    const { store, disk } = await fresh(); store.enqueueReview([card.id], "a", now); await store.flush();
    const old = disk(); delete old.reviewDecks; const remote = structuredClone(old); remote.cards[0].front = "Remote";
    const merged = api.mergePreservingVersions(old, remote); assert.equal(merged.reviewDecks.length, 2);
    for (const deck of merged.reviewDecks) {
      assert.equal(deck.cardIds.length, 1); const id = deck.cardIds[0];
      assert.ok(merged.reviewPending.some(row => row.cardId === id && row.questionId === `${id}::scope:${deck.legacyScopeId}::basic`));
    }
  });
  await check("undoing a card edit preserves a later enrollment and the existing deck binding", async () => {
    const { store } = await fresh(); store.updateCard(card.id, { front: "Edited" });
    const deck = store.createReviewDeck("Later", "study"); store.enqueueReviewInDeck([card.id], deck.id, "a", now);
    store.updateCard(card.id, { back: "Edited answer" }); store.enqueueReviewInDeck([card.id], deck.id, "a", now);
    store.undoLibraryChange(); assert.equal(store.getCard(card.id).back, "Answer");
    assert.equal(store.reviewDeckForStudySet().id, deck.id); assert.equal(store.cardReviewDecks(card.id).length, 1); assert.equal(store.pendingQuestionsForDeck(deck.id, now).length, 1);
  });
  await check("removing a study set detaches its binding while deck membership and review progress survive", async () => {
    const { store } = await fresh(), deck = store.createReviewDeck("Keep", "study"); store.enqueueReviewInDeck([card.id], deck.id, "a", now);
    const states = structuredClone(store.srs); store.removeStudySet("study");
    assert.deepEqual(store.getReviewDeck(deck.id).studySetIds, []); assert.equal(store.cardReviewDecks(card.id).length, 1); assert.deepEqual(store.srs, states);
    assert.equal(store.pendingQuestionsForDeck(deck.id, now).length, 1);
  });
  await check("removing a deck member isolates the removal and retains history/schedules with an undo path", async () => {
    const { store } = await fresh(), a = store.createReviewDeck("A"), b = store.createReviewDeck("B");
    store.enqueueReviewInDeck([card.id], a.id, "a", now); store.enqueueReviewInDeck([card.id], b.id, "b", now);
    const states = structuredClone(store.srs), logs = structuredClone(store.reviewLogs), pendingB = structuredClone(store.reviewPending.find(row => row.deckId === b.id));
    store.removeCardsFromReviewDeck([card.id], a.id);
    assert.deepEqual(store.cardReviewDecks(card.id), [{ id: b.id, name: "B" }]); assert.equal(store.pendingQuestionsForDeck(a.id, now).length, 0);
    assert.deepEqual(store.srs, states); assert.deepEqual(store.reviewLogs, logs); assert.deepEqual(store.reviewPending.find(row => row.deckId === b.id), pendingB);
    store.undoLibraryChange(); assert.equal(store.cardReviewDecks(card.id).length, 2); assert.equal(store.pendingQuestionsForDeck(a.id, now).length, 1);
  });
  await check("hidden cards and merged members retain membership while pausing their deck queues", async () => {
    const { store } = await fresh(), deck = store.createReviewDeck("Keep"); store.enqueueReviewInDeck([card.id], deck.id, "a", now);
    store.updateCard(card.id, { hidden: true }); assert.equal(store.pendingQuestionsForDeck(deck.id, now).length, 0); assert.equal(store.cardReviewDecks(card.id).length, 1);
    store.updateCard(card.id, { hidden: false, groupId: "head" }); assert.equal(store.pendingQuestionsForDeck(deck.id, now).length, 0);
    store.updateCard(card.id, { groupId: undefined }); assert.equal(store.pendingQuestionsForDeck(deck.id, now).length, 1);
  });
  await check("a custom review question changes only the review face while the source card and due progress remain intact", async () => {
    const { store } = await fresh(), deck = store.createReviewDeck("Custom"); store.enqueueReviewInDeck([card.id], deck.id, "a", now);
    const original = structuredClone(store.getCard(card.id)), q = store.deckQuestionsForCard(card.id, deck.id)[0], schedule = structuredClone(store.srs[q.id]);
    store.setReviewQuestion(card.id, { mode: "custom", text: "What does this theorem establish?" });
    const changed = store.getCard(card.id); assert.equal(changed.front, original.front); assert.equal(changed.back, original.back); assert.equal(changed.title, original.title);
    assert.equal(api.questionText(changed, q, false), "What does this theorem establish?");
    assert.equal(api.questionText(changed, q, true), "Title\n\nQuestion\n\nAnswer"); assert.deepEqual(store.srs[q.id], schedule);
    store.setReviewQuestion(card.id, undefined); assert.equal(api.questionText(changed, q, false), "Question");
  });
  await check("title, emphasis and whole-card projections preserve source content and the missing-field legacy display", async () => {
    const original = { ...card, front: "First excerpt\n\n**Important paragraph**\n\n`**code is not a highlight**`\n\nUnrelated paragraph", back: "Additional note" };
    const { store } = await fresh({ cards: [original] }); const basic = api.questionsForCard(original)[0];
    assert.equal(api.questionText(store.getCard(card.id), basic, false), original.front);
    store.setReviewQuestion(card.id, { mode: "title" }); assert.equal(api.questionText(store.getCard(card.id), basic, false), "Title");
    assert.ok(api.questionText(store.getCard(card.id), basic, true).includes("Additional note"));
    store.setReviewQuestion(card.id, { mode: "emphasis" }); assert.equal(api.questionText(store.getCard(card.id), basic, false), "**Important paragraph**");
    store.setReviewQuestion(card.id, { mode: "whole" }); assert.equal(api.questionText(store.getCard(card.id), basic, false), "Title\n\n" + original.front + "\n\nAdditional note");
    assert.equal(store.getCard(card.id).front, original.front); assert.equal(store.getCard(card.id).back, original.back);
  });
  await check("batch extraction preserves manual single-card questions unless explicitly overridden", async () => {
    const { store } = await fresh({ cards: [card, { ...card, id: "second" }] });
    store.setReviewQuestion(card.id, { mode: "custom", text: "Manual wins" });
    assert.equal(store.updateReviewQuestions([card.id, "second"], { mode: "title" }), 1);
    assert.equal(store.getCard(card.id).reviewQuestion.text, "Manual wins"); assert.equal(store.getCard("second").reviewQuestion.mode, "title");
    assert.equal(store.updateReviewQuestions([card.id], { mode: "whole" }, false), 1); assert.equal(store.getCard(card.id).reviewQuestion.mode, "whole");
  });
  await check("custom cloze questions own independent identities and schedules without inserting cloze into the source", async () => {
    const { store, host } = await fresh(), deck = store.createReviewDeck("Projected"); store.enqueueReviewInDeck([card.id], deck.id, "a", now);
    store.setReviewQuestion(card.id, { mode: "custom", text: "Recall {{c1::first}} and {{c2::second}}" });
    const questions = store.deckQuestionsForCard(card.id, deck.id); assert.equal(questions.length, 2); assert.equal(store.pendingQuestionsForDeck(deck.id, now).length, 2);
    store.gradeCard(card.id, 4, { questionId: questions[0].id, deckId: deck.id, scopeId: "a", now }); const schedule = structuredClone(store.srs[questions[0].id]);
    store.setReviewQuestion(card.id, { mode: "custom", text: "A revised hint for {{c1::first}} and {{c2::second}}" }); assert.deepEqual(store.srs[questions[0].id], schedule);
    assert.equal(store.getCard(card.id).front, "Question"); assert.ok(!api.questionText(store.getCard(card.id), questions[0], false).includes("first"));
    await store.flush(); const reopened = new api.Store(host); await reopened.load(); stores.push(reopened);
    assert.equal(reopened.getCard(card.id).reviewQuestion.mode, "custom"); assert.deepEqual(reopened.srs[questions[0].id], schedule);
  });
  await check("deck filters intersect favorites, tags, source, color and latest per-question rating", async () => {
    const cards = [
      { ...card, id: "a", front: "Alpha", docPath: "b.pdf", page: 2, tags: ["focus"], color: "red", favorite: true },
      { ...card, id: "b", front: "Beta", docPath: "a.pdf", page: 1, tags: ["focus"], color: "blue", favorite: true },
      { ...card, id: "c", front: "Gamma", docPath: "a.pdf", page: 2, tags: ["other"], color: "red" },
      { ...card, id: "d", front: "Delta", docPath: "a.pdf", page: 3, tags: ["focus"], color: "red", favorite: true },
      { ...card, id: "new", front: "Unreviewed", tags: ["focus"], color: "red", favorite: true },
    ];
    const { store } = await fresh({ cards }), deck = store.createReviewDeck("Filter"); store.enqueueReviewInDeck(cards.map(card => card.id), deck.id, "a", now);
    for (const [index, card] of cards.slice(0,4).entries()) store.gradeCard(card.id, index + 1, { questionId: store.deckQuestionsForCard(card.id, deck.id)[0].id, deckId: deck.id, scopeId: "a", now });
    const selected = options => api.questionsForReview({ store }, { deckId: deck.id, ...options }).map(question => question.cardId);
    assert.deepEqual(selected({ favorite: true, tags: ["focus"], colors: ["red"], ratings: [1] }), ["a"]);
    assert.deepEqual(selected({ favorite: true, docPaths: ["a.pdf"], colors: ["red"], ratings: [4] }), ["d"]);
    assert.deepEqual(selected({ tags: ["focus", "other"] }), []); assert.deepEqual(selected({ ratings: [0] }), ["new"]);
    assert.deepEqual(selected({ docPaths: [] }), []);
    store.undoLastReview(); assert.deepEqual(selected({ ratings: [4] }), []); assert.deepEqual(selected({ ratings: [0] }).sort(), ["d", "new"]);
  });
  await check("review order follows added membership, document position, question text and a stable random session", async () => {
    const cards = [
      { ...card, id: "d", front: "Delta", docPath: "a.pdf", page: 3 }, { ...card, id: "b", front: "Beta", docPath: "a.pdf", page: 1 },
      { ...card, id: "a", front: "Alpha", docPath: "b.pdf", page: 2 }, { ...card, id: "c", front: "Gamma", docPath: "a.pdf", page: 2 },
    ];
    const { store } = await fresh({ cards }), deck = store.createReviewDeck("Order"); store.enqueueReviewInDeck(cards.map(card => card.id), deck.id, "a", now);
    const ordered = options => api.questionsForReview({ store }, { deckId: deck.id, ...options }).map(question => question.cardId);
    assert.deepEqual(ordered({ order: "added" }), ["d", "b", "a", "c"]); assert.deepEqual(ordered({ order: "position" }), ["b", "c", "d", "a"]);
    assert.deepEqual(ordered({ order: "text" }), ["a", "b", "d", "c"]);
    const random = ordered({ order: "random", shuffleSeed: "a session" }); assert.deepEqual(random.slice().sort(), ["a","b","c","d"]); assert.deepEqual(ordered({ order: "random", shuffleSeed: "a session" }), random);
  });
  console.log(`\n${passed} deck and source-refresh acceptance checks passed.`);
} finally { for (const store of stores) if (store.saveTimer !== null) clearTimeout(store.saveTimer); await rm(temporary, { recursive: true, force: true }); }
