import { deleted, doc, durable, error, journals, merge, parent, pen, run, unbindEvents } from "./fixture-support.mjs";

await run("03", async (setup, check) => {
  const state = await setup([deleted, pen("p", "deleted")], [deleted]);
  const {env, store} = state;
  let faultCount = 0;
  env.hooks.beforeSaveData = async () => {
    faultCount++;
    throw Error("independent: persistent main save failure");
  };
  const failure = await error(() => merge(store));
  check("sidecar committed; initial main save failed", { rejected: failure !== null, journals: journals(env).length, durableEvents: durable(env).length }, {
    rejected: true, journals: 1, durableEvents: 0,
  });

  const recovering = await env.makeStore();
  check("first restart while main save still fails", { journals: journals(env).length, durableEvents: durable(env).length, retried: faultCount >= 2 }, {
    journals: 1, durableEvents: 0, retried: true,
  });

  const openFailure = await error(() => recovering.loadAnnotations(doc));
  check("same Store opens document while main save still fails", {
    journals: journals(env).length, durableEvents: durable(env).length,
  }, { journals: 1, durableEvents: 0 });
  if (openFailure) console.log(`03 open: ${openFailure}`);

  env.hooks.beforeSaveData = null;
  const fresh = await env.makeStore();
  const loaded = await fresh.loadAnnotations(doc);
  check("clean restart commits the pending unbind event exactly once", {
    journals: journals(env).length, memoryEvents: unbindEvents(fresh).length,
    durableEvents: durable(env).length, penHost: parent(loaded, "p"),
    keptPen: loaded.some(item => item.id === "p"),
  }, { journals: 0, memoryEvents: 1, durableEvents: 1, penHost: null, keptPen: true });
});
