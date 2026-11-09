import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { build } from "esbuild";

export async function runMobileStartup(root, temporary) {
  const obsidian = (await readFile(join(root, "src/workspace/obsidian-fixture.txt"), "utf8"))
    .replace("export const Platform={isMobile:false};", "export const Platform={isMobile:true};")
    .replace("export class Setting { constructor(_container:any){} }", `
      export const settingNames:string[]=[];
      class Control { inputEl:any={}; setValue(_value:any){return this;} setDisabled(_value:any){return this;} setLimits(..._args:any[]){return this;} addOption(..._args:any[]){return this;} onChange(_action:any){return this;} }
      export class Setting { constructor(_container:any){} setName(name:string){settingNames.push(name);(globalThis as any).__a27SettingNames.push(name);return this;} setDesc(_value:any){return this;} addTextArea(action:any){action(new Control());return this;} addText(action:any){action(new Control());return this;} addDropdown(action:any){action(new Control());return this;} addSlider(action:any){action(new Control());return this;} addToggle(action:any){action(new Control());return this;} }
    `)
    .replace("addRibbonIcon(){} addSettingTab(){}", "addRibbonIcon(){} addSettingTab(tab:any){(this as any).settingTab=tab;}");
  const fakePdf = (await readFile(join(root, "src/documents/acceptance-fixtures/fakePdf.txt"), "utf8")) + "\nexport async function initPdfWorker() {}\n";
  const output = await build({ entryPoints: [join(root, "src/main.ts")], bundle: true, platform: "node", format: "cjs", write: false,
    plugins: [{ name: "mobile-host", setup(builder) {
      builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "mobile" }));
      builder.onResolve({ filter: /\/pdfjs$/ }, () => ({ path: "pdfjs", namespace: "mobile" }));
      builder.onResolve({ filter: /\/localCliServer$/ }, () => ({ path: "desktop-server", namespace: "mobile" }));
      builder.onLoad({ filter: /.*/, namespace: "mobile" }, ({ path }) => ({ loader: "ts", contents: path === "obsidian" ? obsidian : path === "pdfjs" ? fakePdf : "(globalThis as any).__a27ServerLoads++; export function createLocalCliServer(){throw new Error('desktop server loaded on mobile');}" }));
    } }] });
  const bundle = join(temporary, "mobile.cjs"); await writeFile(bundle, output.outputFiles[0].contents);
  const old = { window: globalThis.window, document: globalThis.document, serverLoads: globalThis.__a27ServerLoads, settingNames: globalThis.__a27SettingNames };
  const events = { addEventListener() {}, removeEventListener() {} };
  globalThis.__a27ServerLoads = 0;
  globalThis.__a27SettingNames = [];
  globalThis.window = { ...events, setTimeout, clearTimeout };
  globalThis.document = { ...events, body: { classList: { add() {}, remove() {} } }, createElement: () => ({ empty() {} }) };
  try {
    const Plugin = createRequire(import.meta.url)(bundle).default;
    const reference = () => ({ off() {} });
    const app = { vault: { configDir: ".obsidian", getFiles: () => [], getAbstractFileByPath: () => null, on: reference, adapter: { read: async () => "" } },
      workspace: { on: reference, onLayoutReady() {} } };
    const plugin = new Plugin(app);
    await plugin.onload();
    assert.ok(plugin.store);
    assert.equal(plugin.localCli, null);
    assert.equal(globalThis.__a27ServerLoads, 0);
    await assert.rejects(plugin.enableLocalCli(), /移动端/);
    assert.equal(globalThis.__a27ServerLoads, 0);
    plugin.settingTab.display();
    assert.ok(globalThis.__a27SettingNames.includes("标注颜色"));
    assert.ok(!globalThis.__a27SettingNames.some(name => /本地 CLI 连接|本地连接状态|本地令牌|允许本地写入/.test(name)));
    assert.equal(plugin.localCli, null);
    plugin.onunload();
    assert.equal(globalThis.__a27ServerLoads, 0);
    return { platform: "Platform.isMobile=true", pluginLoaded: true, desktopServerInitializations: 0, portRequired: false, settingsDisplayed: true };
  } finally {
    if (old.window === undefined) delete globalThis.window; else globalThis.window = old.window;
    if (old.document === undefined) delete globalThis.document; else globalThis.document = old.document;
    if (old.serverLoads === undefined) delete globalThis.__a27ServerLoads; else globalThis.__a27ServerLoads = old.serverLoads;
    if (old.settingNames === undefined) delete globalThis.__a27SettingNames; else globalThis.__a27SettingNames = old.settingNames;
  }
}
