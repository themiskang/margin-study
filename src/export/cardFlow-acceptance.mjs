import { runUIAcceptance } from '../study/ui-acceptance-runner.mjs';
await runUIAcceptance({fixtureName:'../export/cardFlow-fixture.txt',prefix:'marginstudy-card-flow',label:'Card flow PDF'});
