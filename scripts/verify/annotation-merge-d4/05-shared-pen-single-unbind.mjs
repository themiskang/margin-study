import { freshKeyOrder, run } from "./fixture-support.mjs";

await run("05", async (setup, check) => {
  const reversed = await freshKeyOrder(setup, "deleted", true);
  check("same-ID shared pen and same unbind fact", {
    objects: reversed.annotations,
    eventCount: reversed.eventCount,
  }, {
    objects: [
      {id: "deleted", type: "note", host: null, text: ""},
      {id: "shared", type: "pen", host: null, text: ""},
    ],
    eventCount: 1,
  });
});
