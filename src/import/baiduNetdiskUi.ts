import { Notice, TFile } from "obsidian";
import { BaiduNetdiskClient, BaiduApiError, type BaiduFileEntry, type CloudTransport } from "./baiduNetdisk";
import { importLocalDocuments, type ImportConflictPolicy, type ImportHost } from "./webImport";
import { isStudyDocumentPath } from "../documents/formats";
import { createModal } from "../utils/modal";
import { el, clear } from "../utils/dom";
import { uid } from "../utils/id";

export interface BaiduUiOptions {
  activePath?: () => string | undefined;
  onChanged?: () => void;
  /** Synthetic acceptance only; production uses Obsidian requestUrl. */
  transport?: CloudTransport;
}

function sizeLabel(size: number): string {
  if (size >= 1024 ** 3) return (size / 1024 ** 3).toFixed(1) + " GB";
  if (size >= 1024 ** 2) return (size / 1024 ** 2).toFixed(1) + " MB";
  if (size >= 1024) return Math.ceil(size / 1024) + " KB";
  return size + " B";
}
function message(error: unknown): string { return error instanceof BaiduApiError ? error.message : String(error); }

/** 官方 OAuth 目录浏览、下载导入和上传；不使用网页 Cookie 或账号密码。 */
export function openBaiduNetdisk(host: ImportHost, options: BaiduUiOptions = {}): void {
  host.store.settings.baiduNetdisk ??= {};
  const client = new BaiduNetdiskClient({ settings: host.store.settings.baiduNetdisk, saveSettings: () => host.store.save(), transport: options.transport });
  const { modal, close } = createModal("百度网盘", () => { closed = true; });
  modal.classList.add("ms-baidu-netdisk");
  let busy = false, closed = false;
  const originalClose = close;
  // createModal's close callback is owned by the caller; track closure to avoid stale UI writes.
  const status = el("div", { class: "ms-web-import-status", role: "status", "aria-live": "polite" });
  const body = el("div", { class: "ms-baidu-body" });
  const actions = el("div", { class: "ms-modal-actions" });
  const dismiss = el("button", { class: "ms-btn", text: "关闭" }); dismiss.addEventListener("click", () => { closed = true; originalClose(); });
  actions.append(dismiss);
  const setBusy = (value: boolean) => { busy = value; for (const button of modal.querySelectorAll("button")) if (button !== dismiss) button.disabled = value; };
  const fail = (error: unknown) => { if (!closed) status.textContent = message(error); };
  const field = (label: string, input: HTMLElement) => { const row = el("label", { class: "ms-web-import-field" }); row.append(document.createTextNode(label), input); return row; };
  const saveConfig = () => { host.store.save(); };

  const drawConfig = () => {
    clear(body);
    const id = el("input", { class: "ms-search", type: "text", value: client.settings.clientId ?? "", autocomplete: "off" }) as HTMLInputElement;
    const secret = el("input", { class: "ms-search", type: "password", value: client.settings.clientSecret ?? "", autocomplete: "off" }) as HTMLInputElement;
    const redirect = el("input", { class: "ms-search", type: "text", value: client.settings.redirectUri ?? "oob", autocomplete: "off" }) as HTMLInputElement;
    const root = el("input", { class: "ms-search", type: "text", value: client.settings.rootPath ?? "/apps/MarginStudy", autocomplete: "off" }) as HTMLInputElement;
    const persist = () => {
      client.settings.clientId = id.value.trim(); client.settings.clientSecret = secret.value.trim();
      client.settings.redirectUri = redirect.value.trim() || "oob"; client.settings.rootPath = root.value.trim() || "/apps/MarginStudy";
      saveConfig();
    };
    const save = el("button", { class: "ms-btn", text: "保存应用配置" });
    save.addEventListener("click", () => { try { persist(); status.textContent = "配置已保存到当前库；不会写入日志或导出清单。"; } catch (error) { fail(error); } });
    const auth = el("button", { class: "ms-btn primary", text: "生成官方授权链接" });
    const link = el("a", { text: "打开百度官方授权页", target: "_blank", rel: "noopener noreferrer", class: "ms-btn", style: "display:none" }) as HTMLAnchorElement;
    const code = el("input", { class: "ms-search", type: "text", placeholder: "授权完成后粘贴授权码", "aria-label": "百度授权码", autocomplete: "off" }) as HTMLInputElement;
    const exchange = el("button", { class: "ms-btn primary", text: "完成授权" });
    auth.addEventListener("click", () => {
      try { persist(); const url = client.authorizationUrl(uid("baidu-state")); link.href = url; link.style.display = "inline-block"; status.textContent = "请在官方页面登录并授权，然后粘贴返回的授权码。"; }
      catch (error) { fail(error); }
    });
    exchange.addEventListener("click", () => {
      if (busy) return; setBusy(true); status.textContent = "正在换取访问令牌…";
      void client.exchangeCode(code.value, redirect.value).then(() => { if (!closed) drawBrowser(client.root); })
        .catch(fail).finally(() => { if (!closed) setBusy(false); });
    });
    body.append(
      el("p", { class: "ms-muted", text: "需要百度开发者应用的 AppKey/Secret。网盘账号密码不经过本插件；授权仅访问 /apps/<应用名>/ 目录。" }),
      field("AppKey / Client ID", id), field("Secret / Client Secret", secret), field("授权回调（无服务器默认 oob）", redirect), field("授权目录", root),
      el("div", { class: "ms-modal-actions" }), save, auth, link, field("授权码", code), exchange,
    );
    body.children[4].append(save, auth, link);
  };

  const drawBrowser = (dir: string) => {
    if (!client.authorized) { drawConfig(); return; }
    clear(body);
    const up = el("button", { class: "ms-btn", text: "上一级" });
    const refresh = el("button", { class: "ms-btn", text: "刷新" });
    const logout = el("button", { class: "ms-btn", text: "解除授权" });
    const path = el("strong", { text: dir, style: "overflow-wrap:anywhere" });
    const studySet = el("select", { class: "ms-select", "aria-label": "导入到学习集" }) as HTMLSelectElement;
    studySet.append(el("option", { value: "", text: "不加入学习集" }));
    for (const set of host.store.studySets) studySet.append(el("option", { value: set.id, text: set.name }));
    studySet.value = host.store.activeStudySetId ?? "";
    const conflict = el("select", { class: "ms-select", "aria-label": "同名文件处理" }) as HTMLSelectElement;
    for (const [value, text] of [["reject", "同名拒绝"], ["reuse", "复用本地同名文件"], ["rename", "重命名导入"]] as const) conflict.append(el("option", { value, text }));
    const importButton = el("button", { class: "ms-btn primary", text: "导入选中文件" });
    const upload = el("button", { class: "ms-btn", text: "上传当前文档" });
    const list = el("div", { class: "ms-baidu-file-list", role: "list", "aria-label": "网盘文件列表" });
    const selected = new Set<number>();
    let currentEntries: BaiduFileEntry[] = [];
    const load = async () => {
      if (busy) return; setBusy(true); status.textContent = "正在读取目录…"; clear(list);
      try {
        const page = await client.list(dir, { limit: 1000, order: "name" });
        if (closed) return;
        currentEntries = page.entries;
        if (!page.entries.length) list.append(el("p", { class: "ms-muted", text: "此目录为空。" }));
        const folders = page.entries.filter(entry => entry.isdir), files = page.entries.filter(entry => !entry.isdir);
        for (const entry of [...folders, ...files]) {
          const row = el("div", { class: "ms-baidu-file-row", role: "listitem" });
          if (entry.isdir) {
            const open = el("button", { class: "ms-baidu-file-name", text: "📁 " + entry.server_filename, title: entry.path });
            open.addEventListener("click", () => { if (!busy) drawBrowser(entry.path); }); row.append(open);
          } else {
            const label = el("label", { class: "ms-baidu-file-name" });
            const box = el("input", { type: "checkbox", "aria-label": "选择 " + entry.server_filename, "data-fsid": String(entry.fs_id) }) as HTMLInputElement;
            box.checked = selected.has(entry.fs_id); box.disabled = !isStudyDocumentPath(entry.server_filename);
            box.addEventListener("change", () => { if (box.checked) selected.add(entry.fs_id); else selected.delete(entry.fs_id); });
            label.append(box, el("span", { text: entry.server_filename, title: entry.path })); row.append(label);
          }
          row.append(el("span", { class: "ms-muted", text: entry.isdir ? "目录" : sizeLabel(entry.size) }));
          list.append(row);
        }
        status.textContent = `已读取 ${page.entries.length} 项；仅支持 PDF/DOCX/EPUB/HTML/Markdown/MSREF 导入。`;
      } catch (error) { fail(error); }
      finally { if (!closed) setBusy(false); }
    };
    up.disabled = dir === client.root;
    up.addEventListener("click", () => { const parts = dir.split("/"); parts.pop(); drawBrowser(parts.join("/") || "/"); });
    refresh.addEventListener("click", () => { void load(); });
    logout.addEventListener("click", () => { void client.logout().then(drawConfig).catch(fail); });
    importButton.addEventListener("click", () => {
      const entries = [...list.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked')].map(box => {
        const fsId = Number(box.dataset.fsid);
        return currentEntries.find(entry => entry.fs_id === fsId)!;
      }).filter(Boolean);
      if (!entries.length) { status.textContent = "请先选择可导入的文档。"; return; }
      if (busy) return; setBusy(true);
      void (async () => {
        const downloaded: File[] = [];
        for (const entry of entries) {
          status.textContent = `正在下载 ${entry.server_filename}…`;
          const bytes = await client.download(entry, { onProgress: (done, total) => { if (!closed) status.textContent = `下载 ${entry.server_filename}：${sizeLabel(done)} / ${sizeLabel(total)}`; } });
          downloaded.push(new File([bytes as BlobPart], entry.server_filename, { type: "application/octet-stream" }));
        }
        status.textContent = "正在写入学习库…";
        const files = await importLocalDocuments(host, downloaded, { studySetId: studySet.value || null, conflict: conflict.value as ImportConflictPolicy });
        for (let index = 0; index < files.length; index++) host.store.registerDocument(files[index].path, `baidu://fsid/${entries[index].fs_id}`);
        options.onChanged?.(); status.textContent = `已导入 ${files.length} 份文档。`;
        new Notice(`百度网盘已导入 ${files.length} 份文档。`); selected.clear(); await load();
      })().catch(fail).finally(() => { if (!closed) setBusy(false); });
    });
    upload.addEventListener("click", () => {
      const path = options.activePath?.();
      if (!path) { status.textContent = "请先打开要上传的文档。"; return; }
      const file = host.app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) { status.textContent = "当前文档不存在。"; return; }
      if (busy) return; setBusy(true);
      void (async () => {
        const bytes = await host.app.vault.readBinary(file);
        const target = client.root + "/" + file.name;
        const result = await client.upload(target, bytes, { onProgress: (done, total) => { if (!closed) status.textContent = `上传 ${file.name}：${sizeLabel(done)} / ${sizeLabel(total)}`; } });
        status.textContent = `已上传：${result.path}`; new Notice("文档已上传到百度网盘授权目录。");
      })().catch(fail).finally(() => { if (!closed) setBusy(false); });
    });
    const tools = el("div", { class: "ms-modal-actions" }); tools.append(up, refresh, logout);
    const importTools = el("div", { class: "ms-modal-actions" }); importTools.append(field("导入到学习集", studySet), field("同名处理", conflict), importButton, upload);
    body.append(tools, path, importTools, list);
    void load();
  };

  modal.append(body, status, actions);
  if (client.authorized) drawBrowser(client.root); else drawConfig();
}
