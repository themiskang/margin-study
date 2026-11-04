import { PDFDocument } from "pdf-lib";
import type MarginStudyPlugin from "../main";
import type { MindNode } from "../types";
import { nodeContent } from "../study/nodeContent";
import { imageUrl } from "../review/content";
import { clozeForExport } from "../utils/markdown";

export interface CardFlowOptions { columns: 2 | 3; includeInk: boolean }
export interface CardFlowResult { bytes: Uint8Array; pageCount: number; cardIds: string[] }
const PAGE_W=595.28, PAGE_H=841.89, MARGIN=32, GAP=14, TOP=34, BOTTOM=34, SCALE=2;

/** Traverse all scoped nodes, including folded descendants; references to one card export once. */
export function orderedFlowNodes(nodes: readonly MindNode[]): MindNode[] {
  const byId=new Map(nodes.map(n=>[n.id,n])), children=new Map<string|null,MindNode[]>();
  for(const n of nodes){const parent=n.parentId&&byId.has(n.parentId)?n.parentId:null;const list=children.get(parent)??[];list.push(n);children.set(parent,list);}
  const sort=(a:MindNode,b:MindNode)=>((a.order??Infinity)-(b.order??Infinity))||a.y-b.y||a.x-b.x||a.id.localeCompare(b.id);
  for(const list of children.values())list.sort(sort);
  const result:MindNode[]=[], visited=new Set<string>(), cards=new Set<string>();
  const visit=(n:MindNode)=>{if(visited.has(n.id))return;visited.add(n.id);if(!n.cardId||!cards.has(n.cardId)){result.push(n);if(n.cardId)cards.add(n.cardId);}for(const child of children.get(n.id)??[])visit(child);};
  for(const root of children.get(null)??[])visit(root);for(const node of [...nodes].sort(sort))visit(node);return result;
}

async function loadImage(src:string):Promise<HTMLImageElement>{return new Promise((resolve,reject)=>{const img=new Image();const timer=setTimeout(()=>reject(new Error('图片加载超时')),15000);img.onload=()=>{clearTimeout(timer);resolve(img);};img.onerror=()=>{clearTimeout(timer);reject(new Error('图片无法加载'));};img.src=src;});}
function linesFor(ctx:CanvasRenderingContext2D,text:string,maxWidth:number):string[]{
  const output:string[]=[];for(const paragraph of text.replace(/\r\n?/g,'\n').split('\n')){let line='';for(const token of paragraph.match(/\s+|[^\s]+/gu)??[]){if(ctx.measureText(line+token).width<=maxWidth){line+=token;continue;}if(line.trim()){output.push(line.trimEnd());line='';}if(!token.trim())continue;for(const ch of Array.from(token)){if(line&&ctx.measureText(line+ch).width>maxWidth){output.push(line);line=ch;}else line+=ch;}}output.push(line.trimEnd());}return output;
}
/** Render pages at two pixels per PDF point so Chinese and mixed-script content use the host's fonts. */
export async function buildCardFlowPdf(plugin:MarginStudyPlugin,options:CardFlowOptions):Promise<CardFlowResult>{
  const scoped=plugin.store.getScopedNodes(),nodes=orderedFlowNodes(scoped);if(!nodes.length)throw new Error('脑图为空，没有可导出的内容');
  const pdf=await PDFDocument.create(),cardIds:string[]=[];const colWidth=(PAGE_W-2*MARGIN-GAP*(options.columns-1))/options.columns;
  let canvas!:HTMLCanvasElement,ctx!:CanvasRenderingContext2D;let column=0,y=TOP,pageCount=0;
  const newPage=()=>{canvas=document.createElement('canvas');canvas.width=Math.ceil(PAGE_W*SCALE);canvas.height=Math.ceil(PAGE_H*SCALE);ctx=canvas.getContext('2d')!;ctx.scale(SCALE,SCALE);ctx.fillStyle='#fff';ctx.fillRect(0,0,PAGE_W,PAGE_H);column=0;y=TOP;};
  const savePage=async()=>{const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('PDF 页面编码失败')),'image/png'));const image=await pdf.embedPng(await blob.arrayBuffer());pdf.addPage([PAGE_W,PAGE_H]).drawImage(image,{x:0,y:0,width:PAGE_W,height:PAGE_H});pageCount++;canvas.width=canvas.height=0;};
  const advance=async()=>{if(column+1<options.columns){column++;y=TOP;}else{await savePage();newPage();}};
  const reserve=async(height:number)=>{if(y+height>PAGE_H-BOTTOM)await advance();};
  const x=()=>MARGIN+column*(colWidth+GAP);newPage();
  for(const node of nodes){
    const content=nodeContent(plugin.store,node),card=node.cardId?plugin.store.getCard(node.cardId):undefined;if(node.cardId&&!card)throw new Error(`卡片不存在：${node.cardId}`);
    if(card)cardIds.push(card.id);const title=clozeForExport(content.heading||(!card?node.title:'')||'无标题');
    await reserve(48);ctx.fillStyle='#dedfe3';ctx.fillRect(x(),y,colWidth,1);y+=9;
    const write=async(text:string,bold:boolean)=>{const font=`${bold?'600':'400'} ${bold?12:10.5}px -apple-system, sans-serif`;ctx.font=font;for(const line of linesFor(ctx,clozeForExport(text),colWidth-8)){await reserve(16);ctx.font=font;ctx.fillStyle=bold?'#1d2430':'#30343a';ctx.fillText(line,x()+4,y+11);y+=16;}};
    await write(title,true);if(content.excerpt&&content.excerpt!==title)await write(content.excerpt,false);
    if(content.note)await write(content.note,false);for(const comment of content.comments)await write(comment,false);
    if(card)for(const ref of scoped)if(ref.cardId===card.id&&ref.id!==node.id)for(const comment of ref.comments??[])if(comment)await write(comment,false);
    const skip=new Set(!options.includeInk?(card?.commentMedia??[]).filter(item=>item.kind==='ink').map(item=>item.image):[]);
    for(const source of content.images){if(skip.has(source))continue;let image:HTMLImageElement;try{image=await loadImage(imageUrl(plugin,source));}catch{throw new Error(`卡片「${title}」的图片无法加载，导出已取消`);}if(!image.naturalWidth||!image.naturalHeight)throw new Error(`卡片「${title}」的图片尺寸无效`);
      const factor=Math.min((colWidth-8)/image.naturalWidth,(PAGE_H-TOP-BOTTOM-8)/image.naturalHeight,1),w=image.naturalWidth*factor,h=image.naturalHeight*factor;await reserve(h+6);ctx.drawImage(image,x()+4,y,w,h);y+=h+6;
    }
    y+=10;
  }
  await savePage();pdf.setTitle('MarginStudy 脑图卡片流');pdf.setCreator('MarginStudy');return {bytes:await pdf.save(),pageCount,cardIds};
}
