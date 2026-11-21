import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../../src/styles/styles-workspace.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const media = /@media\s*\(\s*max-width\s*:\s*900px\s*\)\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g;
const declarations = {};
let block;
while ((block = media.exec(css))) {
  for (const rule of block[1].matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!rule[1].split(",").some((selector) => selector.trim() === ".ms-workspace-tab")) continue;
    for (const declaration of rule[2].split(";")) {
      const separator = declaration.indexOf(":");
      if (separator < 0) continue;
      declarations[declaration.slice(0, separator).trim()] = declaration.slice(separator + 1).trim();
    }
  }
}

if (!/^\d+(?:\.\d+)?px$/.test(declarations["min-width"] ?? "") || parseFloat(declarations["min-width"]) < 76) {
  console.error("tab-width-guard: min-width must be at least 76px");
  process.exit(1);
}
if (declarations["max-width"] !== "none") {
  console.error("tab-width-guard: max-width must override the base percentage with none");
  process.exit(1);
}
console.log("tab-width-guard: PASS");
