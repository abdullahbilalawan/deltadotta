import { chmod, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function writeNodeCommand(
  directory: string,
  name: string,
  source: string,
) {
  if (process.platform === "win32") {
    const scriptName = `${name}.cjs`;
    await writeFile(join(directory, scriptName), source);
    await writeFile(
      join(directory, `${name}.cmd`),
      `@echo off\r\nnode "%~dp0${scriptName}" %*\r\n`,
    );
    return;
  }

  const executable = join(directory, name);
  await writeFile(executable, `#!/usr/bin/env node\n${source}`);
  await chmod(executable, 0o755);
}
