import { diskAnns, doc, durable, host, merge, payload, pen, reverseKeys, run, view } from "./fixture-support.mjs";

await run("04", async (setup, check) => {
  const localHost = host("shared-host", {text: "local"});
  const remoteHost = structuredClone(localHost);
  const sharedPen = pen("shared-pen", "shared-host");
  const raw = [remoteHost, sharedPen, pen("missing-pen", "absent")];
  const state = await setup([localHost, structuredClone(sharedPen)], raw);
  const snapshots = [];
  let store = state.store;
  for (const reverse of [false, false, true]) {
    await store.loadAnnotations(doc);
    state.env.disk.set(state.path, payload(reverse ? reverseKeys(raw) : raw));
    await merge(store);
    const persisted = state.env.getSavedData().docMeta[doc];
    snapshots.push({
      objects: diskAnns(state).map(view), events: durable(state.env).map(event => event.detail),
      conflictMap: persisted.mergeConflictIdMap ?? {}, processed: persisted.mergeProcessedPens ?? {},
      keys: persisted.unbindEventKeys ?? [],
    });
    store = await state.env.makeStore();
  }
  const counts = snapshots.map(snapshot => [snapshot.objects.length, snapshot.events.length, Object.keys(snapshot.conflictMap).length]);
  check("object count / unbind event count / conflict copy count", counts, [[3, 1, 0], [3, 1, 0], [3, 1, 0]]);
  check("second replay preserves IDs and persisted mappings", snapshots[1], snapshots[0]);
  check("key-reversed replay preserves IDs and persisted mappings", snapshots[2], snapshots[0]);
});
