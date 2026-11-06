import type MarginStudyPlugin from "../main";
import { Notice } from "obsidian";
import { el, clear } from "../utils/dom";
import { createModal } from "../utils/modal";

/**
 * A06 功能搜索与本地操作指引。
 *
 * 显式功能 ID + 关键词 + 说明 + 设置跳转的本地索引：
 * - 每个条目绑定唯一动作：kind === "command" 时动作是插件命令注册表中的对应命令；
 *   kind === "setting" 时动作是打开插件设置并定位到目标设置项。
 * - 纯本地：没有任何网络请求；也不包含发送截图的能力。
 * - 无效或旧功能 ID 一律拒绝执行（runFeature 返回 false）。
 */

export interface FeatureEntry {
  /** 显式功能 ID：kind === "command" 时等于 Obsidian 命令 id；kind === "setting" 时为 settings.<slug> */
  id: string;
  kind: "command" | "setting";
  title: string;
  description: string;
  keywords: string[];
  /** kind === "setting" 时的跳转目标：settings.ts 中 Setting.setName 的原文 */
  setting?: string;
}

const command = (id: string, title: string, description: string, keywords: string[]): FeatureEntry =>
  ({ id, kind: "command", title, description, keywords });

const setting = (id: string, name: string, description: string, keywords: string[]): FeatureEntry =>
  ({ id, kind: "setting", title: `设置：${name}`, description, keywords, setting: name });

