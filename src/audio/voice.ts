import { createModal } from "../utils/modal";
import { el } from "../utils/dom";
import { App, Notice, TFile } from "obsidian";

/** 录音控制器：用 MediaRecorder 采集麦克风，停止后返回 Blob。两端（桌面+平板）通用。 */
export class VoiceRecorder {
  private rec: any = null;
  private chunks: BlobPart[] = [];
  private stream: MediaStream | null = null;
  private active = false;
  private starting: Promise<void> | null = null;
  private result: Promise<Blob> | null = null;
  private stopping = false;

  get isRecording(): boolean {
    return this.active;
  }

  start(deviceId?: string): Promise<void> {
    if (this.starting) return this.starting;
    if (this.active) return Promise.resolve();
    const task = this.begin(deviceId);
    this.starting = task.finally(() => { this.starting = null; });
    return this.starting;
  }

  private async begin(deviceId?: string): Promise<void> {
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices ||
      !navigator.mediaDevices.getUserMedia ||
      typeof (window as any).MediaRecorder === "undefined"
    ) {
      throw new Error("当前环境不支持录音（需要麦克风权限）");
    }
    this.result = null;
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: deviceId ? {deviceId:{exact:deviceId}} : true });
    const MR = (window as any).MediaRecorder;
    const mime = ["audio/webm", "audio/mp4", "audio/ogg"].find((m) => MR.isTypeSupported?.(m)) || "";
    try {
      this.rec = mime ? new MR(this.stream, { mimeType: mime }) : new MR(this.stream);
      this.chunks = [];
      this.stopping = false;
      const rec = this.rec;
      this.result = new Promise<Blob>((resolve, reject) => {
        let completed = false;
        const finish = (error?: Error) => {
          if (completed) return;
          completed = true;
          const blob = new Blob(this.chunks, { type: rec.mimeType || mime || "audio/webm" });
          rec.ondataavailable = rec.onstop = rec.onerror = null;
          this.cleanup();
          if (blob.size) resolve(blob);
          else reject(error ?? new Error("未录到音频，请检查输入设备后重试"));
        };
        rec.onstop = () => finish();
        rec.onerror = (event: any) => {
          // MediaRecorder emits the final data and stop after a device error.
          // Keep any partial recording available rather than losing its bytes.
          new Notice("录音设备中断，已录内容将在停止后保留");
          if (rec.state === "inactive") return;
          try { this.stopping = true; rec.stop(); }
          catch { finish(event.error ?? new Error("录音设备出错")); }
        };
      });
      // A device can end before the user presses stop; retain its settled result.
      void this.result.catch(() => {});
      this.rec.ondataavailable = (e: any) => {
        if (e.data && e.data.size > 0) this.chunks.push(e.data);
      };
      this.rec.start();
      this.active = true;
    } catch (error) {
      this.cleanup();
      throw error;
    }
  }

  /** 停止并返回音频 Blob。 */
  async stop(): Promise<Blob> {
    if (this.starting) await this.starting;
    if (!this.result) throw new Error("未在录音");
    if (this.rec && this.active && !this.stopping) {
      this.stopping = true;
      try { this.rec.stop(); } catch (error) { this.cleanup(); throw error; }
    }
    return this.result;
  }

  private cleanup(): void {
    this.active = false;
    this.stream?.getTracks().forEach((t: MediaStreamTrack) => t.stop());
    this.stream = null;
    this.rec = null;
  }
}

/** Select an input for this recording without changing the system default. */
export async function chooseVoiceInput(): Promise<string | undefined | null> {
  const devices = await navigator.mediaDevices?.enumerateDevices?.().catch(() => []) ?? [];
  const inputs = devices.filter(device => device.kind === "audioinput" && device.deviceId !== "communications");
  const physical = inputs.filter(device => device.deviceId !== "default");
  if (physical.length <= 1) return physical[0]?.deviceId || undefined;
  return new Promise(resolve => {
    let selected = false;
    const {modal,close}=createModal("选择录音输入",()=>{if(!selected)resolve(null);});
    modal.setAttribute("role","dialog");modal.setAttribute("aria-label","选择录音输入");
    const input=el("select",{"aria-label":"录音输入设备"}) as HTMLSelectElement;
    inputs.forEach((device,index)=>input.add(new Option(device.label || `输入设备 ${index+1}`,device.deviceId)));
    const start=el("button",{text:"开始录音","aria-label":"确认输入并开始录音"});
    start.addEventListener("click",()=>{selected=true;close();resolve(input.value||undefined);});
    const cancel=el("button",{text:"取消"});cancel.addEventListener("click",close);
    modal.append(el("p",{text:"仅用于此次录音。录音保存在本地，不会上传。"}),input,start,cancel);
  });
}

function audioExt(blob: Blob): string {
  const t = (blob.type || "").toLowerCase();
  if (t.includes("mp4")) return "m4a";
  if (t.includes("ogg")) return "ogg";
  if (t.includes("webm")) return "webm";
  return "webm";
}

