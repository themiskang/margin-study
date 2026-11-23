import { renameFixture, run, sourcePath, targetPath } from "./fixture-support.mjs";

await run("B5-04", async (project, check) => {
  const fixture = await renameFixture(project, true);
  const paths = [sourcePath, targetPath];
  const diskValues = () => paths.flatMap(path => [fixture.disk.get(path), fixture.disk.get(fixture.sidecar(path))]);
  const before = diskValues();
  const annotations = await Promise.all(paths.map(path => fixture.read(path)));
  const messages = await fixture.log(async () => {
    fixture.emitRename(sourcePath, targetPath);
    await fixture.settled();
  });
  check("both source and destination bytes preserved", diskValues(), before);
  check("both annotation keys preserved", await Promise.all(paths.map(path => fixture.read(path))), annotations);
  const conflict = messages.find(message => /冲突|已存在|已有|EEXIST|already exists|(?:path|target|destination) conflict/i.test(message));
  check("recognizable conflict error", conflict ? "conflict" : messages, "conflict");
});
