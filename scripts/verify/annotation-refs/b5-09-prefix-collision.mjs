import { leaveDraft, loadSupport, recoveryDir, recoveryEntries, seedDocument, sha256 } from "./b5-07-draft-survives-rename.mjs";
import { carriesUnbind, leaveMerge, withMainSaveTrap } from "./b5-08-merge-tx-survives-rename.mjs";

const first = "collision-0-0018f25f.pdf";
const second = "collision-0-00e756b3.pdf";
const prefix = "2ed69fa2644e";

function putAtLegacyName(disk, entry, file) {
  if (entry.file !== file) disk.delete(entry.file);
  disk.set(file, entry.bytes);
}

const { run, renameFixture, pen, sourcePath, targetPath } = await loadSupport();
await run("B5-09", async (project, check) => {
  const firstHash = sha256(first), secondHash = sha256(second);
  check("distinct full hashes with a real shared 48-bit prefix",
    [firstHash.slice(0, 12), secondHash.slice(0, 12), firstHash === secondHash], [prefix, prefix, false]);
  const fixture = await renameFixture(project);
  await seedDocument(fixture, first, [pen("first-durable", first, .13)]);
  await seedDocument(fixture, second, [pen("second-durable", second, .23)]);
  for (const entry of await recoveryEntries(fixture.store, "annotations")) {
    if (entry.payload.docPath === sourcePath) fixture.disk.delete(entry.file);
  }
  const writer = await fixture.fresh();
  const pendingPen = pen("second-unbind", second, .65, { hostAnnotationId: "missing-second-host" });
  const pendingMerge = await leaveMerge(fixture, writer, second, pendingPen);
  check("second document staged one genuine journal with an unbind fact",
    [pendingMerge.error, pendingMerge.entries.map(entry => entry.payload.unbindEvents.map(event => event.penId))],
    [pendingMerge.fault, [[pendingPen.id]]]);
  const draft = pen("second-only-draft", second, .61, { text: "另一份文档独有草稿" });
  const pendingDraft = await leaveDraft(fixture, writer, second, draft);
  check("second document staged one genuine rolling draft",
    [pendingDraft.error, pendingDraft.entries.map(entry => entry.payload.annotations)], [pendingDraft.fault, [[draft]]]);
  const journal = pendingMerge.entries[0], rolling = pendingDraft.entries[0];
  if (!journal || !rolling) return;

  const annotationStem = `${recoveryDir}/pending-annotations-${prefix}`;
  const journalStem = `${recoveryDir}/pending-merge-tx-${prefix}`;
  const legacyRolling = `${annotationStem}-device-rolling-000001.json`;
  const legacyJournal = `${journalStem}.json`;
  const rollingNeighbor = `${annotationStem}-neighbor.json`;
  const journalNeighbor = `${journalStem}-neighbor.json`;
  putAtLegacyName(fixture.disk, rolling, legacyRolling);
  putAtLegacyName(fixture.disk, journal, legacyJournal);
  fixture.disk.set(rollingNeighbor, rolling.bytes);
  fixture.disk.set(journalNeighbor, journal.bytes);
  const protectedFiles = [legacyRolling, legacyJournal, rollingNeighbor, journalNeighbor];
  const before = new Map(protectedFiles.map(file => [file, fixture.disk.get(file)]));
  const secondSidecar = fixture.sidecar(second);
  const beforeSecondSidecar = fixture.disk.get(secondSidecar);
  const firstOwnedRolling = (await recoveryEntries(fixture.store, "annotations"))
    .filter(entry => entry.payload.docPath === first).map(entry => entry.file);
  check("legacy recovery files are owned by second document",
    [legacyRolling, legacyJournal].map(file => JSON.parse(before.get(file)).docPath), [second, second]);

  const adapter = fixture.app.vault.adapter;
  const originalRemove = adapter.remove, originalRename = adapter.rename;
  const removeCalls = [], renameCalls = [];
  adapter.remove = async file => { removeCalls.push(file); return originalRemove.call(adapter, file); };
  adapter.rename = async (from, to) => { renameCalls.push([from, to]); return originalRename.call(adapter, from, to); };
  let wrongRecoveryAttempts = 0;
  try {
    await withMainSaveTrap(fixture.store, data => {
      if (carriesUnbind(data, second, pendingPen.id)) {
        wrongRecoveryAttempts++;
        throw new Error("B5_FIXTURE_UNRELATED_JOURNAL_WRITE");
      }
    }, async () => {
      fixture.emitRename(first, targetPath);
      await fixture.settled();
    });
  } finally { adapter.remove = originalRemove; adapter.rename = originalRename; }

  check("only first document renamed",
    { old: fixture.disk.has(fixture.sidecar(first)), moved: (await fixture.read(targetPath)).map(item => item.id) },
    { old: false, moved: ["first-durable"] });
  check("no recovery attempted for second document", wrongRecoveryAttempts, 0);
  check("cleanup removed or moved no protected exact or same-prefix filenames",
    [...removeCalls, ...renameCalls.flat()].filter(file => protectedFiles.includes(file)), []);
  check("any first-owned old rolling filenames were cleaned",
    firstOwnedRolling.filter(file => fixture.disk.has(file)), []);
  for (const file of protectedFiles) {
    const prior = before.get(file), current = fixture.disk.get(file);
    const beforeSha256 = sha256(prior);
    const afterSha256 = current === undefined ? null : sha256(current);
    console.log(`INFO B5-09 ${file} before SHA-256=${beforeSha256} after SHA-256=${afterSha256 ?? "MISSING"}`);
    check(`second recovery file remains byte-identical: ${file}`,
      { exists: current !== undefined, sha256: afterSha256, bytesEqual: current === prior },
      { exists: true, sha256: beforeSha256, bytesEqual: true });
  }
  check("second document sidecar remains byte-identical", fixture.disk.get(secondSidecar), beforeSecondSidecar);
});
