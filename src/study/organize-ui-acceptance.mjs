/** Official-manual behavior; isolated synthetic browser, not native app L4. */
import { runUIAcceptance } from "./ui-acceptance-runner.mjs";
await runUIAcceptance({ fixtureName: "organize-ui-fixture.txt", prefix: "marginstudy-organize-ui", label: "Outline/board/native chrome" });
