import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { runUIAcceptance } from "./ui-acceptance-runner.mjs";

const pdf = new URL("../documents/acceptance-fixtures/synthetic.pdf", import.meta.url);
const hash = async () => createHash("sha256").update(await readFile(pdf)).digest("hex");
const before = await hash();
try {
  await runUIAcceptance({ fixtureName: "a16-ui-fixture.txt", prefix: "marginstudy-a16-ui", label: "A16" });
} finally {
  const after = await hash();
  console.log(`Synthetic source PDF SHA-256: ${before} -> ${after}`);
  if (before !== after) { console.error("Synthetic source PDF changed"); process.exitCode = 1; }
}
