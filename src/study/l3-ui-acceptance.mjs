/** Existing L3 contracts; synthetic data in an isolated browser. */
import { runUIAcceptance } from "./ui-acceptance-runner.mjs";
await runUIAcceptance({ fixtureName: "l3-ui-fixture.txt", prefix: "marginstudy-l3-ui", label: "L3" });
