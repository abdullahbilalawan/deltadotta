import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const sourceCount = 500;
const workspace = await mkdtemp(join(tmpdir(), "deltadotta-cli-benchmark-"));
const documents = join(workspace, "documents");
const destination = join(workspace, "package");
const filler = "Operating context, dependencies, escalation, and handoff details. ".repeat(110);

function run(command, args, acceptedExitCodes = [0]) {
  return new Promise((done, reject) => {
    const child = spawn(command, args, {
      cwd: resolve("."),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (acceptedExitCodes.includes(code)) done({ stdout, stderr, code });
      else reject(new Error(`benchmark command exited ${code}\n${stdout}\n${stderr}`));
    });
  });
}

try {
  await mkdir(documents);
  await Promise.all(Array.from({ length: sourceCount }, (_, index) => {
    const padded = String(index).padStart(3, "0");
    return writeFile(join(documents, `team-${padded}.md`), `# Team ${index} Lead
Purpose: Own team ${index} delivery.
Responsibilities:
- Team ${index} operations
Authority:
- Approve team ${index} workflow
Reports to: Chief Executive Officer
${filler}`);
  }));

  const startedAt = performance.now();
  await run(process.execPath, [
    "dist/bin/deltadotta.js",
    "onboard",
    "--repo", workspace,
    "--source", "documents",
    "--name", "Wide Benchmark Company",
    "--provider", "chatgpt",
    "--output", destination,
    "--yes",
    "--no-open",
  ]);
  const elapsedMs = performance.now() - startedAt;
  const validationStartedAt = performance.now();
  await run(process.execPath, [
    "dist/bin/deltadotta.js",
    "validate",
    "--package", destination,
  ], [2]);
  const validationMs = performance.now() - validationStartedAt;
  const graph = JSON.parse(await readFile(join(destination, "graph.json"), "utf8"));
  const retainedSources = graph.organization?.evidence?.length ?? 0;
  if (retainedSources !== sourceCount) {
    throw new Error(`benchmark retained ${retainedSources} of ${sourceCount} selected sources`);
  }
  const maximumMs = Number(process.env.DELTADOTTA_BENCHMARK_MAX_MS ?? "0");
  if (maximumMs > 0 && elapsedMs > maximumMs) {
    throw new Error(`benchmark took ${Math.round(elapsedMs)} ms, above DELTADOTTA_BENCHMARK_MAX_MS=${maximumMs}`);
  }
  const chatgptProviderFolder = join(destination, "providers", "chatgpt");
  const providerKnowledgeFiles = (await readdir(chatgptProviderFolder))
    .filter((name) => /^KNOWLEDGE(?:-\d{3})?\.md$/.test(name));
  const providerKnowledgeSizes = await Promise.all(
    providerKnowledgeFiles.map((name) => stat(join(chatgptProviderFolder, name))),
  );
  const result = {
    elapsedMs: Math.round(elapsedMs),
    validationMs: Math.round(validationMs),
    ingestionMs: graph.organization.ingestion?.durationMs ?? null,
    retainedSources,
    inferredRoles: graph.organization.roles?.length ?? 0,
    providerKnowledgeParts: providerKnowledgeFiles.length,
    providerKnowledgeBytes: providerKnowledgeSizes.reduce((total, file) => total + file.size, 0),
    largestProviderKnowledgePartBytes: Math.max(...providerKnowledgeSizes.map((file) => file.size)),
    portableArchiveBytes: (await stat(`${destination}.zip`)).size,
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  await rm(workspace, { recursive: true, force: true });
}