/** 本地功能索引。顺序即无查询时的展示顺序。 */
export const FEATURE_INDEX: FeatureEntry[] = [
  command("feature-search", "功能搜索（设置与操作索引）", "搜索全部功能与设置入口并执行或跳转（Cmd/Ctrl+Shift+P）", ["功能搜索", "命令面板", "palette", "help", "指引"]),
  command("open-reader", "在 MarginStudy 中打开当前 PDF", "把当前 PDF 用 MarginStudy 阅读器打开并进入学习布局", ["打开pdf", "pdf", "阅读器", "open pdf"]),
  command("pdf-search", "在 PDF 中搜索（Ctrl+F）", "在当前 MarginStudy PDF 内打开搜索栏定位关键词", ["pdf搜索", "查找", "search", "find"]),
  command("open-word-reader", "在 MarginStudy 中打开当前 Word 文档", "把当前 .docx 用 MarginStudy 阅读器打开", ["word", "docx", "打开word"]),
  command("open-document-reader", "在 MarginStudy 中打开当前文档（PDF / Word / EPUB / HTML / Markdown）", "按文件类型自动选择阅读器打开当前文档", ["打开文档", "document", "epub", "html", "markdown"]),
  command("open-study-workspace", "打开 MarginStudy 学习工作区", "打开学习工作区：阅读、脑图、复习与整理同屏", ["工作区", "workspace", "学习区"]),
  command("toggle-interface-mode", "切换界面模式", "在场景界面与传统界面之间切换（Cmd+Alt+I）", ["界面模式", "传统界面", "场景界面"]),
  command("import-web-article", "导入网页 / 微信文章", "抓取网页或微信文章正文保存为可标注文档", ["网页", "微信", "导入", "import", "web"]),
  command("open-research-browser", "打开研究浏览器", "打开内置浏览器查询资料并摘录", ["研究浏览器", "浏览器", "research"]),
  command("manage-review-decks", "新建与管理复习卡组", "创建、重命名和删除复习卡组", ["卡组", "牌组", "deck", "复习卡组"]),
  command("open-cards", "打开卡片管理", "浏览、筛选和编辑全部卡片", ["卡片管理", "卡片盒", "cards"]),
  command("start-review", "开始复习（到期的卡）", "按到期时间开始当前学习集的复习", ["复习", "review", "到期"]),
  command("open-sidebar", "打开 MarginStudy 侧边栏", "打开含大纲与脑图页签的右侧边栏", ["侧边栏", "sidebar", "大纲"]),
  command("open-mindmap", "打开 MarginStudy 思维导图", "在右侧打开脑图视图", ["脑图", "思维导图", "mindmap"]),
  command("export-markdown", "导出当前文档为 Markdown", "把当前文档的标注、卡片与导图导出为 Markdown 笔记", ["导出markdown", "markdown", "md"]),
  command("export-edited-pdf", "导出编辑后的 PDF", "把裁边、插入页等页编辑结果导出为新 PDF", ["导出pdf", "pdf导出", "裁边"]),
  command("export-html", "导出当前文档为 HTML", "生成自包含的 HTML 学习笔记", ["导出html", "html"]),
  command("export-canvas", "导出当前导图为 Canvas", "把脑图导出为 Obsidian Canvas 文件", ["canvas", "导图导出"]),
  command("import-canvas", "从 Canvas 导入为导图", "把 Canvas 文件导入为脑图", ["导入canvas", "canvas导入"]),
  command("show-stats", "查看学习统计", "查看卡片数量、复习日历与间隔分布", ["统计", "stats", "日历"]),
  command("global-search", "全局检索（卡片 + 批注）", "跨卡片与文档批注做全文检索并可回源", ["全局检索", "全局搜索", "search all"]),
  command("export-anki-tsv", "导出 Anki 兼容 TSV（当前文档）", "以制表符分隔导出当前文档闪卡的正反面与标签", ["anki", "tsv", "导出anki"]),
  command("export-anki-apkg", "导出 Anki 牌组（APKG，含图片与遮挡）", "把学习库批量导出为 APKG：正反面、挖空、图片遮挡、媒体与标签", ["apkg", "anki包", "牌组导出", "遮挡导出"]),
  command("review-wrong", "复习错题", "只复习标记为错误的题目", ["错题", "wrong", "重做"]),
  command("backup-data", "备份数据（MarginStudy）", "立即把学习库备份到 MarginStudyBackups", ["备份", "backup"]),
  command("export-all-html", "导出全部学习库为 HTML", "汇总导出全库卡片为单个 HTML 文件", ["全库导出", "全部导出"]),
  command("export-mindmap-png", "导出脑图为 PNG/SVG", "把当前脑图导出为 PNG 或 SVG 图片", ["png", "svg", "脑图导出"]),
  command("dedup-cards", "检测重复卡片", "扫描内容重复或相似的卡片", ["重复", "dedup", "查重"]),
  command("export-pdf-outline", "导出 PDF 目录为笔记", "把 PDF 书签目录导出为 Markdown 大纲", ["目录", "outline", "书签"]),
  command("toggle-recall", "切换忆模式（遮住摘录，点击揭示）", "在阅读器内遮住摘录做主动回忆", ["忆模式", "遮挡", "recall"]),
  command("save-now", "立即保存学习库", "立即把学习库写入磁盘", ["保存", "save"]),
  command("restore-backup", "恢复完整学习库备份", "从完整备份恢复学习库", ["恢复备份", "restore"]),
  command("resolve-save-conflict", "处理保存冲突", "查看并合并学习库与批注的保存冲突", ["冲突", "conflict", "合并"]),
  command("undo-library", "撤销最近一次学习库操作", "撤销上一次学习库级变更", ["撤销", "undo"]),
  command("redo-library", "重做最近一次学习库操作", "重做被撤销的学习库变更", ["重做", "redo"]),
  setting("settings.colors", "标注颜色", "编辑可选的标注颜色列表", ["标注颜色", "颜色", "colors"]),
  setting("settings.default-color", "默认标注颜色", "选择新标注使用的默认颜色", ["默认颜色", "默认标注颜色"]),
  setting("settings.scale", "默认缩放", "调整新打开 PDF 的默认缩放比例", ["缩放", "scale", "默认缩放"]),
  setting("settings.page-gap", "页间距 (px)", "调整阅读时页面之间的间距", ["页间距", "页面间距", "gap"]),
  setting("settings.branch-style", "默认分支样式", "选择新建或打开脑图时的分支布局", ["分支样式", "布局", "branch"]),
  setting("settings.immersive", "默认沉浸模式", "打开脑图时自动隐藏干扰元素", ["沉浸", "沉浸模式", "immersive"]),
  setting("settings.theme", "界面主题", "切换亮色、暗色或跟随系统", ["主题", "亮色", "暗色", "theme"]),
  setting("settings.accent", "主题色", "选择插件主色（按钮、高亮、强调）", ["主题色", "强调色", "accent"]),
  setting("settings.auto-card-highlight", "高亮后自动成卡", "高亮或下划线时自动生成摘录卡", ["自动成卡", "高亮成卡"]),
  setting("settings.auto-card-region", "区域摘录自动成卡", "套索框选区域时自动生成摘录卡", ["区域摘录", "套索成卡"]),
  setting("settings.auto-node", "生成卡片自动进脑图", "生成卡片时自动在脑图同步创建节点", ["自动进脑图", "摘录即节点"]),
  setting("settings.tag-colors", "标签配色", "为标签指定展示颜色", ["标签配色", "标签颜色"]),
  setting("settings.auto-backup", "每日自动备份", "每天首次启动时自动备份学习库", ["自动备份", "每日备份"]),
  setting("settings.replace-native-reader", "用 MarginStudy 替代原生阅读器", "控制 PDF、Word、EPUB、HTML 是否由 MarginStudy 接管打开", ["替代原生阅读器", "接管", "replace"]),
];

