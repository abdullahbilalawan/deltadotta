import { execFile } from "node:child_process";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("DeltaDotta CLI argument handling", () => {
  it("supports option-first onboarding and --option=value syntax", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "deltadotta-option-first-"));
    const destination = join(workspace, "package");
    await writeFile(join(workspace, "roles.json"), JSON.stringify({
      roles: [{
        title: "Chief Executive Officer",
        purpose: "Set company direction.",
        responsibilities: ["Company strategy"],
        authority: ["Approve company strategy"],
      }],
    }));

    const result = await execFileAsync("node", [
      "dist/bin/deltadotta.js",
      `--repo=${workspace}`,
      "--source=roles.json",
      "--name=Option First Company",
      "--provider=chatgpt",
      `--output=${destination}`,
      "--yes",
      "--no-open",
    ]);
    const graph = JSON.parse(await readFile(join(destination, "graph.json"), "utf8"));

    expect(result.stdout).toContain("Package ready for human review");
    expect(graph.organization.name).toBe("Option First Company");
  });

  it("rejects unknown options before a typo can trigger fallback scanning", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "deltadotta-option-typo-"));
    const destination = join(workspace, "package");
    await writeFile(join(workspace, "roles.json"), "Role: Chief Executive Officer");

    await expect(execFileAsync("node", [
      "dist/bin/deltadotta.js", "onboard",
      "--repo", workspace,
      "--soruce", "roles.json",
      "--output", destination,
      "--yes",
      "--no-open",
    ])).rejects.toMatchObject({
      code: 1,
      stdout: expect.stringContaining("Unknown onboard option: --soruce"),
    });
    await expect(stat(destination)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects missing values, duplicate singleton options, and positional arguments", async () => {
    await expect(execFileAsync("node", [
      "dist/bin/deltadotta.js", "onboard", "--source", "--name", "Company",
    ])).rejects.toMatchObject({
      code: 1,
      stdout: expect.stringContaining("--source requires a value"),
    });
    await expect(execFileAsync("node", [
      "dist/bin/deltadotta.js", "validate", "--package", "one", "--package", "two",
    ])).rejects.toMatchObject({
      code: 1,
      stdout: expect.stringContaining("--package may be supplied only once"),
    });
    await expect(execFileAsync("node", [
      "dist/bin/deltadotta.js", "validate", "unexpected",
    ])).rejects.toMatchObject({
      code: 1,
      stdout: expect.stringContaining("does not accept positional argument"),
    });
  });

  it("reports help and version without starting onboarding", async () => {
    const packageMetadata = JSON.parse(await readFile("package.json", "utf8")) as { version: string };
    const version = await execFileAsync("node", ["dist/bin/deltadotta.js", "--version"]);
    const help = await execFileAsync("node", ["dist/bin/deltadotta.js", "merge", "--help"]);

    expect(version.stdout.trim()).toBe(`DeltaDotta ${packageMetadata.version}`);
    expect(help.stdout).toContain("DeltaDotta CLI");
    expect(help.stdout).toContain("deltadotta merge");
    expect(help.stdout).toContain("Unknown, misspelled, missing, and duplicate");
  });
});
