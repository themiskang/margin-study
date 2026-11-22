/**
 * [INPUT]: ExtendNotes 公开更新入口、Store 接口和延迟缩略图渲染器。
 * [OUTPUT]: 验证留白几何提交与缩略图完成的先后顺序。
 * [POS]: PDF 留白的确定性单测，不启动阅读器或浏览器。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const renderer = Symbol.for("marginstudy.test.extendMediaImage");
const stub = await readFile(resolve(here, "../documents/acceptance-fixtures/obsidian.txt"), "utf8");
const bundle = await build({
  entryPoints: [resolve(here, "extendNotes.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["canvas"],
  write: false,
  plugins: [{
    name: "extend-geometry-test",
    setup(builder) {
      builder.onResolve({ filter: /^(obsidian|\.\/extendMedia)$/ }, ({ path }) => ({ path, namespace: "test" }));
      builder.onLoad({ filter: /^obsidian$/, namespace: "test" }, () => ({ contents: stub, loader: "ts" }));
      builder.onLoad({ filter: /^\.\/extendMedia$/, namespace: "test" }, () => ({
        contents: 'export const extendMediaImage = (...args) => globalThis[Symbol.for("marginstudy.test.extendMediaImage")](...args);',
      }));
    },
  }],
});
const testModule = { exports: {} };
new Function("module", "require", bundle.outputFiles[0].text)(testModule, createRequire(import.meta.url));
const { ExtendNotes } = testModule.exports;

test("Extend commits both frame axes before the delayed card preview", { timeout: 5000 }, async () => {
  const path = "geometry.pdf";
  const frame = { id: "frame", text: "Text", x: .1, y: .2, w: .3, h: .2 };
  const note = { id: "note", pageId: "page", anchor: { x: .5, y: .3 }, height: 220, text: "", textBoxes: [frame] };
  const card = { id: "card", docPath: path, anchorAnnId: note.id, front: "" };
  const notifications = [];
  let meta = { pdfExtendNotes: [note] };
  let previewFinished = false;
  const previewSaved = Promise.withResolvers();
  const store = {
    cards: [card],
    nodes: [],
    getCard: () => card,
    getDocMeta: () => meta,
    updateDocMeta: (_path, patch) => {
      meta = { ...meta, ...patch };
      notifications.push(meta.pdfExtendNotes[0].textBoxes[0]);
    },
    save: () => previewSaved.resolve(),
  };
  const extend = new ExtendNotes({
    plugin: { store },
    getFilePath: () => path,
    getDocumentNotebookId: () => "default",
    getPdfPageEdits: () => ({ pages: [{ id: "page" }] }),
    getPageBaseSize: () => ({ width: 500 }),
    getPageNumbers: () => [],
    refreshExtendLayout: async () => {},
    recordExtendEdit: () => {},
  });

  globalThis[renderer] = async () => {
    await delay(250);
    previewFinished = true;
    return "data:image/png;base64,preview";
  };
  const resized = { ...frame, w: .5, h: .3 };
  try {
    const committed = extend.update(note.id, { textBoxes: [resized] });
    assert.deepEqual(notifications, [resized], "Store did not publish the resized frame at commit");
    await committed;
    assert.deepEqual(extend.notes()[0].textBoxes, [resized]);
    assert.equal(previewFinished, false);
    await previewSaved.promise;
    assert.equal(previewFinished, true);
    assert.equal(card.extendMedia[0].image, "data:image/png;base64,preview");
  } finally {
    delete globalThis[renderer];
  }
});
