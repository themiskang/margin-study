/** L4-observed interaction contracts; does not control MarginNote or the user vault. */
import { runUIAcceptance } from "./ui-acceptance-runner.mjs";
await runUIAcceptance({ fixtureName: "l4-ui-fixture.txt", prefix: "marginstudy-l4-ui", label: "L4-aligned" });
