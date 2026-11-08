import assert from "node:assert/strict";
import { build } from "esbuild";
import { webcrypto } from "node:crypto";
import { createRequire } from "node:module";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

globalThis.crypto ??= webcrypto;
const dir = await mkdtemp(join(tmpdir(), "ms-a24-"));
try {
  const built = await build({ entryPoints: [join(dirname(fileURLToPath(import.meta.url)), "condense.ts")], bundle: true, platform: "node", format: "cjs", write: false });
  const path = join(dir, "condense.cjs");
  await writeFile(path, built.outputFiles[0].contents);
  const { CondenseService } = createRequire(import.meta.url)(path);
  const fixture = () => {
    const profile = { id: "test", revision: 1, endpoint: "https://example.test/chat/completions", normalModel: "model" };
    let calls = 0, offline = false;
    const ai = { configuration: () => ({ ...profile }), isBound: () => true, request: async input => {
      calls++;
      if (offline) throw new Error("offline");
      return { text: input.text };
    } };
    return { service: new CondenseService(ai), profile, calls: () => calls, offline: () => { offline = true; } };
  };
  const input = { text: "测试材料", level: "sentence", language: "中文" };
  {
    const f = fixture();
    await f.service.request(input);
    await f.service.request(input);
    assert.equal(f.calls(), 1);
    console.log("PASS same tier: provider calls 1");
  }
  {
    const f = fixture();
    for (const level of ["sentence", "points", "outline", "points", "sentence"]) await f.service.request({ ...input, level });
    assert.equal(f.calls(), 3);
    console.log("PASS missing tiers only: provider calls 3");
  }
  {
    const f = fixture();
    await f.service.request(input);
    f.offline();
    assert.equal((await f.service.request(input)).cached, true);
    assert.equal(f.calls(), 1);
    console.log("PASS cache hit offline: provider calls 1");
  }
  {
    const f = fixture();
    await f.service.request(input);
    await f.service.request({ ...input, text: "不同材料" });
    await f.service.request({ ...input, level: "points" });
    await f.service.request({ ...input, language: "English" });
    f.profile.normalModel = "other-model";
    await f.service.request(input);
    assert.equal(f.calls(), 5);
    console.log("PASS text, tier, language and model independently partition cache");
  }
} finally {
  await rm(dir, { recursive: true, force: true });
}