/** 把录音保存到 vault 附件目录，返回相对 vault 的路径。 */
export async function saveVoiceBlob(app: App, docPath: string, blob: Blob): Promise<string> {
  if (!blob.size) throw new Error("未录到音频，请重试");
  try { return await writeVoiceBlob(app, docPath, blob); }
  catch (error) {
    // Keep the original Blob alive while retrying. A document release awaits
    // this operation, so a retry cannot attach audio to a different source.
    return new Promise<string>((resolve, reject) => {
      let saved = false;
      const {modal, close} = createModal("录音尚未保存", () => {
        if (!saved) reject(new Error("已放弃未保存录音"));
      });
      modal.setAttribute("role", "dialog"); modal.setAttribute("aria-label", "录音保存恢复");
      const status = el("p", {role:"status", text:"保存失败：" + String(error) + "。录音仍保留，可重试；关闭此窗口会放弃未保存录音。"});
      const retry = el("button", {text:"重试保存", "aria-label":"重试保存录音"}) as HTMLButtonElement;
      retry.addEventListener("click", () => {
        retry.disabled = true;
        void writeVoiceBlob(app, docPath, blob).then(path => {
          saved = true; close(); resolve(path);
        }, next => { status.textContent = "仍未保存：" + String(next) + "。录音仍保留，可再次重试。"; retry.disabled = false; });
      });
      const discard=el("button", {text:"放弃此次录音"});discard.addEventListener("click", close);
      modal.append(status,retry,discard);
    });
  }
}

async function writeVoiceBlob(app: App, docPath: string, blob: Blob): Promise<string> {
  const base = docPath.replace(/\.[^.]+$/, "");
  const folder = "_marginstudy-audio";
  if (!app.vault.getAbstractFileByPath(folder)) {
    try { await app.vault.createFolder(folder); } catch (error) {
      // 两个阅读窗口同时首次录音时，另一个窗口可能已创建目录。
      if (!app.vault.getAbstractFileByPath(folder)) throw error;
    }
  }
  const name = `${base.split("/").pop()}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${audioExt(blob)}`;
  const rel = `${folder}/${name}`;
  const buf = await blob.arrayBuffer();
  const existing = app.vault.getAbstractFileByPath(rel);
  if (existing instanceof TFile) await app.vault.modifyBinary(existing, buf);
  else await app.vault.createBinary(rel, buf);
  return rel;
}

/** User-controlled media playback. Closing/unloading revokes the local URL. */
export async function openMediaPlayer(app: App, mediaPath: string, kind: "audio" | "video" = "audio"):Promise<()=>void> {
  const file=app.vault.getAbstractFileByPath(mediaPath);
  if(!(file instanceof TFile)){new Notice("媒体文件不存在："+mediaPath);return()=>{};}
  const bytes=await app.vault.readBinary(file),url=URL.createObjectURL(new Blob([bytes],{type:mediaMime(file.extension,kind)}));
  const player=document.createElement(kind);player.controls=true;player.preload="metadata";player.src=url;player.style.cssText="width:100%;max-height:60vh";
  const {modal,close}=createModal(file.name,()=>{player.pause();player.removeAttribute("src");player.load();URL.revokeObjectURL(url);});
  modal.setAttribute("aria-label","媒体播放器");modal.setAttribute("role","dialog");
  const status=el("p",{role:"status",text:file.name}),dismiss=el("button",{text:"关闭","aria-label":"关闭媒体播放器"});dismiss.addEventListener("click",close);
  player.addEventListener("error",()=>{status.textContent="无法播放此媒体，请检查文件格式或文件是否损坏";});modal.append(player,status,dismiss);return close;
}
function mediaMime(extension:string,kind:"audio"|"video"):string {
  return ({mp3:"audio/mpeg",m4a:"audio/mp4",wav:"audio/wav",ogg:"audio/ogg",mp4:"video/mp4",m4v:"video/mp4",mov:"video/quicktime",webm:kind+"/webm"} as Record<string,string>)[extension.toLowerCase()]??kind+"/"+extension;
}
export function mediaFileKind(file:File):"audio"|"video" {
  const ext=file.name.split(".").pop()?.toLowerCase()??"";
  if(!file.size||file.size>200*1024*1024||!['mp3','m4a','wav','ogg','mp4','m4v','mov','webm'].includes(ext))throw new Error("请选择 200 MB 内的 MP3、M4A、WAV、OGG、MP4、MOV 或 WebM 音视频");
  return file.type.startsWith("video/")||['mp4','m4v','mov'].includes(ext)?"video":"audio";
}
export async function saveMediaFile(app:App,file:File):Promise<string> {
  mediaFileKind(file);const folder="_marginstudy-media";
  if(!app.vault.getAbstractFileByPath(folder)){try{await app.vault.createFolder(folder);}catch(error){if(!app.vault.getAbstractFileByPath(folder)&&!await app.vault.adapter.exists(folder))throw error;}}
  const ext=file.name.split(".").pop()!.toLowerCase(),path=`${folder}/media-${Date.now()}-${Math.random().toString(36).slice(2,10)}.${ext}`;
  await app.vault.createBinary(path,await file.arrayBuffer());return path;
}
/** Backward-compatible audio entry, now opens transport controls instead of an unowned Audio. */
export async function playVoice(app:App,audioPath:string):Promise<()=>void>{return openMediaPlayer(app,audioPath,"audio");}
