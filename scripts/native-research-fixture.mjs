// Local synthetic pages for manual acceptance in real Obsidian. No vault access.
import {createServer} from 'node:http';
const server=createServer((req,res)=>{
  const second=new URL(req.url,'http://127.0.0.1').pathname==='/second';
  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.end(`<!doctype html><html lang="en"><meta charset="utf-8"><title>MarginStudy Native Research ${second?'B':'A'}</title><style>body{font:18px/1.65 -apple-system,sans-serif;padding:28px;color:#263548}h1{font-size:27px;line-height:1.3}a{color:#2869ce}p{max-width:65ch}aside{background:#e8eff9;padding:18px;border-radius:8px}</style><h1>MarginStudy Native Research ${second?'B':'A'}</h1><p>This page contains only synthetic acceptance content.</p><aside>${second?'The second page verifies navigation history.':'This document verifies reading, local navigation and PDF capture.'}</aside><p><a href="${second?'/':'/second'}">${second?'Return to page A':'Continue to page B'}</a></p><p>Evidence marker: RESEARCH-${second?'BETA':'ALPHA'}-20261016</p></html>`);
});
server.listen(0,'127.0.0.1',()=>console.log(`Synthetic research URL: http://127.0.0.1:${server.address().port}/`));
process.on('SIGTERM',()=>server.close());
