import { AiError } from "./contracts";
import { AiService } from "./service";

export type CondenseLevel = "sentence" | "points" | "outline";
export interface CondenseInput { text: string; images?: string[]; level: CondenseLevel; language: string; signal?: AbortSignal; }
export interface CondenseResult { text: string; cached: boolean; model: string; service: string; }
type Pending = { controller: AbortController; promise: Promise<CondenseResult>; users: number };
const instructions: Record<CondenseLevel,string> = {
  sentence: "用一句话概括。",
  points: "用简洁的要点概括。",
  outline: "按主题和层次整理脉络。",
};
const canceled = () => new AiError("aborted", "已取消浓缩。");
function serviceName(endpoint:string):string { try{return new URL(endpoint).host||"自定义服务";}catch{return "自定义服务";} }

/** Cache only completed results; display style never enters the request or cache key. */
export class CondenseService {
  private readonly cache = new Map<string, CondenseResult>();
  private readonly pending = new Map<string, Pending>();
  constructor(private readonly ai: AiService) {}
  status(): {service:string;model:string;bound:boolean} {
    const profile=this.ai.configuration();return {service:serviceName(profile.endpoint),model:profile.normalModel,bound:this.ai.isBound()};
  }
  async request(input: CondenseInput): Promise<CondenseResult> {
    if (input.signal?.aborted) throw canceled();
    const text=input.text.trim(),language=input.language.trim(),images=[...(input.images??[])];
    if ((!text&&!images.length) || !language || !Object.prototype.hasOwnProperty.call(instructions,input.level)) throw new AiError("empty","请选择文字或图片、浓缩档位和语言。");
    if(images.length>4||images.some(image=>!/^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(image))||images.reduce((sum,image)=>sum+image.length,0)>12*1024*1024)throw new AiError("image","最多附加 4 张图片，总大小不超过约 9 MB。");
    const profile=this.ai.configuration();
    if (!this.ai.isBound()) throw new AiError("unbound","请先在 AI 设置中测试并绑定自定义服务。");
    const material=JSON.stringify([text,images,input.level,language,profile.id,profile.revision,profile.endpoint,profile.normalModel]);
    const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(material));
    if (input.signal?.aborted) throw canceled();
    const key=Array.from(new Uint8Array(digest),value=>value.toString(16).padStart(2,"0")).join("");
    const current=this.ai.configuration();
    if(current.id!==profile.id||current.revision!==profile.revision||!this.ai.isBound())throw new AiError("changed","AI 配置已变化，请重新发起浓缩。");
    const hit=this.cache.get(key);if(hit)return {...hit,cached:true};
    let pending=this.pending.get(key);
    if(!pending){
      const controller=new AbortController();
      const promise=this.ai.request({task:"condense",tier:"normal",text:`${instructions[input.level]} 输出语言：${language}。`,context:{text},images,signal:controller.signal}).then(response=>{
        if(controller.signal.aborted)throw canceled();
        const latest=this.ai.configuration();
        if(latest.id!==profile.id||latest.revision!==profile.revision||!this.ai.isBound())throw new AiError("changed","AI 配置已变化，请重新发起浓缩。");
        const result={text:response.text.trim(),cached:false,model:profile.normalModel,service:serviceName(profile.endpoint)};
        if(!result.text)throw new AiError("empty-result","服务未返回浓缩结果。");
        this.cache.set(key,result);return result;
      });
      pending={controller,promise,users:0};this.pending.set(key,pending);
      const job=pending;void promise.then(()=>{if(this.pending.get(key)===job)this.pending.delete(key);},()=>{if(this.pending.get(key)===job)this.pending.delete(key);});
    }
    const job=pending;job.users++;
    return new Promise((resolve,reject)=>{
      let done=false;
      const finish=()=>{if(done)return false;done=true;input.signal?.removeEventListener("abort",abort);job.users--;return true;};
      const abort=()=>{if(!finish())return;if(job.users===0){if(this.pending.get(key)===job)this.pending.delete(key);job.controller.abort();}reject(canceled());};
      input.signal?.addEventListener("abort",abort,{once:true});
      if(input.signal?.aborted){abort();return;}
      job.promise.then(result=>{if(finish())resolve({...result});},error=>{if(finish())reject(error);});
    });
  }
}
const services=new WeakMap<AiService,CondenseService>();
export function condenseServiceFor(ai:AiService):CondenseService {
  let service=services.get(ai);if(!service){service=new CondenseService(ai);services.set(ai,service);}return service;
}
