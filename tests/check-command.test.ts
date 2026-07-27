import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("deltadotta check", () => {
  it("uses the recorded source base when only a package path is supplied", async () => {
    const repo = await mkdtemp(join(tmpdir(), "deltadotta-check-base-"));
    const output = join(repo, "package");
    await writeFile(join(repo, "roles.json"), JSON.stringify({
      roles: [{ title: "Chief Executive Officer", responsibilities: ["Company direction"] }],
    }));
    await execFileAsync("node", [
      "dist/bin/deltadotta.js", "onboard",
      "--repo", repo,
      "--source", "roles.json",
      "--name", "Recorded Base Company",
      "--provider", "chatgpt",
      "--output", output,
      "--yes",
      "--no-open",
    ]);

    const fresh = await execFileAsync("node", [
      "dist/bin/deltadotta.js", "check",
      "--package", output,
    ]);
    expect(fresh.stdout).toContain("Evidence is fresh (local)");

    await writeFile(join(repo, "roles.json"), JSON.stringify({
      roles: [{ title: "Chief Executive Officer", responsibilities: ["Changed company direction"] }],
    }));
    await expect(execFileAsync("node", [
      "dist/bin/deltadotta.js", "check",
      "--package", output,
    ])).rejects.toMatchObject({
      code: 2,
      stdout: expect.stringContaining("changed: roles.json"),
    });
  });

  it("never reports external snapshots as current without fetching them again", async () => {
    const packageFolder = await mkdtemp(join(tmpdir(), "deltadotta-check-external-"));
    await writeFile(join(packageFolder, "graph.json"), JSON.stringify({
      schemaVersion: "1.0",
      organization: {
        name: "External Company",
        mission: "Keep external knowledge current.",
        version: 1,
        updatedAt: "Just now",
        roles: [{
          id: "organization-lead",
          title: "Organization Lead",
          department: "Leadership",
          purpose: "Own the operating model.",
          owns: ["Organization direction"],
          inputs: ["External evidence"],
          outputs: ["Operating decisions"],
          permissions: [],
          collaborators: [],
          evidenceIds: ["external-source"],
          status: "draft",
        }],
        evidence: [{
          id: "external-source",
          name: "Document: current-roles.json",
          kind: "document",
          excerpt: "Role: Organization Lead",
          importedAt: "Just now",
          sourceHash: "sha256-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          sourceType: "document",
          sourceConnector: "https",
          sourceLocator: "https://example.invalid/current-roles.json",
        }],
      },
    }));

    await expect(execFileAsync("node", [
      "dist/bin/deltadotta.js", "check",
      "--package", packageFolder,
    ])).rejects.toMatchObject({
      code: 2,
      stdout: expect.stringContaining("Needs refresh verification: 1 fingerprinted snapshot"),
    });
  });

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
