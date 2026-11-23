import { diskAnns, host, merge, payload, pen, run, view } from "./fixture-support.mjs";

await run("07", async (setup, check) => {
  const sharedHost = host("shared-host", {text: "original"});
  const sharedPen = pen("shared-pen", "shared-host");
  const state = await setup([structuredClone(sharedHost), structuredClone(sharedPen)], [sharedHost, sharedPen]);
  await merge(state.store);
  const before = diskAnns(state).map(view);
  check("first merge coalesces the shared host and pen", before, [
    {id: "shared-host", type: "note", host: null, text: "original"},
    {id: "shared-pen", type: "pen", host: "shared-host", text: ""},
  ]);

  state.env.disk.set(state.path, payload([{...sharedHost, text: "changed remotely"}, sharedPen]));
  await merge(state.store);
  const after = diskAnns(state).map(view);
  const remoteHost = after.find(item => item.type === "note" && item.text === "changed remotely");
  const pensForNewRemoteHost = remoteHost ? after.filter(item => item.type === "pen" && item.host === remoteHost.id) : [];
  check("remote host version and its pen survive; local relation remains", {
    objects: after.length,
    localHostUnchanged: after.some(item => item.id === "shared-host" && item.text === "original"),
    localPenHost: after.find(item => item.id === "shared-pen")?.host,
    remoteHostForked: !!remoteHost && remoteHost.id !== "shared-host",
    pensForNewRemoteHost: pensForNewRemoteHost.length,
  }, {
    objects: 4, localHostUnchanged: true, localPenHost: "shared-host", remoteHostForked: true, pensForNewRemoteHost: 1,
  });
});
