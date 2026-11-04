/**
 * A22：Anki APKG 构建器（纯函数，不依赖 obsidian）。
 *
 * 输出结构（Anki 2 兼容）：
 * - collection.anki2：本仓库 sqlite.ts 写入的 SQLite 库（col/notes/cards/revlog/graves）
 * - media：JSON 索引（{"0": "ms-<hash>.<ext>"}）
 * - 0、1、2…：媒体文件字节
 *
 * 完成断言对应：卡片数、模板数、媒体引用数由 manifest 返回，可被独立 SQLite 读取器核验；
 * 任一媒体缺失（引用了不存在/空的媒体文件）时 buildApkg 抛错，不产出任何文件。
 */
import { zipSync, strToU8 } from "fflate";
import { SqliteFile } from "./sqlite";
import { sha1Hex } from "../utils/sha1";

export interface ApkgModelSpec {
  key: "basic" | "cloze" | "occlusion";
  id: number;
  name: string;
  /** 0 = 标准；1 = 挖空（cloze） */
  type: 0 | 1;
  fields: string[];
  qfmt: string;
  afmt: string;
}

export const APKG_MODELS: ApkgModelSpec[] = [
  { key: "basic", id: 1749330000001, name: "MarginStudy 基本", type: 0, fields: ["Front", "Back", "Source"], qfmt: "{{Front}}", afmt: "{{FrontSide}}\n<hr id=answer>\n{{Back}}" },
  { key: "cloze", id: 1749330000002, name: "MarginStudy 挖空", type: 1, fields: ["Text", "Extra", "Source"], qfmt: "{{cloze:Text}}", afmt: "{{cloze:Text}}\n<br>\n{{Extra}}" },
  { key: "occlusion", id: 1749330000003, name: "MarginStudy 遮挡", type: 0, fields: ["Occlusion", "Reveal", "Extra", "Source"], qfmt: "{{Occlusion}}", afmt: "{{Occlusion}}\n<hr id=answer>\n{{Reveal}}\n<br>\n{{Extra}}" },
];

export interface ApkgNoteSpec {
  guid: string;
  model: "basic" | "cloze" | "occlusion";
  fields: Record<string, string>;
  tags: string[];
  /** 生成的卡片 ord 列表；basic/occlusion 默认 [0]，cloze 为挖空序号-1 列表 */
  ords?: number[];
}

export interface ApkgMediaFile {
  filename: string;
  data: Uint8Array;
}

export interface ApkgInput {
  deckName: string;
  builtAt?: number;
  notes: ApkgNoteSpec[];
  media: ApkgMediaFile[];
}

export interface ApkgManifest {
  deckName: string;
  builtAt: number;
  deckId: number;
  models: { id: number; name: string; key: string }[];
  modelCount: number;
  noteCount: number;
  cardCount: number;
  mediaCount: number;
  media: { index: number; filename: string; sha1: string; bytes: number }[];
  notes: { guid: string; model: string; modelName: string; ords: number[]; tags: string[]; mediaNames: string[] }[];
}

const DECK_ID = 1749330000042;

function dayStart(ms: number): number {
  const date = new Date(ms);
  date.setHours(4, 0, 0, 0); // Anki 以本地凌晨 4 点为滚动线，取当日任意稳定值即可
  return Math.floor(date.getTime() / 1000);
}

function stripHtml(text: string): string {
  return text.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim();
}

/** 从字段 HTML 中提取 APKG 媒体引用（src="ms-…"）。 */
export function referencedMediaNames(fields: Record<string, string>): string[] {
  const names = new Set<string>();
  for (const value of Object.values(fields)) {
    for (const match of value.matchAll(/src="(ms-[0-9a-f]+\.[A-Za-z0-9]+)"/g)) names.add(match[1]);
  }
  return [...names];
}

function modelJson(model: ApkgModelSpec, mod: number): Record<string, unknown> {
  return {
    id: model.id,
    name: model.name,
    type: model.type,
    mod,
    usn: -1,
    sortf: 0,
    did: null,
    tmpls: [{
      name: model.type === 1 ? "挖空" : "卡片 1",
      ord: 0,
      qfmt: model.qfmt,
      afmt: model.afmt,
      bqfmt: "",
      bafmt: "",
      did: null,
      bfont: "",
      bsize: 0,
    }],
    flds: model.fields.map((name, ord) => ({ name, ord, sticky: false, rtl: false, font: "Arial", size: 20, media: [] })),
    css: ".card { font-family: arial; font-size: 20px; text-align: center; color: black; background-color: white; }",
    latexPre: "\\documentclass[12pt]{article}\n\\special{papersize=3in,5in}\n\\usepackage[utf8]{inputenc}\n\\usepackage{amssymb,amsmath}\n\\pagestyle{empty}\n\\setlength{\\parindent}{0in}\n\\begin{document}\n",
    latexPost: "\\end{document}",
    req: [[0, "any", [0]]],
    tags: [],
    vers: [],
  };
}

