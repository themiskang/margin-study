/** Reorder only a clear two-column body. Absolute glyph positions never change.
 * A crossing body span or fewer than three rows leaves the producer order intact. */
export function orderTextColumns(layer:HTMLElement,viewport:{width:number;rotation?:number}):void {
  if((viewport.rotation??0)%180)return;
  const spans=[...layer.children].filter((node):node is HTMLElement=>node instanceof HTMLElement&&node.tagName==="SPAN"&&!!node.textContent?.trim());
  if(spans.length<6)return;
  const bounds=layer.getBoundingClientRect(),items=spans.map(node=>({node,box:node.getBoundingClientRect()})),height=items.reduce((sum,item)=>sum+item.box.height,0)/items.length;
  // Infer gutters from neighbouring glyph runs on the same line. A fixed
  // page midpoint misses asymmetric columns and changes with longer rows.
  const gap=viewport.width*.025,candidates=[.5,.4,.6].map(ratio=>bounds.left+viewport.width*ratio);
  for(const a of items)for(const b of items){
    if(Math.abs(a.box.top-b.box.top)<height*.4&&b.box.left-a.box.right>=gap*2)candidates.push((a.box.right+b.box.left)/2);
  }
  let best:typeof items|null=null,bestSize=0;
  for(const mid of candidates){
    const left=items.filter(item=>item.box.right<=mid-gap),right=items.filter(item=>item.box.left>=mid+gap);
    if(left.length<3||right.length<3)continue;
    const top=Math.max(Math.min(...left.map(item=>item.box.top)),Math.min(...right.map(item=>item.box.top))),bottom=Math.min(Math.max(...left.map(item=>item.box.bottom)),Math.max(...right.map(item=>item.box.bottom)));
    if(bottom-top<height*2)continue;
    const body=items.filter(item=>item.box.top>=top-1&&item.box.bottom<=bottom+1),set=new Set(body);
    if(body.some(item=>!left.includes(item)&&!right.includes(item)))continue;
    const byLine=(a:typeof items[number],b:typeof items[number])=>Math.abs(a.box.top-b.box.top)>height*.4?a.box.top-b.box.top:a.box.left-b.box.left;
    const first=items.findIndex(item=>set.has(item)),last=items.length-1-[...items].reverse().findIndex(item=>set.has(item));
    if(items.slice(first,last+1).some(item=>!set.has(item)))continue;
    const ordered=[...items.slice(0,first),...body.filter(item=>left.includes(item)).sort(byLine),...body.filter(item=>right.includes(item)).sort(byLine),...items.slice(last+1)];
    if(body.length>bestSize){best=ordered;bestSize=body.length;}
  }
  if(best){
    // PDF.js emits line endings as sibling elements. Keep each one with its
    // glyph span so native Range selection follows the reordered lines.
    const endings=new Map(best.map(item=>[item.node,item.node.nextElementSibling?.tagName==="BR"?item.node.nextElementSibling:null]));
    for(const item of best){layer.append(item.node);const ending=endings.get(item.node);if(ending)layer.append(ending);}
  }
}
