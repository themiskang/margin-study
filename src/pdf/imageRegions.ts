import { pdfjsLib } from './pdfjs';
import type { PdfRect } from '../types';
/** PDF image bounds from the public operator stream; all coordinates remain in source PDF units. */
export async function pdfImageRegions(page:any):Promise<PdfRect[]> {
  if(typeof page.getOperatorList!=='function')return [];
  const ops=await page.getOperatorList(),O=pdfjsLib.OPS,identity=[1,0,0,1,0,0];let matrix=identity.slice();const stack:number[][]=[],result:PdfRect[]=[];
  const multiply=(a:number[],b:number[])=>[a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];
  for(let i=0;i<Math.min(ops.fnArray.length,200000)&&result.length<100;i++){
    const op=ops.fnArray[i],args=ops.argsArray[i];
    if(op===O.save){stack.push(matrix.slice());continue;}
    if(op===O.restore){matrix=stack.pop()??identity.slice();continue;}
    if(op===O.transform){matrix=multiply(matrix,args);continue;}
    if(op===O.paintFormXObjectBegin){stack.push(matrix.slice());if(args[0])matrix=multiply(matrix,args[0]);continue;}
    if(op===O.paintFormXObjectEnd){matrix=stack.pop()??identity.slice();continue;}
    if(op!==O.paintImageXObject&&op!==O.paintInlineImageXObject)continue;
    const points=[[0,0],[0,1],[1,0],[1,1]].map(([x,y])=>[matrix[0]*x+matrix[2]*y+matrix[4],matrix[1]*x+matrix[3]*y+matrix[5]]),xs=points.map(p=>p[0]),ys=points.map(p=>p[1]),x=Math.min(...xs),y=Math.min(...ys),w=Math.max(...xs)-x,h=Math.max(...ys)-y;
    if([x,y,w,h].every(Number.isFinite)&&w>1&&h>1&&!result.some(r=>Math.abs(r.x-x)<.1&&Math.abs(r.y-y)<.1&&Math.abs(r.w-w)<.1&&Math.abs(r.h-h)<.1))result.push({x,y,w,h});
  }return result;
}