function deckJson(id: number, name: string, mod: number): Record<string, unknown> {
  return {
    id, name, mod, usn: -1,
    lrnToday: [0, 0], revToday: [0, 0], newToday: [0, 0], timeToday: [0, 0],
    collapsed: false, browserCollapsed: false,
    desc: "", dyn: 0, conf: 1, extendNew: 0, extendRev: 0,
  };
}

export function buildApkg(input: ApkgInput): { data: Uint8Array; manifest: ApkgManifest } {
  const builtAt = input.builtAt ?? Date.now();
  if (!Number.isSafeInteger(builtAt) || builtAt <= 0) throw new Error("APKG 时间戳非法");
  if (!input.deckName?.trim()) throw new Error("APKG 牌组名不能为空");

  // 媒体：内容查重 → 文件名固定；同名必须同内容；引用必须存在
  const mediaByFilename = new Map<string, ApkgMediaFile>();
  for (const file of input.media) {
    if (!(file.data instanceof Uint8Array) || file.data.length === 0) throw new Error(`媒体缺失或为空：${file.filename}`);
    if (!/^ms-[0-9a-f]+\.[A-Za-z0-9]+$/.test(file.filename)) throw new Error(`媒体文件名非法：${file.filename}`);
    const existing = mediaByFilename.get(file.filename);
    if (existing) {
      if (sha1Hex(existing.data) !== sha1Hex(file.data)) throw new Error(`同名媒体内容不一致：${file.filename}`);
    } else mediaByFilename.set(file.filename, file);
  }

  const mediaNames = [...mediaByFilename.keys()];
  const notesOut: ApkgManifest["notes"] = [];
  const guidSeen = new Set<string>();
  const noteRows: { rowid: number; values: (number | string | null)[] }[] = [];
  const cardRows: { rowid: number; values: (number | string | null)[] }[] = [];
  let duePosition = 1;
  input.notes.forEach((note, index) => {
    const model = APKG_MODELS.find((item) => item.key === note.model);
    if (!model) throw new Error(`未知模板：${note.model}`);
    const fieldKeys = Object.keys(note.fields);
    for (const field of model.fields) {
      if (!(field in note.fields)) throw new Error(`笔记 ${note.guid} 缺少字段 ${field}`);
    }
    if (fieldKeys.length !== model.fields.length) throw new Error(`笔记 ${note.guid} 字段数量与模板不符`);
    if (!note.guid?.trim()) throw new Error("笔记 guid 不能为空");
    if (guidSeen.has(note.guid)) throw new Error(`笔记 guid 重复：${note.guid}`);
    guidSeen.add(note.guid);

    const usedMedia = referencedMediaNames(note.fields);
    for (const name of usedMedia) {
      if (!mediaByFilename.has(name)) throw new Error(`媒体缺失：${name}（笔记 ${note.guid}）`);
    }
    const ords = note.ords ?? [0];
    if (!ords.length) throw new Error(`笔记 ${note.guid} 没有生成任何卡片`);
    for (const ord of ords) {
      if (!Number.isSafeInteger(ord) || ord < 0) throw new Error(`笔记 ${note.guid} 卡片 ord 非法：${ord}`);
      if (model.type === 0 && ord !== 0) throw new Error(`标准模板只有 1 张模板卡，ord 必须为 0：${note.guid}`);
    }

    const tagsText = ` ${(note.tags ?? []).map((tag) => tag.replace(/\s+/g, "_")).filter(Boolean).join(" ")} `;
    const fieldValues = model.fields.map((field) => note.fields[field] ?? "");
    const csum = parseInt(sha1Hex(stripHtml(fieldValues[0])).slice(0, 8), 16);
    const noteId = builtAt + index;
    noteRows.push({
      rowid: noteId,
      values: [null, note.guid, model.id, builtAt, -1, tagsText, fieldValues.join("\x1f"), fieldValues[0], csum, 0, ""],
    });
    for (const ord of ords) {
      cardRows.push({
        rowid: builtAt + 1_000_000 + cardRows.length,
        values: [null, noteId, DECK_ID, ord, builtAt, -1, 0, 0, duePosition++, 0, 0, 0, 0, 0, 0, 0, 0, ""],
      });
    }
    notesOut.push({ guid: note.guid, model: note.model, modelName: model.name, ords: [...ords], tags: [...(note.tags ?? [])], mediaNames: usedMedia });
  });

  const mod = Math.floor(builtAt / 1000);
  const modelsJson: Record<string, unknown> = {};
  for (const model of APKG_MODELS) modelsJson[String(model.id)] = modelJson(model, mod);
  const decksJson: Record<string, unknown> = {
    "1": deckJson(1, "Default", mod),
    [String(DECK_ID)]: deckJson(DECK_ID, input.deckName, mod),
  };
  const confJson = {
    nextPos: cardRows.length + 1, estTimes: true, activeDecks: [1], sortType: "noteFld", timeLim: 0,
    sortBackwards: false, addToCur: true, curDeck: DECK_ID, newBury: true, newSpread: 0, dueCounts: true,
    curModel: String(APKG_MODELS[0].id), nextId: 1, collapseTime: 1200, dayLearnFirst: false,
  };
  const colRow: { rowid: number; values: (number | string | null)[] } = {
    rowid: 1,
    values: [null, dayStart(builtAt), mod, mod, 11, 0, 0, 0,
      JSON.stringify(confJson), JSON.stringify(modelsJson), JSON.stringify(decksJson),
      JSON.stringify({ 1: { name: "默认", replayq: true, timer: 0, maxTaken: 60 } }), "{}"],
  };

  const db = new SqliteFile();
  db.createTable("col", "CREATE TABLE col (id integer primary key, crt integer not null, mod integer not null, scm integer not null, ver integer not null, dty integer not null, usn integer not null, ls integer not null, conf text not null, models text not null, decks text not null, dconf text not null, tags text not null)", [colRow]);
  db.createTable("notes", "CREATE TABLE notes (id integer primary key, guid text not null, mid integer not null, mod integer not null, usn integer not null, tags text not null, flds text not null, sfld integer not null, csum integer not null, flags integer not null, data text not null)", noteRows);
  db.createTable("cards", "CREATE TABLE cards (id integer primary key, nid integer not null, did integer not null, ord integer not null, mod integer not null, usn integer not null, type integer not null, queue integer not null, due integer not null, ivl integer not null, factor integer not null, reps integer not null, lapses integer not null, left integer not null, odue integer not null, odid integer not null, flags integer not null, data text not null)", cardRows);
  db.createTable("revlog", "CREATE TABLE revlog (id integer primary key, cid integer not null, usn integer not null, ease integer not null, ivl integer not null, lastIvl integer not null, factor integer not null, time integer not null, type integer not null)", []);
  db.createTable("graves", "CREATE TABLE graves (usn integer not null, oid integer not null, type integer not null)", []);

  const mediaIndex: Record<string, string> = {};
  const mediaManifest: ApkgManifest["media"] = [];
  const zipEntries: Record<string, Uint8Array | [Uint8Array, Record<string, unknown>]> = {
    "collection.anki2": db.serialize(),
    "media": strToU8(JSON.stringify(mediaIndex)),
  };
  let mediaOrdinal = 0;
  for (const [filename, file] of mediaByFilename) {
    const index = String(mediaOrdinal++);
    mediaIndex[index] = filename;
    zipEntries[index] = [file.data, { level: 0 }];
    mediaManifest.push({ index: Number(index), filename, sha1: sha1Hex(file.data), bytes: file.data.length });
  }
  // media JSON 需要最终索引；重新构建 zip 顺序（先算索引再打包）
  zipEntries["media"] = strToU8(JSON.stringify(mediaIndex));

  const data = zipSync(zipEntries, { level: 4 });
  const manifest: ApkgManifest = {
    deckName: input.deckName,
    builtAt,
    deckId: DECK_ID,
    models: APKG_MODELS.map((model) => ({ id: model.id, name: model.name, key: model.key })),
    modelCount: APKG_MODELS.length,
    noteCount: noteRows.length,
    cardCount: cardRows.length,
    mediaCount: mediaManifest.length,
    media: mediaManifest,
    notes: notesOut,
  };
  return { data, manifest };
}
