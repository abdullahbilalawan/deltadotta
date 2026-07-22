import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("deltadotta check", () => {
  it("reports changed repository evidence, not only missing files", async () => {
    const repo = await mkdtemp(join(tmpdir(), "deltadotta-check-"));
    await mkdir(join(repo, "docs"), { recursive: true });
    await writeFile(join(repo, "README.md"), "# Demo\nOriginal owner: Platform\n", "utf8");

    await execFileAsync("node", [
      "dist/bin/deltadotta.js", "launch",
      "--repo", repo,
      "--template", "software",
      "--name", "Demo Engineering",
      "--provider", "codex",
      "--owner", "Engineering Lead",
      "--operating-authority", "Platform may stop unsafe deployments.",
      "--escalation-owner", "Engineering Lead",
      "--handoff-target", "Product Engineering",
      "--yes",
      "--no-install",
      "--no-open",
    ]);

    await writeFile(join(repo, "README.md"), "# Demo\nNew owner: Release Manager\n", "utf8");

    try {
      await execFileAsync("node", ["dist/bin/deltadotta.js", "check", "--repo", repo]);
      throw new Error("check unexpectedly passed");
    } catch (error) {
      const result = error as { stdout?: string; code?: number };
      expect(result.code).toBe(2);
      expect(result.stdout).toContain("changed: README.md");
    }
  });
});
