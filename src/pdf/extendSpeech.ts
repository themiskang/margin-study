import { Notice, setIcon } from "obsidian";
import { createSpeechSession, speechTextFromMarkdown } from "../audio/speech";
import { el } from "../utils/dom";

/** A transient owned queue: leaving the Reader stops this paper, never another owner. */
export function openExtendSpeech(parent: HTMLElement, text: string, label = "留白朗读"): () => void {
  const paragraphs=speechTextFromMarkdown(text).split(/\n+/).map(value=>value.trim()).filter(Boolean);
  if(!paragraphs.length){new Notice("当前留白没有可朗读的文字");return()=>{};}
  const session=createSpeechSession("extend-"+crypto.randomUUID());
  const root=el("div",{class:"ms-extend-speech",role:"toolbar","aria-label":label});
  let index=0,epoch=0,closed=false;
  const button=(label:string,icon:string,action:()=>void)=>{const node=el("button",{"aria-label":label,title:label});setIcon(node,icon);node.addEventListener("click",action);root.append(node);return node;};
  const close=()=>{if(closed)return;closed=true;epoch++;unsubscribe();session.dispose();root.remove();};
  button("关闭朗读","x",close);
  const pause=button("暂停朗读","pause",()=>{const state=session.state.status;if(state==="paused")session.resume();else if(state==="speaking"||state==="preparing")session.pause();else play(index);});
  button("上一段","rewind",()=>play(Math.max(0,index-1)));
  const next=button("下一段","fast-forward",()=>{if(index<paragraphs.length-1)play(index+1);});
  const draw=()=>{const state=session.state.status,label=state==="paused"?"继续朗读":["finished","stopped","error"].includes(state)?"重新朗读":"暂停朗读";pause.setAttribute("aria-label",label);pause.title=label;setIcon(pause,label==="暂停朗读"?"pause":"play");next.disabled=index>=paragraphs.length-1;};
  const play=(from:number)=>{index=from;const current=++epoch;void session.start(async function*(){for(let part=from;part<paragraphs.length;part++){if(closed||current!==epoch)return;index=part;draw();yield{text:paragraphs[part]};}}).then(started=>{if(!started&&!closed&&session.state.error)new Notice(session.state.error);});};
  const unsubscribe=session.subscribe(draw);parent.append(root);play(0);return close;
}