/** 按关键词/标题/说明/ID 的 AND 检索；空查询返回全部条目（作为本地操作指引浏览）。 */
export function queryFeatures(query: string): FeatureEntry[] {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return [...FEATURE_INDEX];
  const hits: { entry: FeatureEntry; score: number }[] = [];
  for (const entry of FEATURE_INDEX) {
    const title = entry.title.toLowerCase();
    const keywords = entry.keywords.join(" ").toLowerCase();
    const id = entry.id.toLowerCase();
    const description = entry.description.toLowerCase();
    let score = 0, matched = true;
    for (const token of tokens) {
      if (title.includes(token)) score += 8;
      else if (keywords.includes(token)) score += 4;
      else if (id.includes(token)) score += 2;
      else if (description.includes(token)) score += 1;
      else { matched = false; break; }
    }
    if (matched) hits.push({ entry, score });
  }
  return hits.sort((a, b) => b.score - a.score).map((hit) => hit.entry);
}

/**
 * 执行一个显式功能 ID 对应的唯一动作。
 * 无效或旧功能 ID（命令注册表中不存在）返回 false 且不执行任何动作。
 */
export function runFeature(plugin: MarginStudyPlugin, featureId: string): boolean {
  const commands = (plugin.app as unknown as { commands?: { commands?: Record<string, CommandLike> } })?.commands?.commands;
  const cmd = commands?.[`${plugin.manifest.id}:${featureId}`];
  if (!cmd) return false;
  if (typeof cmd.checkCallback === "function") {
    if (!cmd.checkCallback(true)) return false;
    cmd.checkCallback(false);
    return true;
  }
  if (typeof cmd.callback === "function") { cmd.callback(); return true; }
  return false;
}

interface CommandLike {
  callback?: () => void;
  checkCallback?: (checking: boolean) => boolean;
}

/** 打开插件设置页并滚动定位到指定设置项；返回是否找到该设置。 */
export function openSettingAndReveal(plugin: MarginStudyPlugin, settingName: string): boolean {
  const api = (plugin.app as unknown as { setting?: { open?: () => void; openTabById?: (id: string) => void; containerEl?: ParentNode } }).setting;
  if (!api || typeof api.open !== "function" || typeof api.openTabById !== "function") return false;
  api.open();
  api.openTabById(plugin.manifest.id);
  const scope: ParentNode = api.containerEl ?? document;
  // Obsidian 渲染设置页是同步的；保留少量重试以兼容宿主的异步装饰。
  revealSettingItem(scope, settingName);
  window.setTimeout(() => revealSettingItem(scope, settingName), 60);
  window.setTimeout(() => revealSettingItem(scope, settingName), 250);
  return true;
}

