import { runUIAcceptance } from "../study/ui-acceptance-runner.mjs";

await runUIAcceptance({ fixtureName: "../search/global-fixture.txt", prefix: "marginstudy-global-search", label: "Global search categories" });
