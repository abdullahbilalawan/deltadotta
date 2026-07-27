import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { promisify } from "node:util";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

async function writeExecutable(path: string, source: string) {
  await writeFile(path, `#!/usr/bin/env node\n${source}`);
  await chmod(path, 0o755);
}

describe("complete organization acceptance workflow", () => {
  it("takes one mixed-source organization through review, both provider installs, and behavioral verification", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "deltadotta-acceptance-"));
    const output = join(workspace, "package");
    const executableDirectory = join(workspace, "bin");
    const gitRepository = join(workspace, "remote-handbook");
    await mkdir(join(workspace, "docs"), { recursive: true });
    await mkdir(join(workspace, "services"), { recursive: true });
    await mkdir(executableDirectory, { recursive: true });
    await mkdir(gitRepository, { recursive: true });

    await writeFile(join(workspace, "docs", "leaders.json"), JSON.stringify({
      roles: [
        {
          title: "Chief Executive Officer",
          department: "Leadership",
          purpose: "Set company direction and resolve cross-company tradeoffs.",
          responsibilities: ["Company strategy"],
          authority: ["Approve company strategy"],
          inputs: ["Board priorities"],
          outputs: ["Company operating priorities"],
        },
        {
          title: "Operations Lead",
          department: "Operations",
          reports_to: "Chief Executive Officer",
          purpose: "Coordinate safe and reliable daily operations.",
          responsibilities: ["Daily operations"],
          authority: ["Stop unsafe work"],
          inputs: ["Company operating priorities"],
          outputs: ["Weekly operating review"],
        },
      ],
    }, null, 2));
    await writeFile(join(workspace, "services", "ownership.ts"), `
// Role: Engineering Lead
// Owns: Application delivery
// Authority: Pause unsafe releases
export const deliveryOwner = "Engineering Lead";
`);

    await execFileAsync("git", ["init", "-b", "main", gitRepository]);
    await execFileAsync("git", ["-C", gitRepository, "config", "user.email", "acceptance@example.invalid"]);
    await execFileAsync("git", ["-C", gitRepository, "config", "user.name", "DeltaDotta Acceptance"]);
    await writeFile(join(gitRepository, "customer-team.json"), JSON.stringify({
      roles: [{
        title: "Customer Success Lead",
        department: "Customer",
        reports_to: "Chief Executive Officer",
        purpose: "Turn customer outcomes into retention and expansion decisions.",
        responsibilities: ["Customer health"],
        authority: ["Approve customer recovery plans"],
        inputs: ["Customer feedback"],
        outputs: ["Customer health review"],
      }],
    }, null, 2));
    await execFileAsync("git", ["-C", gitRepository, "add", "customer-team.json"]);
    await execFileAsync("git", ["-C", gitRepository, "commit", "-m", "add customer team"]);

    let authenticatedDocumentRequest = false;
    const server = createServer((request, response) => {
      if (request.headers.authorization !== "Bearer integration-doc-token") {
        response.writeHead(401);
        response.end("unauthorized");
        return;
      }
      authenticatedDocumentRequest = true;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        roles: [{
          title: "Finance Lead",
          department: "Finance",
          reports_to: "Chief Executive Officer",
          purpose: "Keep resource decisions grounded in current financial data.",
          responsibilities: ["Budget and runway"],
          authority: ["Approve spend within finance policy"],
          inputs: ["Department forecasts"],
          outputs: ["Monthly financial review"],
        }],
      }));
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));

    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("acceptance server did not expose a port");
      const externalDocument = `http://127.0.0.1:${address.port}/finance.json?format=organization-export`;

      await writeExecutable(join(executableDirectory, "pg_dump"), `
if (process.argv.join(" ").includes("database-password")) process.exit(3);
if (process.env.PGPASSWORD !== "database-password") process.exit(4);
process.stdout.write("CREATE TABLE role_directory (title text, department text, reports_to text, authority text);\\n");
`);
      await writeExecutable(join(executableDirectory, "psql"), `
if (process.argv.join(" ").includes("database-password")) process.exit(3);
if (process.env.PGPASSWORD !== "database-password") process.exit(4);
process.stdout.write(JSON.stringify([
  {
    title: "Operations Lead",
    department: "Customer Operations",
    reports_to: "Finance Lead",
    purpose: "Coordinate customer-facing operations.",
    responsibilities: ["Customer operations"],
    authority: ["Approve customer recovery workflow"],
    inputs: ["Customer health"],
    outputs: ["Customer operations review"]
  },
  {
    title: "People Operations Manager",
    department: "People",
    reports_to: "Chief Executive Officer",
    purpose: "Keep people operations consistent and accountable.",
    responsibilities: ["People operations"],
    authority: ["Approve handbook operations within policy"],
    inputs: ["Leadership decisions"],
    outputs: ["People operations update"]
  }
]) + "\\n");
`);
      await writeFile(join(workspace, "database-queries.json"), JSON.stringify({
        schemaVersion: "1.0",
        connections: [{
          name: "people-system",
          urlEnv: "COMPANY_DATABASE_URL",
          queries: [{
            name: "role-directory",
            sql: "SELECT title, department, reports_to, purpose, responsibilities, authority, inputs, outputs FROM role_directory",
          }],
        }],
      }, null, 2));

      const environment = {
        ...process.env,
        PATH: `${executableDirectory}${delimiter}${process.env.PATH ?? ""}`,
        DELTADOTTA_DOC_TOKEN: "integration-doc-token",
        COMPANY_DATABASE_URL: "postgresql://reader:database-password@db.example.com/company",
      };
      const onboarded = await execFileAsync("node", [
        "dist/bin/deltadotta.js", "onboard",
        "--repo", workspace,
        "--source", "docs/leaders.json",
        "--source", "services",
        "--git", `${gitRepository}#main`,
        "--url", externalDocument,
        "--http-token-env", "DELTADOTTA_DOC_TOKEN",
        "--database-url-env", "COMPANY_DATABASE_URL",
        "--database-query-manifest", "database-queries.json",
        "--name", "Integrated Company",
        "--provider", "chatgpt",
        "--output", output,
        "--yes",
        "--no-open",
      ], { env: environment });
      const graph = JSON.parse(await readFile(join(output, "graph.json"), "utf8"));
      const evidence = graph.organization.evidence as Array<{
        name: string;
        sourceType: string;
        sourceConnector: string;
        sourceLocator?: string;
      }>;
      const serializedGraph = JSON.stringify(graph);

      expect(onboarded.stdout).toContain("Package ready for human review");
      expect(authenticatedDocumentRequest).toBe(true);
      expect(new Set(evidence.map((item) => item.sourceType))).toEqual(new Set(["document", "codebase", "database"]));
      expect(new Set(evidence.map((item) => item.sourceConnector))).toEqual(new Set(["local", "git", "https", "postgresql"]));
      expect(evidence.filter((item) => item.sourceType === "database")).toHaveLength(2);
      expect(graph.organization.sourceConflicts).toHaveLength(2);
      expect(await readFile(join(output, "GAPS.md"), "utf8")).toContain("UNRESOLVED");
      expect(serializedGraph).not.toContain("database-password");
      expect(serializedGraph).not.toContain("integration-doc-token");
      expect(serializedGraph).not.toContain("format=organization-export");

      const expectedTitles = [
        "Chief Executive Officer",
        "Operations Lead",
        "Engineering Lead",
        "Customer Success Lead",
        "Finance Lead",
        "People Operations Manager",
      ];
      const reviewLocation = join(output, "review", "organization.review.json");
      const review = JSON.parse(await readFile(reviewLocation, "utf8"));
      const reviewByTitle = new Map(review.organization.roles.map((role: { title: string }) => [role.title, role]));
      expectedTitles.forEach((title) => expect(reviewByTitle.has(title), `missing inferred role: ${title}`).toBe(true));
      const fallbackEvidence = graph.organization.evidence.map((item: { name: string }) => item.name);
      review.reviewedBy = "Casey Morgan, Chief Operating Officer";
      review.reviewedAt = "2026-07-26T19:00:00Z";
      review.organization.roles = expectedTitles.map((title) => {
        const source = reviewByTitle.get(title) as Record<string, unknown>;
        const topLevel = title === "Chief Executive Officer";
        return {
          ...source,
          department: title === "Operations Lead" ? "Operations" : source.department,
          reportsTo: topLevel ? null : "Chief Executive Officer",
          purpose: `${title} turns reviewed company inputs into accountable operating decisions.`,
          owns: [`${title} decision domain`],
          inputs: [`Reviewed inputs for ${title}`],
          outputs: [`Auditable decisions from ${title}`],
          permissions: [topLevel ? "Approve cross-company operating decisions" : `Approve ${title} decisions within reviewed policy`],
          collaborators: topLevel ? expectedTitles.slice(1) : ["Chief Executive Officer"],
          escalatesTo: topLevel ? null : "Chief Executive Officer",
          evidence: Array.isArray(source.evidence) && source.evidence.length ? source.evidence : fallbackEvidence,
          confirmed: true,
        };
      });
      const reviewedOperations = review.organization.roles.find((role: { title: string }) => role.title === "Operations Lead");
      review.organization.sourceConflicts.forEach((conflict: { field: string; resolution: string; resolved: boolean }) => {
        conflict.resolved = true;
        conflict.resolution = conflict.field === "department"
          ? reviewedOperations.department
          : reviewedOperations.reportsTo;
      });
      await writeFile(reviewLocation, JSON.stringify(review, null, 2));

      const refined = await execFileAsync("node", [
        "dist/bin/deltadotta.js", "refine",
        "--package", output,
        "--review", reviewLocation,
      ], { env: environment });
      const validated = await execFileAsync("node", [
        "dist/bin/deltadotta.js", "validate",
        "--package", output,
      ], { env: environment });
      expect(refined.stdout).toContain("Readiness: ready");
      expect(validated.stdout).toContain("Readiness: ready");
      const reviewedGraph = JSON.parse(await readFile(join(output, "graph.json"), "utf8"));
      expect(reviewedGraph.organization.sourceConflicts.every((conflict: { resolution?: unknown }) => Boolean(conflict.resolution))).toBe(true);
      expect(reviewedGraph.organization.ingestion).toMatchObject({
        status: "complete",
        sourceCount: evidence.length,
        warnings: [],
      });
      expect(reviewedGraph.organization.ingestion.durationMs).toBeLessThan(10_000);

      for (const provider of ["chatgpt", "claude"] as const) {
        const installed = await execFileAsync("node", [
          "dist/bin/deltadotta.js", "install",
          "--provider", provider,
          "--package", output,
          "--no-open",
        ], { env: environment });
        expect(installed.stdout).toContain(provider === "chatgpt" ? "https://chatgpt.com/" : "https://claude.ai/projects");

        const suite = JSON.parse(await readFile(join(output, "validation", "provider-evaluation-cases.json"), "utf8"));
        const submissionLocation = join(output, "providers", provider, "EVALUATION-RESPONSES.json");
        const submission = {
          schemaVersion: "1.0",
          provider,
          evaluatedBy: "Casey Morgan, Chief Operating Officer",
          evaluatedAt: "2026-07-26T20:00:00Z",
          projectUrl: provider === "chatgpt"
            ? "https://chatgpt.com/g/g-integrated-company/project"
            : "https://claude.ai/project/integrated-company",
          responses: suite.cases.map((item: {
            id: string;
            expected: { role: string; decision: string; escalation: string | null; anySource: string[] };
          }) => ({
            caseId: item.id,
            output: {
              caseId: item.id,
              role: item.expected.role,
              decision: item.expected.decision,
              escalation: item.expected.escalation,
              sources: item.expected.anySource,
              unsupportedClaims: [],
              rationale: "Grounded in the reviewed organization package.",
            },
          })),
        };
        await writeFile(submissionLocation, JSON.stringify(submission, null, 2));
        const evaluated = await execFileAsync("node", [
          "dist/bin/deltadotta.js", "evaluate",
          "--package", output,
          "--results", submissionLocation,
        ], { env: environment });
        const report = JSON.parse(await readFile(join(output, "validation", "provider-evaluation.json"), "utf8"));
        expect(evaluated.stdout).toContain("Status: verified");
        expect(report).toMatchObject({ provider, status: "verified", score: 100 });
        const archive = await JSZip.loadAsync(await readFile(`${output}.zip`));
        const archivedReport = JSON.parse(await archive
          .file("deltadotta-package/validation/provider-evaluation.json")!
          .async("text"));
        expect(archivedReport).toMatchObject({ provider, status: "verified", score: 100 });
        expect(await archive.file("deltadotta-package/validation/readiness.md")!.async("text"))
          .toBe(await readFile(join(output, "validation", "readiness.md"), "utf8"));

        const revalidated = await execFileAsync("node", [
          "dist/bin/deltadotta.js", "validate",
          "--package", output,
        ], { env: environment });
        expect(revalidated.stdout).toContain("Readiness: ready");
      }
    } finally {
      await new Promise<void>((done, reject) => server.close((error) => error ? reject(error) : done()));
    }
  }, 30_000);
});
