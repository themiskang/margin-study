export const RESEARCH_MODES = [
  { id: "video", label: "Video Search" }, { id: "text", label: "Text Search" },
  { id: "image", label: "Image Search" }, { id: "scholar", label: "Scholar Search" },
  { id: "question", label: "Question Search" }, { id: "dictionary", label: "Dictionary Search" },
  { id: "pdf", label: "PDF Search" }, { id: "translate", label: "Translate" },
] as const;
export type ResearchMode = typeof RESEARCH_MODES[number]["id"];
export interface ResearchEngine { id: string; mode: ResearchMode; name: string; url: string; }
export interface ResearchPreferences {
  mode: ResearchMode;
  order: ResearchMode[];
  engines: ResearchEngine[];
  selected: Partial<Record<ResearchMode, string>>;
  locked: boolean;
}
const ENGINES: ResearchEngine[] = [
  { id: "bilibili", mode: "video", name: "BiliBili", url: "https://search.bilibili.com/all?keyword=%s" },
  { id: "youtube", mode: "video", name: "YouTube", url: "https://www.youtube.com/results?search_query=%s" },
  { id: "bing", mode: "text", name: "Bing", url: "https://www.bing.com/search?q=%s" },
  { id: "baidu", mode: "text", name: "百度", url: "https://www.baidu.com/s?wd=%s" },
  { id: "bing-images", mode: "image", name: "Bing Images", url: "https://www.bing.com/images/search?q=%s" },
  { id: "google-scholar", mode: "scholar", name: "Google Scholar", url: "https://scholar.google.com/scholar?q=%s" },
  { id: "baidu-scholar", mode: "scholar", name: "百度学术", url: "https://xueshu.baidu.com/s?wd=%s" },
  { id: "zhihu", mode: "question", name: "知乎", url: "https://www.zhihu.com/search?type=content&q=%s" },
  { id: "youdao", mode: "dictionary", name: "有道词典", url: "https://www.youdao.com/result?word=%s&lang=en" },
  { id: "bing-pdf", mode: "pdf", name: "Bing PDF", url: "https://www.bing.com/search?q=filetype%3Apdf%20%s" },
  { id: "google-translate", mode: "translate", name: "Google Translate", url: "https://translate.google.com/?sl=auto&tl=zh-CN&text=%s&op=translate" },
];
export function researchUrl(value: string): string {
  const url = new URL(value);
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) throw new Error("请输入不含登录凭据的 http 或 https 地址。");
  return url.href;
}
export function validateEngine(engine: ResearchEngine): ResearchEngine {
  if (!RESEARCH_MODES.some(mode => mode.id === engine.mode) || !engine.id || !engine.name.trim() || !engine.url.includes("%s")) throw new Error("请填写名称，并在搜索网址中用 %s 表示关键词。");
  researchUrl(engine.url.replaceAll("%s", "example"));
  return { ...engine, name: engine.name.trim(), url: engine.url.trim() };
}
export function researchPreferences(value?: Partial<ResearchPreferences>): ResearchPreferences {
  const engines = ENGINES.map(engine => ({ ...engine }));
  for (const engine of value?.engines ?? []) {
    try { const validated = validateEngine(engine), index = engines.findIndex(item => item.id === validated.id); if (index < 0) engines.push(validated); else engines[index] = validated; } catch { /* Ignore malformed saved preferences. */ }
  }
  const order = [...new Set([...(value?.order ?? []), ...RESEARCH_MODES.map(mode => mode.id)])].filter((id): id is ResearchMode => RESEARCH_MODES.some(mode => mode.id === id));
  const mode = RESEARCH_MODES.some(mode => mode.id === value?.mode) ? value!.mode! : "video";
  const selected: ResearchPreferences["selected"] = {};
  for (const id of order) selected[id] = engines.find(engine => engine.mode === id && engine.id === value?.selected?.[id])?.id ?? engines.find(engine => engine.mode === id)!.id;
  return { mode, order, engines, selected, locked: value?.locked === true };
}
export function engineSearchUrl(engine: ResearchEngine, text: string): string {
  validateEngine(engine);
  if (!text.trim()) throw new Error("请输入搜索内容。");
  return researchUrl(engine.url.replaceAll("%s", encodeURIComponent(text.trim())));
}