/** 在设置容器中按名称定位设置项：滚动到可见并短暂高亮。 */
export function revealSettingItem(scope: ParentNode, settingName: string): HTMLElement | null {
  const items = scope.querySelectorAll<HTMLElement>(".setting-item");
  for (const item of items) {
    const name = item.querySelector<HTMLElement>(".setting-item-name");
    if (name?.textContent?.trim() !== settingName) continue;
    item.scrollIntoView({ block: "center", behavior: "auto" });
    item.classList.remove("ms-setting-flash");
    void item.offsetWidth; // 重启动画
    item.classList.add("ms-setting-flash");
    window.setTimeout(() => item.classList.remove("ms-setting-flash"), 2000);
    return item;
  }
  return null;
}

/** 功能搜索面板：显式索引的本地操作指引（无网络、无外发）。 */
export function openFeatureSearch(plugin: MarginStudyPlugin): void {
  const { modal, close } = createModal("MarginStudy 功能搜索");
  modal.classList.add("ms-feature-search");
  const input = el("input", {
    class: "ms-search", type: "text",
    placeholder: "搜索功能、关键词或说明；↑↓ 选择，Enter 执行，Esc 关闭",
  }) as HTMLInputElement;
  const hint = el("p", {
    class: "ms-muted",
    text: "全部功能均为本地操作；设置项可直接跳转定位。",
    style: "font-size:12px;margin:6px 0 0",
  });
  const list = el("div", { class: "ms-feature-list", style: "margin-top:6px;max-height:56vh;overflow:auto" });
  modal.append(input, hint, list);

  let selected = 0;
  const execute = (entry: FeatureEntry) => {
    close();
    if (entry.kind === "command") {
      if (!runFeature(plugin, entry.id)) new Notice("该功能当前不可用：" + entry.title);
    } else if (entry.setting) {
      if (!openSettingAndReveal(plugin, entry.setting)) new Notice("设置跳转失败：" + entry.setting);
    }
  };
  const draw = () => {
    const hits = queryFeatures(input.value.trim());
    selected = hits.length ? Math.min(selected, hits.length - 1) : 0;
    clear(list);
    if (!hits.length) {
      list.append(el("p", { class: "ms-muted", text: "没有匹配的功能。", style: "padding:8px 0" }));
      return;
    }
    hits.forEach((entry, index) => {
      const row = el("div", {
        class: "ms-card ms-feature-item" + (index === selected ? " ms-feature-selected" : ""),
        "data-feature-id": entry.id,
        style: "cursor:pointer",
      });
      row.append(
        el("div", { class: "ms-card-type", text: entry.kind === "setting" ? "设置" : "命令" }),
        el("div", { class: "ms-card-front", text: entry.title }),
        el("div", { class: "ms-muted", text: entry.description })
      );
      row.addEventListener("click", () => execute(entry));
      list.append(row);
    });
  };
  input.addEventListener("input", () => { selected = 0; draw(); });
  input.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const hits = queryFeatures(input.value.trim());
      if (!hits.length) return;
      selected = e.key === "ArrowDown" ? (selected + 1) % hits.length : (selected - 1 + hits.length) % hits.length;
      draw();
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hits = queryFeatures(input.value.trim());
      const entry = hits[selected];
      if (entry) execute(entry);
    }
  });
  draw();
  setTimeout(() => input.focus(), 0);
}

/** 注册 Cmd/Ctrl+Shift+P 打开功能搜索；随插件卸载自动清理。 */
export function installFeatureSearchHotkey(plugin: MarginStudyPlugin): void {
  const handler = (e: KeyboardEvent) => {
    if (!(e.metaKey || e.ctrlKey) || !e.shiftKey) return;
    if (e.key?.toLowerCase() !== "p") return;
    e.preventDefault();
    e.stopPropagation();
    openFeatureSearch(plugin);
  };
  plugin.registerDomEvent(window, "keydown", handler, true);
}
