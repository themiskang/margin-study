import { App, TFile } from "obsidian";

function checkCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException("转写已取消", "AbortError");
}

/** Local whisper.cpp process only. No network client, API key or permission request. */
export async function transcribeVoice(app: App, audioPath: string, signal: AbortSignal,
  progress: (message: string) => void = () => {}): Promise<string> {
  checkCancelled(signal);
  const require = (window as any).require;
  const base = (app.vault.adapter as any).getBasePath?.();
  if (!require || !base) throw new Error("本地自动转写需要桌面版及本地转写组件");
  const fs = (require("fs") as typeof import("fs")).promises;
  const path = require("path") as typeof import("path");
  const os = require("os") as typeof import("os");
  const cp = require("child_process") as typeof import("child_process");
  const runtime = path.join(base, app.vault.configDir, "plugins", "margin-study", "native", "transcription");
  const executable = path.join(runtime, "whisper-cli"), model = path.join(runtime, "ggml-tiny.bin");
  try { await fs.access(executable); await fs.access(model); }
  catch { throw new Error("本地转写组件未安装或不完整；录音仍保留，可先粘贴转写文字"); }
  checkCancelled(signal);
  const file = app.vault.getAbstractFileByPath(audioPath);
  if (!(file instanceof TFile)) throw new Error("录音文件不存在；未修改已有转写");
  if (file.stat.size > 50 * 1024 * 1024) throw new Error("本地转写暂支持50 MB内的音频，请先分段");
  progress("正在本机解码音频…");
  const bytes = await app.vault.readBinary(file);
  checkCancelled(signal);
  const decoder = new OfflineAudioContext(1, 1, 16000);
  const audio = await decoder.decodeAudioData(bytes.slice(0));
  checkCancelled(signal);
  if (!audio.length || audio.duration > 900) throw new Error("本地转写暂支持15分钟内的音频，请先分段");
  const pcm = new ArrayBuffer(44 + audio.length * 2), view = new DataView(pcm);
  const ascii = (offset: number, value: string) => { for (let i=0;i<value.length;i++) view.setUint8(offset+i,value.charCodeAt(i)); };
  ascii(0,"RIFF"); view.setUint32(4,36+audio.length*2,true); ascii(8,"WAVE"); ascii(12,"fmt ");
  view.setUint32(16,16,true); view.setUint16(20,1,true); view.setUint16(22,1,true);
  view.setUint32(24,16000,true); view.setUint32(28,32000,true); view.setUint16(32,2,true); view.setUint16(34,16,true);
  ascii(36,"data"); view.setUint32(40,audio.length*2,true);
  const channels = Array.from({length:audio.numberOfChannels},(_,i)=>audio.getChannelData(i));
  for (let i=0;i<audio.length;i++) {
    const sample=Math.max(-1,Math.min(1,channels.reduce((sum,channel)=>sum+channel[i],0)/channels.length));
    view.setInt16(44+i*2,Math.round(sample*(sample<0?32768:32767)),true);
  }
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "marginstudy-asr-"));
  try {
    checkCancelled(signal);
    const input=path.join(temporary,"audio.wav"), output=path.join(temporary,"transcript");
    await fs.writeFile(input,new Uint8Array(pcm),{mode:0o600});
    checkCancelled(signal); progress("正在本机识别（Tiny模型，结果请校对）…");
    await new Promise<void>((resolve,reject)=>{
      let child: ReturnType<typeof cp.execFile> | null = null;
      const abort=()=>{child?.kill();};
      signal.addEventListener("abort",abort,{once:true});
      try {
        child=cp.execFile(executable,["-m",model,"-f",input,"-l","auto","-nt","-np","-otxt","-of",output],
          {timeout:300000,maxBuffer:4*1024*1024,encoding:"utf8"},error=>{
            signal.removeEventListener("abort",abort);
            if(signal.aborted)reject(new DOMException("转写已取消","AbortError"));
            else if(error)reject(new Error("本地转写失败；原录音与已保存文字未改。" + error.message));
            else resolve();
          });
        if(signal.aborted)abort();
      } catch(error) {signal.removeEventListener("abort",abort);reject(error);}
    });
    checkCancelled(signal);
    const text=(await fs.readFile(output+".txt","utf8")).trim();
    if(!text || /^\[(?:blank_audio|silence|music)\]$/i.test(text))throw new Error("未识别到可用语音；原录音与已有文字未改，可重试");
    return text;
  } finally { await fs.rm(temporary,{recursive:true,force:true}).catch(()=>{}); }
}
