import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
const file=process.argv[2];if(!/^[a-z0-9-]+$/.test(file||''))throw Error('invalid capture name');
const data=execFileSync('/Applications/O+Connect.app/Contents/Resources/daemon/bin/adb',['exec-out','screencap','-p'],{maxBuffer:25*1024*1024});writeFileSync(`/private/tmp/a30-oppo-${file}.png`,data);console.log('captured',file,data.length);
