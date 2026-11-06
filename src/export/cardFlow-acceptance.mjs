import { runUIAcceptance } from '../study/ui-acceptance-runner.mjs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
await runUIAcceptance({fixtureName:'../export/cardFlow-fixture.txt',prefix:'marginstudy-card-flow',label:'Card flow PDF',pdfArtifactPath:join(process.env.MARGINSTUDY_VERIFY_DIR || tmpdir(),'card-flow-synthetic.pdf')});
