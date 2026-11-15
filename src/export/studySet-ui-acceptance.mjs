import { runUIAcceptance } from "../study/ui-acceptance-runner.mjs";

await runUIAcceptance({ fixtureName: "../export/studySet-ui-fixture.txt", prefix: "marginstudy-set-ui", label: "Study set export menu" });
