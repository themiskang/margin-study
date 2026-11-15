import { runUIAcceptance } from "../study/ui-acceptance-runner.mjs";

await import("./ink-points-acceptance.mjs");
await runUIAcceptance({ fixtureName: "../review/long-card-fixture.txt", prefix: "marginstudy-long-card", label: "Long card" });
