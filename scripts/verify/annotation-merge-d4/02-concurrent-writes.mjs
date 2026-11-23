import { deleted, diskAnns, doc, durable, error, host, merge, parent, payload, pen, run } from "./fixture-support.mjs";

async function sameIdDuringWrite(setup) {
  const state = await setup([deleted, pen("p", "deleted"), host("edit")], [deleted, host("remote")]);
  const {env, store, path} = state;
  env.hooks.afterWrite = async name => {
    if (name !== path) return;
    const live = await store.loadAnnotations(doc);
    live.find(item => item.id === "edit").text = "edited during commit";
    store.saveAnnotationsDebounced(doc, live);
  };
  await merge(store);
  env.hooks.afterWrite = null;
  const cached = await store.loadAnnotations(doc);
  const committedHost = parent(diskAnns(state), "p");
  const penInCache = parent(cached, "p");
  const eventCount = durable(env).length;
  await store.flush();
  const flushed = diskAnns(state);
  return {
    committedHost, penInCache, eventCount,
    penAfterFlush: parent(flushed, "p"),
    editAfterFlush: flushed.find(item => item.id === "edit")?.text,
    keptRemote: flushed.some(item => item.id === "remote"),
    keptPen: flushed.some(item => item.id === "p"),
  };
}

async function failedWriteAgainstNewDisk(setup) {
  const state = await setup([host("local")], [host("remote")]);
  const {env, store, path} = state;
  const newest = payload([host("third")]);
  env.hooks.beforeWrite = async (name, data, disk) => {
    if (name === path && data !== state.raw) {
      disk.set(path, newest);
      throw Error("independent: rejected write after third-party sidecar update");
    }
  };
  const failure = await error(() => merge(store));
  return { rejected: failure !== null, newestPreserved: env.disk.get(path) === newest, diskIds: diskAnns(state).map(item => item.id) };
}

await run("02", async (setup, check) => {
  check("sameIdDuringWrite", await sameIdDuringWrite(setup), {
    committedHost: null, penInCache: null, eventCount: 1, penAfterFlush: null,
    editAfterFlush: "edited during commit", keptRemote: true, keptPen: true,
  });
  check("failedWriteAgainstNewDisk", await failedWriteAgainstNewDisk(setup), {
    rejected: true, newestPreserved: true, diskIds: ["third"],
  });
});
