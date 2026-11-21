// 将 pdfjs-dist 的 CMap 和标准字体转为 Base64。
// 构建脚本将 cmaps.json 注入 PDF worker，供离线渲染读取。
import { readdirSync, readFileSync, writeFileSync } from "fs";
import { createRequire } from "module";
import { dirname, join } from "path";

const require = createRequire(import.meta.url);
const pkgDir = dirname(require.resolve("pdfjs-dist/package.json"));

function mapDir(dir) {
  const out = {};
  let total = 0;
  for (const f of readdirSync(dir)) {
    const buf = readFileSync(join(dir, f));
    total += buf.length;
    out[f] = buf.toString("base64");
  }
  return { out, total };
}

const cmaps = mapDir(join(pkgDir, "cmaps"));
const fonts = mapDir(join(pkgDir, "standard_fonts"));

const jsonPath = join(process.cwd(), "src", "pdf", "cmaps.json");
writeFileSync(jsonPath, JSON.stringify({ cmap: cmaps.out, font: fonts.out }), "utf8");

console.log(
  `Generated ${jsonPath}: cmaps ${Object.keys(cmaps.out).length} (${(cmaps.total / 1024).toFixed(1)} KB), fonts ${Object.keys(fonts.out).length} (${(fonts.total / 1024).toFixed(1)} KB).`
);
