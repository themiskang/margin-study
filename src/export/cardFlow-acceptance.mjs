import { runUIAcceptance } from '../study/ui-acceptance-runner.mjs';
await runUIAcceptance({fixtureName:'../export/cardFlow-fixture.txt',prefix:'marginstudy-card-flow',label:'Card flow PDF',pdfArtifactPath:'evidence/mn5-alignment-20261029/a25-execution-20261103/card-flow-synthetic.pdf'});
