// Leaf-level JSON diff (added / removed / changed) between two JSON files.
import fs from "node:fs";

const [leftPath, rightPath, outPath] = process.argv.slice(2);
const left = JSON.parse(fs.readFileSync(leftPath, "utf8"));
const right = JSON.parse(fs.readFileSync(rightPath, "utf8"));
const changes = [];
const short = value => {
  const text = JSON.stringify(value);
  return text === undefined ? null : text.length > 220 ? text.slice(0, 220) + `…(${text.length} chars)` : text;
};
function walk(a, b, path) {
  if (a === b) return;
  const objectish = v => v && typeof v === "object";
  if (objectish(a) && objectish(b)) {
    const arrayish = Array.isArray(a) && Array.isArray(b);
    if (Array.isArray(a) !== Array.isArray(b)) { changes.push({ path, kind: "type", left: short(a), right: short(b) }); return; }
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    if (arrayish && keys.size > 0) { if (JSON.stringify(a) !== JSON.stringify(b)) changes.push({ path: path + "[]", kind: "array", left: short(a), right: short(b) }); return; }
    for (const key of keys) {
      if (!(key in a)) changes.push({ path: `${path}.${key}`, kind: "added", right: short(b[key]) });
      else if (!(key in b)) changes.push({ path: `${path}.${key}`, kind: "removed", left: short(a[key]) });
      else walk(a[key], b[key], `${path}.${key}`);
    }
    return;
  }
  changes.push({ path, kind: "changed", left: short(a), right: short(b) });
}
walk(left, right, "$");
const byTop = {};
for (const change of changes) { const top = change.path.split(".")[1] ?? "(root)"; byTop[top] = (byTop[top] ?? 0) + 1; }
const report = { left: leftPath, right: rightPath, changeCount: changes.length, byTopLevelKey: byTop, changes: changes.slice(0, 400) };
if (outPath) fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ changeCount: report.changeCount, byTopLevelKey: byTop }, null, 1));
for (const change of changes.slice(0, 40)) console.log(change.kind, change.path, change.left ?? change.right);