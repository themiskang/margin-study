import type { ReaderView } from "./readerView";
import { createModal } from "../utils/modal";
import { el } from "../utils/dom";
import { uid } from "../utils/id";

/** Use the desktop Save panel when exposed by Obsidian; otherwise save a named vault copy. */
export async function savePdfExport(reader: ReaderView, bytes: Uint8Array, current: () => void, signal?: AbortSignal, host?: HTMLElement, format: "pdf" | "png" = "pdf"): Promise<string | null> {
  const extension = format === "png" ? "png" : "pdf", label = extension.toUpperCase();
  const file=reader.getFilePath()!.split('/').pop()!,name=file.replace(/\.pdf$/i,'')+`_Flatten.${extension}`,req=(window as any).require;
  let dialog:any=null;
  if (typeof req==='function') {try{dialog=req('@electron/remote')?.dialog;}catch{}if(!dialog)try{dialog=req('electron')?.remote?.dialog;}catch{}}
  if (dialog?.showSaveDialog) {
    const base=(reader.app.vault.adapter as any).getBasePath?.();
    const result=await dialog.showSaveDialog({title:'Export Document',defaultPath:base?base+'/'+name:name,filters:[{name:label,extensions:[extension]}],properties:['createDirectory','showOverwriteConfirmation']});
    current(); if(result.canceled||!result.filePath)return null;
    const target=new RegExp(`\\.${extension}$`,'i').test(result.filePath)?result.filePath:result.filePath+'.'+extension,fs=req('fs').promises,path=req('path');
    // The native panel confirms replacement only for the exact path it returns.
    // A suffix added below has not received that confirmation, so keep no-clobber there.
    const confirmedTarget=target===result.filePath;
    const source=base?path.resolve(base,reader.getFilePath()!):null;
    if(source){
      if(path.resolve(target)===source)throw new Error('不能覆盖正在阅读的源文件，请使用新的导出文件名');
      const identity=async(filePath:string)=>{try{return await fs.stat(filePath);}catch(error:any){if(error?.code==='ENOENT')return null;throw error;}};
      const [sourceStat,targetStat]=await Promise.all([identity(source),identity(target)]);
      if(sourceStat&&targetStat&&sourceStat.dev===targetStat.dev&&sourceStat.ino===targetStat.ino)throw new Error('不能覆盖正在阅读的源文件，请使用新的导出文件名');
    }
    const temporary=path.join(path.dirname(target),'.marginstudy-export-'+uid()+'.tmp');
    try {
      await fs.writeFile(temporary,bytes,{flag:'wx'});current();
      // Atomic replacement honours the user's native Save/Replace choice.
      // Never unlink the previous export before the new bytes are ready.
      if(confirmedTarget)await fs.rename(temporary,target);
      else await fs.link(temporary,target);
      return target;
    } catch(error:any) {if(error?.code==='EEXIST')throw new Error('该文件已存在，请使用新的导出文件名');throw error;}
    finally {await fs.unlink(temporary).catch(()=>{});}
  }
  return new Promise(resolve=>{
    let saved=false,closed=false,writing=false;
    const blockDismiss=(event:Event)=>{if(writing&&(event instanceof KeyboardEvent?event.key==='Escape':event.target===bg)){event.preventDefault();event.stopImmediatePropagation();}};
    const {bg,modal,close}=createModal('Save '+label,()=>{if(closed)return;closed=true;signal?.removeEventListener('abort',close);document.removeEventListener('keydown',blockDismiss,true);if(!saved&&!writing)resolve(null);});
    modal.setAttribute('role','dialog');modal.setAttribute('aria-label','Save '+label);modal.setAttribute('aria-modal','true');host?.append(bg);signal?.addEventListener('abort',close,{once:true});
    document.addEventListener('keydown',blockDismiss,true);bg.addEventListener('mousedown',blockDismiss,true);
    const active=()=>{current();if(closed||signal?.aborted)throw new Error('导出已取消');};
    const nameLabel=el('label',{text:'Save As:'}),input=el('input',{value:name,'aria-label':`Export ${label} Filename`}),status=el('p',{role:'status'}),actions=el('div',{class:'ms-modal-actions'});
    nameLabel.append(input);const cancel=el('button',{text:'Cancel'}),save=el('button',{text:'Save',class:'mod-cta'});
    cancel.addEventListener('click',close);save.addEventListener('click',()=>{if(save.disabled)return;save.disabled=true;void(async()=>{
      try{active();const filename=input.value.trim();if(!filename||/[\\/:*?"<>|\u0000-\u001f]/.test(filename)||/^\./.test(filename))throw new Error(`请输入有效的 ${label} 文件名`);
        const folder='MarginStudyExports',path=folder+'/'+filename.replace(new RegExp(`\\.${extension}$`,'i'),'')+'.'+extension;
        if(await reader.app.vault.adapter.exists(path))throw new Error('该文件已存在，请使用新的文件名');active();
        if(!await reader.app.vault.adapter.exists(folder)){try{await reader.app.vault.createFolder(folder);}catch(error){if(!await reader.app.vault.adapter.exists(folder))throw error;}}
        active();
        // Once the vault write is issued it cannot be cancelled; keep its outcome observable.
        writing=true;cancel.disabled=true;input.disabled=true;status.textContent='Saving…';
        const result=await reader.app.vault.createBinary(path,bytes.slice().buffer as ArrayBuffer);saved=true;resolve(result.path);close();
      }catch(error){if(closed){resolve(null);return;}status.textContent=error instanceof Error?error.message:String(error);save.disabled=false;cancel.disabled=false;input.disabled=false;}
      finally{writing=false;}
    })();});actions.append(cancel,save);modal.append(nameLabel,el('p',{text:'MarginStudyExports/'}),status,actions);input.focus();input.select();
  });
}
