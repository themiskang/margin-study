/**
 * [INPUT]: 依赖 Electron 对话框、Node 文件系统和受支持的学习文档格式。
 * [OUTPUT]: 提供桌面文档选择器、目录选择能力探测与统一的导入失败提示。
 * [POS]: 在工作区的同名处理前读取并验证外部文件，交回 File 列表。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { Notice } from "obsidian";
import { STUDY_DOCUMENT_EXTENSIONS, isStudyDocumentPath } from "../documents/formats";
import { el } from "../utils/dom";
import { createModal } from "../utils/modal";

interface DesktopOpenDialog {
  showOpenDialog(options: {
    title: string;
    properties: ("openFile" | "multiSelections" | "openDirectory")[];
    filters?: { name: string; extensions: string[] }[];
  }): Promise<{ canceled: boolean; filePaths: string[] }>;
}

const reasons = {
  EMPTY_PATH: "文件路径为空。",
  NOT_FOUND: "文件或上级路径不存在。",
  IS_DIRECTORY: "该路径指向目录，请选择文件。",
  UNSUPPORTED_EXT: "不支持该文件格式。",
  PERMISSION_DENIED: "没有读取文件的权限。",
  READ_FAILED: "读取文件失败。",
};

class LocalPathError extends Error {
  constructor(readonly code: keyof typeof reasons, message = reasons[code]) {
    super(message);
  }
}

function desktopRequire(owner: Window): NodeRequire | undefined {
  const require = (owner as Window & { require?: NodeRequire }).require;
  return typeof require === "function" ? require : undefined;
}

export function getDesktopOpenDialog(owner: Window = window): DesktopOpenDialog | undefined {
  const require = desktopRequire(owner);
  if (!require) return undefined;
  try {
    const dialog = require("@electron/remote")?.dialog;
    if (typeof dialog?.showOpenDialog === "function") return dialog;
  } catch {}
  try {
    const dialog = require("electron")?.remote?.dialog;
    if (typeof dialog?.showOpenDialog === "function") return dialog;
  } catch {}
}

function readError(error: unknown): LocalPathError {
  if (error instanceof LocalPathError) return error;
  const code = (error as NodeJS.ErrnoException | null)?.code;
  switch (code) {
    case "ENOENT":
    case "ENOTDIR": return new LocalPathError("NOT_FOUND");
    case "EISDIR": return new LocalPathError("IS_DIRECTORY");
    case "EACCES":
    case "EPERM": return new LocalPathError("PERMISSION_DENIED");
    default: return new LocalPathError("READ_FAILED");
  }
}

async function readLocalPathAsFile(require: NodeRequire, source: string, typed: boolean): Promise<File> {
  try {
    const path: typeof import("path") = require("path");
    const fs: typeof import("fs/promises") = require("fs").promises;
    let filePath = typed ? source.trim().replace(/^(["'])([\s\S]*)\1$/, "$2") : source;
    if (!filePath.trim()) throw new LocalPathError("EMPTY_PATH");
    if (typed && (filePath === "~" || filePath.startsWith("~/") || (path.sep === "\\" && filePath.startsWith("~\\")))) {
      const os: typeof import("os") = require("os");
      filePath = os.homedir() + filePath.slice(1);
    }
    if (!path.isAbsolute(filePath)) throw new LocalPathError("READ_FAILED", "读取文件失败：请输入绝对路径。");
    const stat = await fs.stat(filePath);
    if (stat.isDirectory()) throw new LocalPathError("IS_DIRECTORY");
    if (!stat.isFile()) throw new LocalPathError("READ_FAILED", "读取文件失败：该路径不是普通文件。");
    const name = path.basename(filePath);
    if (!isStudyDocumentPath(name)) throw new LocalPathError("UNSUPPORTED_EXT");
    return new File([await fs.readFile(filePath)], name, { lastModified: stat.mtimeMs });
  } catch (error) {
    throw readError(error);
  }
}

export function noticeDocumentImportFailure(error: unknown): void {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const reason = message && !/undefined|\[object Object\]/.test(message) ? message : reasons.READ_FAILED;
  new Notice(`导入未完成：${reason}`, 10000);
}

export function openLocalDocumentPicker(ownerDocument: Document, onFiles: (files: File[]) => void): void {
  const owner = ownerDocument.defaultView ?? window;
  const require = desktopRequire(owner);
  const dialog = getDesktopOpenDialog(owner);
  const openBrowserPicker = () => {
    const input = ownerDocument.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = STUDY_DOCUMENT_EXTENSIONS.map(extension => `.${extension}`).join(",");
    input.addEventListener("change", () => {
      if (input.files?.length) onFiles([...input.files]);
    });
    input.click();
  };
  if (!require) { openBrowserPicker(); return; }

  let closed = false;
  const { modal, close } = createModal("从电脑导入文档", () => { closed = true; }, ownerDocument);
  const form = el("form");
  const input = el("input", {
    type: "text", class: "ms-search", placeholder: "输入或粘贴绝对路径",
    "aria-label": "本地文件绝对路径", "data-ms-import-path-input": "",
  });
  const actions = el("div", { class: "ms-modal-actions" });
  const submit = el("button", { type: "submit", class: "ms-btn primary", text: "导入路径", "data-ms-import-path-submit": "" });
  const pick = el("button", { type: "button", class: "ms-btn", text: "选择文件…" });
  const cancel = el("button", { type: "button", class: "ms-btn", text: "取消" });
  const read = async (getPaths: () => Promise<string[]>, typed: boolean) => {
    if (closed || submit.disabled) return;
    submit.disabled = pick.disabled = true;
    try {
      const paths = await getPaths();
      const files: File[] = [];
      for (const path of paths) files.push(await readLocalPathAsFile(require, path, typed));
      if (!closed && files.length) { close(); onFiles(files); }
    } catch (error) {
      if (!closed) noticeDocumentImportFailure(readError(error));
    } finally {
      submit.disabled = pick.disabled = false;
    }
  };
  form.addEventListener("submit", event => {
    event.preventDefault();
    void read(async () => [input.value], true);
  });
  pick.addEventListener("click", () => {
    if (!dialog) { close(); openBrowserPicker(); return; }
    void read(async () => {
      const result = await dialog.showOpenDialog({
        title: "导入文档", properties: ["openFile", "multiSelections"],
        filters: [{ name: "学习文档", extensions: [...STUDY_DOCUMENT_EXTENSIONS] }],
      });
      return result.canceled ? [] : result.filePaths;
    }, false);
  });
  cancel.addEventListener("click", close);
  actions.append(pick, cancel, submit);
  form.append(input, actions);
  modal.append(form);
  input.focus();
}
