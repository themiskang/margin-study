/** Canvas ink behavior in an isolated browser with an in-memory library. */
import { runUIAcceptance } from "../study/ui-acceptance-runner.mjs";
await runUIAcceptance({ fixtureName: "../mindmap/handwriting-fixture.txt", prefix: "marginstudy-map-ink", label: "Mind-map handwriting" });
