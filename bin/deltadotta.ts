#!/usr/bin/env node

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import JSZip from "jszip";
import {
  applyFirstShiftReport,
  compilePackage,
  createOrganizationFromEvidence,
  createTeamLaunchpad,
  evidenceHash,
  FirstShiftReport,
  knowledgeEvidence,
  launchAuthority,
  markPrimaryRoleInstalled,
  mergeOrganization,
  Organization,
  organizationFromInterview,
  parseImportedPackage,
  ProviderTarget,
  repositoryEvidence,
  RepositorySource,
  roleSkill,
  SourceReplayPlan,
  TeamTemplate,
  verifyFirstShift,
} from "../lib/organization.js";
import { renderOrganizationMap } from "../lib/cli-viewer.js";
import { collectKnowledgeSources, extractSqliteSchema, mergeSourceScanResults } from "../lib/source-ingestion.js";
import { collectExternalSources, sanitizeExternalLocator } from "../lib/external-ingestion.js";
import { collectDatabaseKnowledge } from "../lib/database-knowledge.js";
import { findSourceSecrets } from "../lib/source-safety.js";
import { applyOrganizationReview } from "../lib/organization-review.js";
import { evaluateOrganizationReadiness, readinessMarkdown, type OrganizationReadinessReport } from "../lib/readiness.js";
import {
  providerEvaluationReportMarkdown,
  scoreProviderEvaluation,
  type ProviderEvaluationReport,
} from "../lib/provider-evaluation.js";
import { isGeneratedPackagePath } from "../lib/package-paths.js";
import { portableIdentifier } from "../lib/identifiers.js";
import { readBoundedFile, readBoundedUtf8File } from "../lib/bounded-files.js";

const help = `DeltaDotta CLI

Usage:
  deltadotta
  deltadotta [onboard] [options]
  deltadotta --source <path> [--source <path> ...] [onboard options]
  deltadotta onboard [--source <path> ...] [--url <https-url> ...] [--git <repository[#ref]> ...]
  deltadotta merge --package <base-folder> --with <team-folder> [--with <team-folder> ...]
  deltadotta refresh [--package <folder>] [--output <folder>] [--no-open]
  deltadotta refine [--package <folder>] [--review <review.json>] [--output <folder>]
  deltadotta validate [--package <folder>]
  deltadotta install --provider <chatgpt|claude> [--package <folder>] [--no-open]
  deltadotta evaluate --results <responses.json> [--package <folder>]
  deltadotta launch [advanced options]
  deltadotta init [--output <folder>] [--no-open]
  deltadotta check [--repo <folder>] [--package <folder>]
  deltadotta --help
  deltadotta --version

Commands:
  (none)  Start onboarding. Options may come first; the onboard word is optional.
  onboard Scan local and external documents, codebases, and selected database evidence; infer a
          reviewable organization draft, and prepare Claude and ChatGPT bundles:
          --source <path> (repeatable) --database <path> (repeatable)
          --url <https-url> (repeatable) --http-token-env <environment-variable>
          --git <repository-url[#ref]> (repeatable)
          --database-url <postgresql-or-mysql-url> (repeatable)
          --database-url-env <environment-variable> (repeatable; preferred for secrets)
          --database-query-manifest <queries.json> (repeatable; selected read-only rows)
          --provider <claude|chatgpt|claude-code|codex> --name <name>
          --mission <text> --repo <base-folder> --output <folder> --yes --no-open
          --review <organization.review.json>
          --allow-secret-patterns (only after reviewing every flagged source)
  merge   Combine independently onboarded team packages into one organization:
          --package <base-folder> --with <team-folder> (repeatable)
          --name <organization-name> --mission <text> --output <folder> --no-open
          Package order is preserved; newly combined conflicts block readiness and
          every merged role requires a fresh accountable review.
  refresh Re-ingest every replayable source plan in a package, rebuild merged teams,
          and require a fresh review. Tokens and database URLs are read from their
          recorded environment-variable names and are never stored in the package.
  refine  Apply the canonical human review file, rebuild provider bundles, and
          report whether the organization is ready or still has blockers.
  validate Recompute package readiness from graph.json and the actual package files.
  install  Validate the package, open the official provider project surface, and
           show the exact instructions, files, and behavioral test workflow.
  evaluate Score raw JSON responses from the installed Claude or ChatGPT Project.
  launch  Same guided flow. Advanced options are available for scripting:
          --template <software|manufacturing> --repo <folder> --output <folder>
          --name <name> --provider <claude-code|codex> --yes --no-open --no-install
  init    The deeper, open-ended organization interview.
  check   Reports fingerprinted evidence that moved, changed, or disappeared.

Onboard creates upload-ready Claude and ChatGPT bundles. Local inputs stay local;
external inputs connect only to the locations explicitly supplied. Launch installs
local Claude Code or Codex context. Unknown, misspelled, missing, and duplicate
single-use options stop before any source scan or package write. Repeatable options
are labeled above. Both --option value and --option=value forms are accepted.
`;

const ignoredDirectories = new Set([".git", ".next", ".turbo", "node_modules", "dist", "build", "coverage", ".deltadotta"]);
const textExtensions = /(?:\.md|\.mdx|\.txt|\.csv|\.json|\.ya?ml|\.toml|\.ini|\.conf|\.sh|\.bash|\.zsh|\.js|\.ts|\.tsx|\.py|\.go|\.rb)$/i;
const maxScanFiles = 120;
const maxSourceBytes = 28_000;
const maxPackagedGraphBytes = 256_000_000;
const maxReviewBytes = 64_000_000;
const maxDatabaseQueryManifestBytes = 2_000_000;
const maxProviderEvaluationBytes = 32_000_000;
const maxManagedArtifactBytes = 32_000_000;
const maxCheckTextBytes = 128_000;
const maxCheckBinaryBytes = 25_000_000;
const maxDatabaseQueryManifests = 10;
const databaseQueryManifestConcurrency = 2;
const maxMergePackages = 25;

async function readCliVersion() {
  try {
    const packageMetadata = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8")) as { version?: unknown };
    if (typeof packageMetadata.version === "string" && packageMetadata.version.trim()) return packageMetadata.version;
  } catch {
    // A damaged installation is reported consistently without preventing help or onboarding.
  }
  return "unknown";
}

const cliVersion = await readCliVersion();

type CommandOptionSpec = {
  values?: string[];
  repeatable?: string[];
  flags?: string[];
};

const commandOptionSpecs: Record<string, CommandOptionSpec> = {
  onboard: {
    values: ["--provider", "--name", "--mission", "--repo", "--output", "--review", "--http-token-env"],
    repeatable: ["--source", "--database", "--url", "--git", "--database-url", "--database-url-env", "--database-query-manifest"],
    flags: ["--yes", "--no-open", "--allow-secret-patterns"],
  },
  merge: {
    values: ["--package", "--name", "--mission", "--output"],
    repeatable: ["--with"],
    flags: ["--no-open", "--allow-secret-patterns"],
  },
  refresh: {
    values: ["--package", "--output"],
    flags: ["--no-open", "--allow-secret-patterns"],
  },
  refine: { values: ["--package", "--review", "--output"] },
  validate: { values: ["--package"] },
  install: {
    values: ["--provider", "--package"],
    flags: ["--no-open"],
  },
  evaluate: {
    values: ["--results", "--package"],
    flags: ["--allow-secret-patterns"],
  },
  launch: {
    values: [
      "--template", "--repo", "--output", "--name", "--provider", "--owner",
      "--operating-authority", "--deploy-authority", "--escalation-owner", "--handoff-target",
    ],
    flags: ["--yes", "--no-open", "--no-install"],
  },
  init: {
    values: ["--output"],
    flags: ["--no-open"],
  },
  check: { values: ["--repo", "--package"] },
};

function normalizeCliArgs(args: string[]) {
  return args.flatMap((argument) => {
    if (argument === "--") return [];
    if (!argument.startsWith("--") || !argument.includes("=")) return [argument];
    const separator = argument.indexOf("=");
    return [argument.slice(0, separator), argument.slice(separator + 1)];
  });
}

function validateCommandArgs(command: string, args: string[]) {
  const spec = commandOptionSpecs[command];
  if (!spec) return;
  const valueOptions = new Set([...(spec.values ?? []), ...(spec.repeatable ?? [])]);
  const repeatable = new Set(spec.repeatable ?? []);
  const flags = new Set(spec.flags ?? []);
  const seen = new Map<string, number>();
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    if (!option.startsWith("-")) {
      throw new Error(`${command} does not accept positional argument ${JSON.stringify(option)}.`);
    }
    if (option === "-h" || option === "--help" || option === "-v" || option === "--version") continue;
    if (!valueOptions.has(option) && !flags.has(option)) {
      throw new Error(`Unknown ${command} option: ${option}. Run deltadotta ${command} --help for supported options.`);
    }
    const count = (seen.get(option) ?? 0) + 1;
    seen.set(option, count);
    if (count > 1 && !repeatable.has(option)) {
      throw new Error(`${option} may be supplied only once for ${command}.`);
    }
    if (!valueOptions.has(option)) continue;
    const value = args[index + 1];
    if (value === undefined || !value.trim() || value.startsWith("-")) {
      throw new Error(`${option} requires a value for ${command}.`);
    }
    index += 1;
  }
}

function argumentValue(args: string[], name: string) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function argumentValues(args: string[], name: string) {
  return args.flatMap((value, index) => value === name && args[index + 1] ? [args[index + 1]] : []);
}

function hasFlag(args: string[], name: string) {
  return args.includes(name);
}

async function mapConcurrent<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index]);
    }
  }));
  return results;
}

function titleFromPath(path: string) {
  return basename(path).replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) || "Team";
}

function sameAsOrAncestorOf(candidate: string, target: string) {
  const pathFromCandidate = relative(candidate, target);
  return pathFromCandidate === "" || (!pathFromCandidate.startsWith("..") && !isAbsolute(pathFromCandidate));
}

function isTemplate(value: string): value is TeamTemplate {
  return value === "software" || value === "manufacturing";
}

function templateDetails(template: TeamTemplate) {
  return template === "software"
    ? { label: "Software", ownerPrompt: "Who owns engineering delivery", ownerDefault: "Engineering Lead", authorityPrompt: "Who may approve or stop a deployment", authorityDefault: "DevOps / Platform Engineer", escalationPrompt: "Who receives a production escalation", handoffPrompt: "Who receives the incident follow-up handoff", primaryRole: "DevOps / Platform Engineer" }
    : { label: "Manufacturing", ownerPrompt: "Who owns manufacturing operations", ownerDefault: "Manufacturing Director", authorityPrompt: "Who may stop an unsafe line or authorize a controlled restart", authorityDefault: "Production Operations Lead", escalationPrompt: "Who receives a safety or quality escalation", handoffPrompt: "Who receives the equipment or process follow-up handoff", primaryRole: "Production Operations Lead" };
}

async function multiLine(question: string, rl: ReturnType<typeof createInterface>) {
  output.write(`\n${question}\nType one item per line. Press Enter on an empty line when finished.\n`);
  const values: string[] = [];
  while (true) {
    const answer = (await rl.question(values.length ? "  · " : "  > ")).trim();
    if (!answer) return values;
    values.push(answer);
  }
}

async function requireAnswer(question: string, rl: ReturnType<typeof createInterface>) {
  while (true) {
    const answer = (await rl.question(question)).trim();
    if (answer) return answer;
    output.write("  Please enter a value.\n");
  }
}

async function answerWithDefault(question: string, fallback: string, rl: ReturnType<typeof createInterface>) {
  const answer = (await rl.question(`${question} [${fallback}]: `)).trim();
  return answer || fallback;
}

async function chooseOption<T extends string>(question: string, choices: Array<{ value: T; label: string; detail: string }>, fallback: T, rl: ReturnType<typeof createInterface>) {
  output.write(`\n${question}\n`);
  choices.forEach((choice, index) => output.write(`  ${index + 1}. ${choice.label}\n     ${choice.detail}\n`));
  while (true) {
    const answer = (await rl.question(`Choose 1-${choices.length} [${choices.findIndex((choice) => choice.value === fallback) + 1}]: `)).trim().toLowerCase();
    if (!answer) return fallback;
    const byNumber = Number.parseInt(answer, 10);
    if (Number.isInteger(byNumber) && choices[byNumber - 1]) return choices[byNumber - 1].value;
    const byValue = choices.find((choice) => choice.value === answer);
    if (byValue) return byValue.value;
    output.write(`  Please choose a number from 1 to ${choices.length}.\n`);
  }
}

async function confirm(question: string, rl: ReturnType<typeof createInterface>) {
  const answer = (await rl.question(`${question} [Y/n]: `)).trim().toLowerCase();
  return !answer || answer === "y" || answer === "yes";
}

function openMap(location: string) {
  const child = process.platform === "win32"
    ? execFile("cmd", ["/c", "start", "", location])
    : process.platform === "darwin"
      ? execFile("open", [location])
      : execFile("xdg-open", [location]);
  child.on("error", () => output.write(`  Map created at ${location}. Open it in any browser.\n`));
}

async function writeFiles(destination: string, files: Record<string, string>) {
  await mapConcurrent(Object.entries(files), 16, async ([path, content]) => {
    const location = resolve(destination, path);
    await mkdir(dirname(location), { recursive: true });
    await writeFile(location, content, "utf8");
  });
}

async function packageZipBuffer(files: Record<string, string>) {
  const zip = new JSZip();
  Object.entries(files).forEach(([path, content]) => zip.file(`deltadotta-package/${path}`, content));
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
}

async function updateManagedPackageArtifacts(
  destination: string,
  existingFiles: Record<string, string>,
  updates: Record<string, string>,
) {
  const updatePaths = Object.keys(updates).sort();
  const unsafePath = updatePaths.find((path) => !isGeneratedPackagePath(path));
  if (unsafePath) throw new Error(`Refusing to update unmanaged package path: ${unsafePath}`);
  const destinationStats = await stat(destination);
  if (!destinationStats.isDirectory()) throw new Error(`package path is not a folder: ${destination}`);
  const archiveLocation = `${destination}.zip`;
  let existingArchive = false;
  if (await pathExists(archiveLocation)) {
    const archiveStats = await stat(archiveLocation);
    if (!archiveStats.isFile()) throw new Error(`package archive exists and is not a file: ${archiveLocation}`);
    existingArchive = true;
  }

  const transaction = await mkdtemp(resolve(dirname(destination), `.${basename(destination)}-update-`));
  const stagedFiles = resolve(transaction, "files");
  const backupFiles = resolve(transaction, "backups");
  const stagedArchive = resolve(transaction, "package.zip");
  const backupArchive = resolve(transaction, "package.zip.backup");
  const installedPaths: string[] = [];
  const backedUpPaths: string[] = [];
  let archiveMoved = false;
  let archiveInstalled = false;
  try {
    await writeFiles(stagedFiles, updates);
    await writeFile(stagedArchive, await packageZipBuffer({ ...existingFiles, ...updates }));
    for (const path of updatePaths) {
      const target = resolve(destination, path);
      const staged = resolve(stagedFiles, path);
      if (await pathExists(target)) {
        const backup = resolve(backupFiles, path);
        await mkdir(dirname(backup), { recursive: true });
        await rename(target, backup);
        backedUpPaths.push(path);
      }
      await mkdir(dirname(target), { recursive: true });
      await rename(staged, target);
      installedPaths.push(path);
    }
    if (existingArchive) {
      await rename(archiveLocation, backupArchive);
      archiveMoved = true;
    }
    await rename(stagedArchive, archiveLocation);
    archiveInstalled = true;
  } catch (error) {
    const rollbackErrors: string[] = [];
    if (archiveInstalled) {
      try { await rm(archiveLocation, { force: true }); } catch (rollbackError) { rollbackErrors.push(String(rollbackError)); }
    }
    if (archiveMoved) {
      try { await rename(backupArchive, archiveLocation); } catch (rollbackError) { rollbackErrors.push(String(rollbackError)); }
    }
    for (const path of [...installedPaths].reverse()) {
      try { await rm(resolve(destination, path), { force: true }); } catch (rollbackError) { rollbackErrors.push(String(rollbackError)); }
    }
    for (const path of [...backedUpPaths].reverse()) {
      try {
        const target = resolve(destination, path);
        await mkdir(dirname(target), { recursive: true });
        await rename(resolve(backupFiles, path), target);
      } catch (rollbackError) {
        rollbackErrors.push(String(rollbackError));
      }
    }
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(rollbackErrors.length
      ? `Package artifact update failed: ${detail}. Rollback also reported: ${rollbackErrors.join("; ")}`
      : `Package artifact update failed safely: ${detail}`);
  } finally {
    await rm(transaction, { force: true, recursive: true }).catch(() => {});
  }
  return archiveLocation;
}

async function readPackagedOrganization(packageFolder: string) {
  const graphLocation = resolve(packageFolder, "graph.json");
  try {
    const graph = JSON.parse(await readBoundedUtf8File(
      graphLocation,
      maxPackagedGraphBytes,
      "package graph",
    ));
    return parseImportedPackage(graph).organization;
  } catch (error) {
    throw new Error(`Could not read a DeltaDotta package at ${packageFolder}: ${error instanceof Error ? error.message : "unknown error"}`);
  }
}

async function readImportableOrganization(packageFolder: string) {
  const graphLocation = resolve(packageFolder, "graph.json");
  try {
    const graph = JSON.parse(await readBoundedUtf8File(
      graphLocation,
      maxPackagedGraphBytes,
      "imported package graph",
    ));
    return parseImportedPackage(graph).organization;
  } catch (error) {
    throw new Error(`Could not import a DeltaDotta package at ${packageFolder}: ${error instanceof Error ? error.message : "unknown error"}`);
  }
}

async function ensureUnusedPackageDestination(destination: string, packageFolders: string[], operation: string) {
  if (packageFolders.includes(destination)) {
    throw new Error(`${operation} output must be different from every input package folder.`);
  }
  try {
    const destinationStats = await stat(destination);
    if (!destinationStats.isDirectory()) throw new Error(`${operation} output exists and is not a folder: ${destination}`);
    if ((await readdir(destination)).length) {
      throw new Error(`${operation} output folder is not empty: ${destination}`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  try {
    await stat(`${destination}.zip`);
    throw new Error(`${operation} output archive already exists: ${destination}.zip`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

async function pathExists(path: string) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function generatedFilesIn(folder: string, current = folder): Promise<string[]> {
  const found: string[] = [];
  let entries;
  try { entries = await readdir(current, { withFileTypes: true }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return found;
    throw error;
  }
  for (const entry of entries) {
    const location = resolve(current, entry.name);
    if (entry.isDirectory()) found.push(...await generatedFilesIn(folder, location));
    else if (entry.isFile()) {
      const path = relative(folder, location).replace(/\\/g, "/");
      if (isGeneratedPackagePath(path)) found.push(path);
    }
  }
  return found;
}

async function writeOrganizationPackage(destination: string, organization: Organization) {
  const files = compilePackage(organization);
  const map = renderOrganizationMap(organization);
  const packageFiles: Record<string, string> = { ...files, "organization-map.html": map };
  const managedFiles = Object.keys(packageFiles).filter(isGeneratedPackagePath).sort();
  packageFiles["validation/generated-files.json"] = JSON.stringify({
    schemaVersion: "1.0",
    files: managedFiles,
  }, null, 2);
  const parent = dirname(destination);
  await mkdir(parent, { recursive: true });
  const stage = await mkdtemp(resolve(parent, `.${basename(destination)}-stage-`));
  const archiveLocation = `${destination}.zip`;
  const transactionId = randomUUID();
  const archiveStage = resolve(parent, `.${basename(destination)}-${transactionId}.zip.stage`);
  const destinationBackup = resolve(parent, `.${basename(destination)}-${transactionId}.backup`);
  const archiveBackup = resolve(parent, `.${basename(destination)}-${transactionId}.zip.backup`);
  let oldDestinationMoved = false;
  let oldArchiveMoved = false;
  let newDestinationInstalled = false;
  let newArchiveInstalled = false;
  try {
    if (await pathExists(destination)) {
      const destinationStats = await stat(destination);
      if (!destinationStats.isDirectory()) throw new Error(`package output exists and is not a folder: ${destination}`);
      await cp(destination, stage, { recursive: true, force: true });
      const oldGeneratedFiles = await generatedFilesIn(stage);
      await Promise.all(oldGeneratedFiles.map((path) => rm(resolve(stage, path), { force: true })));
    }
    await writeFiles(stage, packageFiles);
    await writeFile(archiveStage, await packageZipBuffer(packageFiles));
    if (await pathExists(destination)) {
      await rename(destination, destinationBackup);
      oldDestinationMoved = true;
    }
    if (await pathExists(archiveLocation)) {
      const archiveStats = await stat(archiveLocation);
      if (!archiveStats.isFile()) throw new Error(`package archive exists and is not a file: ${archiveLocation}`);
      await rename(archiveLocation, archiveBackup);
      oldArchiveMoved = true;
    }
    await rename(stage, destination);
    newDestinationInstalled = true;
    await rename(archiveStage, archiveLocation);
    newArchiveInstalled = true;
  } catch (error) {
    const rollbackErrors: string[] = [];
    if (newArchiveInstalled) {
      try { await rm(archiveLocation, { force: true }); } catch (rollbackError) { rollbackErrors.push(String(rollbackError)); }
    }
    if (newDestinationInstalled) {
      try { await rm(destination, { force: true, recursive: true }); } catch (rollbackError) { rollbackErrors.push(String(rollbackError)); }
    }
    if (oldDestinationMoved) {
      try { await rename(destinationBackup, destination); } catch (rollbackError) { rollbackErrors.push(String(rollbackError)); }
    }
    if (oldArchiveMoved) {
      try { await rename(archiveBackup, archiveLocation); } catch (rollbackError) { rollbackErrors.push(String(rollbackError)); }
    }
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(rollbackErrors.length
      ? `Package replacement failed: ${detail}. Rollback also reported: ${rollbackErrors.join("; ")}`
      : `Package replacement failed safely: ${detail}`);
  } finally {
    await rm(stage, { force: true, recursive: true }).catch(() => {});
    await rm(archiveStage, { force: true }).catch(() => {});
  }
  await rm(destinationBackup, { force: true, recursive: true }).catch(() => {});
  await rm(archiveBackup, { force: true }).catch(() => {});
  const mapLocation = resolve(destination, "organization-map.html");
  const readiness = JSON.parse(files["validation/readiness.json"]) as OrganizationReadinessReport;
  return { files, mapLocation, archiveLocation, readiness };
}

async function runMerge(args: string[]) {
  const baseInput = argumentValue(args, "--package");
  if (!baseInput) throw new Error("merge requires --package <base-folder>.");
  const additionalInputs = argumentValues(args, "--with");
  if (!additionalInputs.length) throw new Error("merge requires at least one --with <team-folder>.");
  if (additionalInputs.length + 1 > maxMergePackages) {
    throw new Error(`merge supports at most ${maxMergePackages} packages per run.`);
  }
  const packageFolders = [baseInput, ...additionalInputs].map((folder) => resolve(folder));
  if (new Set(packageFolders).size !== packageFolders.length) {
    throw new Error("merge package inputs must be unique.");
  }
  const organizations = await mapConcurrent(packageFolders, 4, readImportableOrganization);
  let merged = organizations[0];
  for (const incoming of organizations.slice(1)) merged = mergeOrganization(merged, incoming);
  merged = {
    ...merged,
    name: argumentValue(args, "--name")?.trim() || merged.name,
    mission: argumentValue(args, "--mission")?.trim() || merged.mission,
  };
  const secretFindings = findSourceSecrets(merged.evidence.map((evidence) => ({
    path: evidence.sourcePath ?? evidence.sourceLocator ?? evidence.name,
    content: evidence.excerpt,
    sourceType: evidence.sourceType,
  })));
  if (secretFindings.length && !hasFlag(args, "--allow-secret-patterns")) {
    throw new Error(`Potential credentials were found in merged evidence (${secretFindings[0].categories.join(", ")}), so no combined package was written.`);
  }
  const destination = resolve(argumentValue(args, "--output") ?? ".deltadotta/merged");
  await ensureUnusedPackageDestination(destination, packageFolders, "merge");
  const { mapLocation, archiveLocation, readiness } = await writeOrganizationPackage(destination, merged);
  const mismatchedNames = organizations.slice(1)
    .map((organization) => organization.name)
    .filter((name) => name.toLowerCase() !== organizations[0].name.toLowerCase());

  output.write("\n✓ Team packages merged into one reviewable organization\n");
  output.write(`  Organization: ${merged.name}\n`);
  output.write(`  Packages: ${organizations.length}\n`);
  output.write(`  Roles: ${merged.roles.length}; all require fresh confirmation\n`);
  output.write(`  Cross-source conflicts: ${merged.sourceConflicts?.length ?? 0}\n`);
  output.write(`  Readiness: ${readinessSummary(readiness)}\n`);
  output.write(`  Combined package: ${destination}\n`);
  output.write(`  Portable local archive (do not upload whole): ${archiveLocation}\n`);
  output.write(`  Organization map: ${mapLocation}\n`);
  if (mismatchedNames.length) {
    output.write(`  Source package names differed: ${Array.from(new Set(mismatchedNames)).join(", ")}\n`);
  }
  output.write("  Next: review every role and conflict in review/organization.review.json, then run deltadotta refine.\n");
  if (hasFlag(args, "--no-open")) output.write("  Map opening skipped.\n\n");
  else {
    openMap(mapLocation);
    output.write("  Opening the combined organization map in your browser…\n\n");
  }
}

async function runRefresh(args: string[]) {
  const packageFolder = resolve(argumentValue(args, "--package") ?? ".deltadotta/onboarding");
  const existing = await readImportableOrganization(packageFolder);
  const plans = existing.sourcePlans ?? [];
  if (!plans.length) {
    throw new Error("This package has no source replay plans. Recreate it with deltadotta onboard before using refresh.");
  }
  if (plans.length > maxMergePackages) {
    throw new Error(`refresh supports at most ${maxMergePackages} source plans per run.`);
  }
  const nonReplayable = plans.filter((plan) => !plan.replayable);
  if (nonReplayable.length) {
    const limitations = nonReplayable
      .flatMap((plan) => plan.limitations.map((limitation) => `${plan.organizationName}: ${limitation}`))
      .join("; ");
    throw new Error(`Refresh stopped before reading sources because ${nonReplayable.length} plan${nonReplayable.length === 1 ? " is" : "s are"} not replayable. ${limitations}`);
  }
  plans.forEach((plan) => {
    if (plan.databaseQueryManifests.length > maxDatabaseQueryManifests) {
      throw new Error(`source plan ${plan.id} exceeds the ${maxDatabaseQueryManifests}-manifest limit.`);
    }
  });
  const destination = resolve(argumentValue(args, "--output") ?? `${packageFolder}-refreshed`);
  await ensureUnusedPackageDestination(destination, [packageFolder], "refresh");
  output.write(`\nΔ Refreshing ${existing.name} from ${plans.length} recorded source plan${plans.length === 1 ? "" : "s"}\n\n`);
  const rebuilt = await mapConcurrent(plans, 4, (plan) => buildOrganizationFromSourcePlan(plan, {
    allowSecretPatterns: hasFlag(args, "--allow-secret-patterns"),
    excludedPaths: [packageFolder, `${packageFolder}.zip`, destination, `${destination}.zip`],
  }));
  let refreshed: Organization = rebuilt[0].organization;
  for (const unit of rebuilt.slice(1)) refreshed = mergeOrganization(refreshed, unit.organization);
  refreshed = {
    ...refreshed,
    name: existing.name,
    mission: existing.mission,
    version: existing.version + 1,
    updatedAt: "Just now",
  };
  const { mapLocation, archiveLocation, readiness } = await writeOrganizationPackage(destination, refreshed);
  const sourceCount = rebuilt.reduce((sum, unit) => sum + unit.scan.sources.length, 0);

  output.write("✓ Organization sources refreshed into a new reviewable package\n");
  output.write(`  Organization: ${refreshed.name}\n`);
  output.write(`  Source plans: ${plans.length}\n`);
  output.write(`  Refreshed sources: ${sourceCount}\n`);
  output.write(`  Roles: ${refreshed.roles.length}; all require fresh confirmation\n`);
  output.write(`  Cross-source conflicts: ${refreshed.sourceConflicts?.length ?? 0}\n`);
  output.write(`  Readiness: ${readinessSummary(readiness)}\n`);
  output.write(`  Refreshed package: ${destination}\n`);
  output.write(`  Portable local archive (do not upload whole): ${archiveLocation}\n`);
  output.write(`  Organization map: ${mapLocation}\n`);
  output.write("  Next: compare the refreshed map, review every role and conflict, then run deltadotta refine.\n");
  if (hasFlag(args, "--no-open")) output.write("  Map opening skipped.\n\n");
  else {
    openMap(mapLocation);
    output.write("  Opening the refreshed organization map in your browser…\n\n");
  }
}

function managedArtifactByteLimit(path: string) {
  if (path === "graph.json") return maxPackagedGraphBytes;
  if (/EVALUATION-RESPONSES\.json$|^validation\/provider-evaluation\.(?:json|md)$/.test(path)) {
    return maxProviderEvaluationBytes;
  }
  return maxManagedArtifactBytes;
}

async function readActualPackageFiles(packageFolder: string) {
  const actualFiles: Record<string, string> = {};
  const paths = await generatedFilesIn(packageFolder);
  await mapConcurrent(paths, 4, async (path) => {
    try {
      actualFiles[path] = await readBoundedUtf8File(
        resolve(packageFolder, path),
        managedArtifactByteLimit(path),
        "managed package artifact",
      );
    }
    catch { /* readiness reports required artifacts that are absent */ }
  });
  return actualFiles;
}

function isCandidateFile(path: string) {
  const normalized = path.replace(/\\/g, "/");
  return textExtensions.test(normalized)
    || /(?:^|\/)(?:CODEOWNERS|Dockerfile|Makefile|Procfile)$/i.test(normalized)
    || /(?:^|\/)(?:\.github\/workflows\/)/i.test(normalized);
}

async function scanRepository(root: string): Promise<RepositorySource[]> {
  const found: RepositorySource[] = [];
  async function visit(folder: string) {
    if (found.length >= maxScanFiles) return;
    let entries;
    try { entries = await readdir(folder, { withFileTypes: true }); }
    catch { return; }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (found.length >= maxScanFiles) return;
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name)) await visit(resolve(folder, entry.name));
        continue;
      }
      if (!entry.isFile()) continue;
      const location = resolve(folder, entry.name);
      const path = relative(root, location).replace(/\\/g, "/");
      if (!isCandidateFile(path)) continue;
      try {
        const content = (await readFile(location, "utf8")).slice(0, maxSourceBytes);
        if (content.includes("\u0000")) continue;
        found.push({ path, content });
      } catch { /* unreadable and binary files are intentionally skipped */ }
    }
  }
  await visit(root);
  return found;
}

async function providerAvailable(provider: "claude-code" | "codex") {
  const command = provider === "claude-code" ? "claude" : "codex";
  return new Promise<boolean>((done) => {
    const child = execFile(command, ["--version"], { timeout: 2_000 }, (error) => done(!error));
    child.on("error", () => done(false));
  });
}

function providerFile(provider: "claude-code" | "codex") {
  return provider === "claude-code" ? "CLAUDE.md" : "AGENTS.md";
}

function providerLabel(provider: "claude-code" | "codex") {
  return provider === "claude-code" ? "Claude Code" : "Codex";
}

function managedBlock(provider: "claude-code" | "codex", roleTitle: string, relativeSkillPath: string) {
  return `\n<!-- deltadotta:start -->\n## DeltaDotta ${roleTitle}\n\nUse the preflighted ${providerLabel(provider)} role context at \`${relativeSkillPath}\`. It is read-only by default: do not deploy, restart equipment, alter infrastructure or operational systems, access production credentials, or modify repository files or production records unless an explicit human instruction changes that boundary.\n<!-- deltadotta:end -->\n`;
}

async function upsertManagedBlock(location: string, block: string) {
  let existing = "";
  try { existing = await readFile(location, "utf8"); } catch { /* create it below */ }
  const start = "<!-- deltadotta:start -->";
  const end = "<!-- deltadotta:end -->";
  const expression = new RegExp(`${start.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?${end.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\n?`, "m");
  const next = expression.test(existing) ? existing.replace(expression, block.trimStart()) : `${existing.trimEnd()}${block}`;
  await mkdir(dirname(location), { recursive: true });
  await writeFile(location, next, "utf8");
}

async function installProviderAdapter(repository: string, destination: string, organization: Organization, provider: "claude-code" | "codex") {
  const primaryRole = organization.roles.find((role) => role.id === organization.launch?.primaryRoleId);
  if (!primaryRole) throw new Error("The selected Launchpad template has no primary role to install.");
  const adapterDirectory = resolve(destination, "providers", provider);
  const adapterLocation = resolve(adapterDirectory, providerFile(provider));
  const relativeRoleSkill = relative(repository, adapterLocation).replace(/\\/g, "/") || providerFile(provider);
  const adapter = `# DeltaDotta ${primaryRole.title} for ${providerLabel(provider)}\n\n${roleSkill(primaryRole, organization)}\n\n## Safety boundary\nThis role is installed for read-only first-shift preflight. Do not deploy, restart equipment, mutate infrastructure or operational systems, access production credentials, edit repository files, or change production records.\n`;
  await mkdir(adapterDirectory, { recursive: true });
  await writeFile(adapterLocation, adapter, "utf8");
  await writeFile(resolve(adapterDirectory, "INSTALL.md"), `# Installed ${providerLabel(provider)} context\n\nDeltaDotta maintains the provider entrypoint in \`${providerFile(provider)}\` at the repository root. The full role context lives at \`${relative(repository, adapterLocation).replace(/\\/g, "/")}\`.\n`, "utf8");
  const entrypoint = resolve(repository, providerFile(provider));
  await upsertManagedBlock(entrypoint, managedBlock(provider, primaryRole.title, relativeRoleSkill));
  return { adapterLocation, entrypoint, available: await providerAvailable(provider) };
}

function reportMarkdown(report: FirstShiftReport) {
  const checks = report.checks.map((check) => `- ${check.passed ? "PASS" : "NEEDS REFINEMENT"} — **${check.name}**: ${check.detail}`).join("\n");
  return `# First-shift preflight\n\n- Provider: ${report.provider}\n- Role: ${report.roleId}\n- Result: ${report.passed ? "PREFLIGHTED" : "NEEDS REFINEMENT"}\n- Safety: read-only; no deployment, infrastructure mutation, production credentials, or repository changes are permitted.\n\n## Scenario\n${report.scenario}\n\n## Checks\n${checks}\n`;
}

function unavailableProviderReport(organization: Organization, provider: "claude-code" | "codex", reason?: string) {
  const report = verifyFirstShift(organization);
  return {
    ...report,
    provider,
    passed: false,
    checks: [...report.checks, { name: "Provider availability", passed: false, detail: reason ?? `${providerLabel(provider)} was not found on PATH. The map and context were generated, but DeltaDotta did not mark the first shift preflighted.` }],
  };
}

function launchSummary(organization: Organization, evidenceCount: number) {
  const roles = organization.roles.map((role) => `  ${role.id === organization.launch?.primaryRoleId ? "★" : "•"} ${role.title} — ${role.launchStatus ?? "mapped"}`).join("\n");
  return `\n${organization.launch?.template === "manufacturing" ? "Manufacturing" : "Software"} Launchpad\n  Organization: ${organization.name}\n  Evidence sources: ${evidenceCount || "none — template defaults will be labeled"}\n${roles}\n`;
}

function isProvider(value: string): value is ProviderTarget {
  return value === "claude" || value === "claude-code" || value === "chatgpt" || value === "codex";
}

function onboardingProviderLabel(provider: ProviderTarget) {
  if (provider === "chatgpt") return "ChatGPT";
  if (provider === "claude") return "Claude";
  return providerLabel(provider);
}

const defaultOrganizationMission = "Turn company knowledge into explicit, source-backed roles, authority, handoffs, and escalation paths.";

function replayableGitInput(input: string, baseDirectory: string) {
  const marker = input.lastIndexOf("#");
  const repositoryInput = marker <= 0 ? input : input.slice(0, marker);
  let repository = sanitizeExternalLocator(repositoryInput);
  try {
    new URL(repositoryInput);
  } catch {
    if (!/^[^@\s]+@[^:\s]+:.+/.test(repositoryInput)) repository = resolve(baseDirectory, repositoryInput);
  }
  if (marker <= 0) return repository;
  const ref = input.slice(marker + 1);
  return ref ? `${repository}#${ref}` : repository;
}

function createSourceReplayPlan(options: {
  baseDirectory: string;
  organizationName: string;
  mission: string;
  provider: ProviderTarget;
  sources: string[];
  databases: string[];
  urls: string[];
  gitRepositories: string[];
  databaseUrlEnvs: string[];
  directDatabaseUrlCount: number;
  databaseQueryManifests: string[];
  excludedPaths?: string[];
  httpTokenEnv?: string;
}) {
  const limitations: string[] = [];
  const urls = options.urls.map((input) => {
    try {
      const parsed = new URL(input);
      if (parsed.search) limitations.push(`Signed or query-bearing URL must be supplied again: ${sanitizeExternalLocator(input)}`);
    } catch {
      // The connector reports malformed URLs during the actual scan.
    }
    return sanitizeExternalLocator(input);
  });
  if (options.directDatabaseUrlCount) {
    limitations.push(`${options.directDatabaseUrlCount} direct database URL${options.directDatabaseUrlCount === 1 ? " was" : "s were"} not stored; use --database-url-env for replayable refresh.`);
  }
  const safeInputs = {
    baseDirectory: options.baseDirectory,
    organizationName: options.organizationName,
    mission: options.mission,
    provider: options.provider,
    sources: options.sources,
    databases: options.databases,
    urls,
    gitRepositories: options.gitRepositories.map((input) => replayableGitInput(input, options.baseDirectory)),
    databaseUrlEnvs: options.databaseUrlEnvs,
    databaseQueryManifests: options.databaseQueryManifests,
    excludedPaths: options.excludedPaths ?? [],
    httpTokenEnv: options.httpTokenEnv,
  };
  return {
    schemaVersion: "1.0" as const,
    id: `source-plan-${evidenceHash(JSON.stringify(safeInputs)).slice(-8)}`,
    recordedAt: new Date().toISOString(),
    ...safeInputs,
    replayable: limitations.length === 0,
    limitations,
  } satisfies SourceReplayPlan;
}

async function buildOrganizationFromSourcePlan(
  plan: SourceReplayPlan,
  options: {
    runtimeUrls?: string[];
    runtimeGitRepositories?: string[];
    runtimeDatabaseUrls?: string[];
    allowSecretPatterns?: boolean;
    excludedPaths?: string[];
  } = {},
) {
  let baseStats;
  try { baseStats = await stat(plan.baseDirectory); }
  catch { throw new Error(`I can’t find the source-plan base folder: ${plan.baseDirectory}`); }
  if (!baseStats.isDirectory()) throw new Error(`The source-plan base must be a folder: ${plan.baseDirectory}`);
  const databaseUrlsFromEnvironment = plan.databaseUrlEnvs.map((name) => {
    const value = process.env[name];
    if (!value) throw new Error(`database URL environment variable ${name} is not set.`);
    return value;
  });
  const databaseUrls = [...(options.runtimeDatabaseUrls ?? []), ...databaseUrlsFromEnvironment];
  const excludedPaths = Array.from(new Set([
    ...(plan.excludedPaths ?? []),
    ...(options.excludedPaths ?? []),
  ]));
  const scanStartedAt = performance.now();
  const [localScan, externalScan, databaseQueryScans] = await Promise.all([
    collectKnowledgeSources({
      baseDirectory: plan.baseDirectory,
      sources: plan.sources,
      databases: plan.databases,
      excludedPaths,
    }),
    collectExternalSources({
      baseDirectory: plan.baseDirectory,
      urls: options.runtimeUrls ?? plan.urls,
      gitRepositories: options.runtimeGitRepositories ?? plan.gitRepositories,
      databaseUrls,
      httpTokenEnv: plan.httpTokenEnv,
    }),
    mapConcurrent(plan.databaseQueryManifests, databaseQueryManifestConcurrency, async (inputPath) => {
      const location = resolve(plan.baseDirectory, inputPath);
      let content: string;
      try {
        content = await readBoundedUtf8File(
          location,
          maxDatabaseQueryManifestBytes,
          "database query manifest",
        );
      } catch (error) {
        throw new Error(`Could not read database query manifest: ${error instanceof Error ? error.message : location}`);
      }
      let value: unknown;
      try { value = JSON.parse(content); }
      catch { throw new Error(`Database query manifest is not valid JSON: ${location}`); }
      return collectDatabaseKnowledge(value);
    }),
  ]);
  const scan = mergeSourceScanResults([localScan, externalScan, ...databaseQueryScans]);
  const failedSources = scan.skipped.filter((item) => item.severity === "error");
  if (failedSources.length) {
    const reasons = failedSources.slice(0, 5).map((item) => `${item.path}: ${item.reason}`).join("; ");
    const hidden = failedSources.length > 5 ? `; and ${failedSources.length - 5} more` : "";
    throw new Error(`Required source import failed, so no incomplete package was written. ${reasons}${hidden}`);
  }
  if (!scan.sources.length) {
    const reasons = scan.skipped.slice(0, 5).map((item) => `${item.path}: ${item.reason}`).join("; ");
    throw new Error(`No supported text sources were found.${reasons ? ` ${reasons}` : ""}`);
  }
  const secretFindings = findSourceSecrets(scan.sources);
  if (secretFindings.length && !options.allowSecretPatterns) {
    const summary = secretFindings
      .slice(0, 8)
      .map((finding) => `${finding.path} (${finding.categories.join(", ")})`)
      .join("; ");
    throw new Error(`Potential credentials were found, so no package was written: ${summary}. Remove or redact them, or rerun with --allow-secret-patterns only after reviewing every flagged source.`);
  }
  const evidence = knowledgeEvidence(scan.sources.map((source) => (
    !source.sourceConnector || source.sourceConnector === "local"
      ? { ...source, sourceBaseDirectory: plan.baseDirectory }
      : source
  )));
  const organization = createOrganizationFromEvidence({
    organizationName: plan.organizationName,
    mission: plan.mission,
    provider: plan.provider,
    evidence,
  });
  return {
    evidence,
    scan,
    organization: {
      ...organization,
      sourcePlans: [{ ...plan, excludedPaths }],
      ingestion: {
        schemaVersion: "1.0" as const,
        status: scan.skipped.length ? "complete-with-warnings" as const : "complete" as const,
        recordedAt: new Date().toISOString(),
        sourceCount: scan.sources.length,
        totalBytes: scan.totalBytes,
        durationMs: Math.max(0, Math.round(performance.now() - scanStartedAt)),
        counts: scan.counts,
        warnings: Array.from(new Map(scan.skipped.map((item) => {
          const id = `source-warning-${evidenceHash(`${item.path}\u0000${item.reason}`).slice(-8)}`;
          return [id, { id, path: item.path, reason: item.reason }];
        })).values()),
      },
    },
  };
}

async function runOnboard(args: string[]) {
  const baseDirectory = resolve(argumentValue(args, "--repo") ?? ".");
  let baseStats;
  try { baseStats = await stat(baseDirectory); } catch { throw new Error(`I can’t find the base folder: ${baseDirectory}`); }
  if (!baseStats.isDirectory()) throw new Error(`The onboarding base must be a folder: ${baseDirectory}`);

  const requestedProvider = argumentValue(args, "--provider");
  if (requestedProvider && !isProvider(requestedProvider)) {
    throw new Error("--provider must be claude, chatgpt, claude-code, or codex.");
  }
  const sourceInputs = argumentValues(args, "--source");
  const databaseInputs = argumentValues(args, "--database");
  const urlInputs = argumentValues(args, "--url");
  const gitInputs = argumentValues(args, "--git");
  const databaseUrlEnvNames = argumentValues(args, "--database-url-env");
  databaseUrlEnvNames.forEach((name) => {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      throw new Error("--database-url-env values must name environment variables.");
    }
  });
  const directDatabaseUrlInputs = argumentValues(args, "--database-url");
  const databaseQueryManifestInputs = argumentValues(args, "--database-query-manifest");
  if (databaseQueryManifestInputs.length > maxDatabaseQueryManifests) {
    throw new Error(`onboard supports at most ${maxDatabaseQueryManifests} database query manifests per run.`);
  }
  const httpTokenEnv = argumentValue(args, "--http-token-env");
  if (httpTokenEnv && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(httpTokenEnv)) {
    throw new Error("--http-token-env must name an environment variable, not contain a token.");
  }
  const rl = createInterface({ input, output });
  try {
    output.write("\nΔ DeltaDotta organization onboarding\n\n");
    output.write("Reading only the local paths and external locations you selected. Nothing is sent to an AI provider.\n");
    const name = argumentValue(args, "--name")
      ?? (hasFlag(args, "--yes") ? titleFromPath(baseDirectory) : await answerWithDefault("\nOrganization name", titleFromPath(baseDirectory), rl));
    const provider = requestedProvider
      ?? (hasFlag(args, "--yes") ? "chatgpt" : await chooseOption("\nWhere will this organization package be used first?", [
        { value: "chatgpt", label: "ChatGPT", detail: "Prepare Project and custom GPT instructions plus compact knowledge." },
        { value: "claude", label: "Claude", detail: "Prepare Project instructions, compact knowledge, and role skills." },
        { value: "codex", label: "Codex", detail: "Prepare the portable package for a coding workspace." },
        { value: "claude-code", label: "Claude Code", detail: "Prepare the portable package for a coding workspace." },
      ], "chatgpt", rl));
    if (!isProvider(provider)) throw new Error("Choose Claude, ChatGPT, Claude Code, or Codex.");
    const destination = resolve(argumentValue(args, "--output") ?? `${baseDirectory}/.deltadotta/onboarding`);
    if (sameAsOrAncestorOf(destination, baseDirectory)) {
      throw new Error("onboard output cannot be the source base folder or one of its ancestors; choose a dedicated package folder.");
    }

    const hasExplicitInput = [
      sourceInputs,
      databaseInputs,
      urlInputs,
      gitInputs,
      directDatabaseUrlInputs,
      databaseUrlEnvNames,
      databaseQueryManifestInputs,
    ].some((values) => values.length > 0);
    const localSourceInputs = sourceInputs.length > 0 ? sourceInputs : (hasExplicitInput ? [] : ["."]);
    const sourcePlan = createSourceReplayPlan({
      baseDirectory,
      organizationName: name,
      mission: argumentValue(args, "--mission")?.trim() || defaultOrganizationMission,
      provider,
      sources: localSourceInputs,
      databases: databaseInputs,
      urls: urlInputs,
      gitRepositories: gitInputs,
      databaseUrlEnvs: databaseUrlEnvNames,
      directDatabaseUrlCount: directDatabaseUrlInputs.length,
      databaseQueryManifests: databaseQueryManifestInputs,
      excludedPaths: [destination, `${destination}.zip`],
      httpTokenEnv,
    });
    const built = await buildOrganizationFromSourcePlan(sourcePlan, {
      runtimeUrls: urlInputs,
      runtimeGitRepositories: gitInputs,
      runtimeDatabaseUrls: directDatabaseUrlInputs,
      allowSecretPatterns: hasFlag(args, "--allow-secret-patterns"),
    });
    const { evidence, scan } = built;
    let organization: Organization = built.organization;
    const reviewInput = argumentValue(args, "--review");
    if (reviewInput) {
      const reviewLocation = resolve(baseDirectory, reviewInput);
      let reviewContent: string;
      try { reviewContent = await readBoundedUtf8File(reviewLocation, maxReviewBytes, "organization review"); }
      catch (error) { throw new Error(`Could not read the organization review file: ${error instanceof Error ? error.message : reviewLocation}`); }
      let reviewValue: unknown;
      try { reviewValue = JSON.parse(reviewContent); }
      catch { throw new Error(`The organization review file is not valid JSON: ${reviewLocation}`); }
      organization = applyOrganizationReview(organization, reviewValue, { sourceHash: evidenceHash(reviewContent) });
    }
    const { mapLocation, archiveLocation, readiness } = await writeOrganizationPackage(destination, organization);
    const selectedBundle = provider === "chatgpt" ? "providers/chatgpt" : provider === "claude" ? "providers/claude" : ".";
    const evidenceCounts = {
      document: evidence.filter((source) => source.sourceType === "document").length,
      codebase: evidence.filter((source) => source.sourceType === "codebase").length,
      database: evidence.filter((source) => source.sourceType === "database").length,
    };

    output.write(`\n✓ ${readiness.status === "ready" ? "Organization package ready" : "Package ready for human review"}\n`);
    output.write(`  Organization: ${organization.name}\n`);
    output.write(`  Sources: ${evidence.length} (${evidenceCounts.document} documents, ${evidenceCounts.codebase} codebase files, ${evidenceCounts.database} database exports)\n`);
    output.write(`  Ingestion time: ${organization.ingestion?.durationMs ?? 0} ms\n`);
    output.write(`  Refresh plan: ${sourcePlan.replayable ? "replayable with deltadotta refresh" : "requires new connector input; see validation/source-plans.md"}\n`);
    output.write(`  Roles: ${organization.roles.length}; ${organization.roles.filter((role) => role.status === "ready").length} confirmed, ${organization.roles.filter((role) => role.status !== "ready").length} awaiting review\n`);
    output.write(`  Readiness: ${readiness.status} (${readiness.score}/100, ${readiness.blockers} blockers, ${readiness.warnings} warnings)\n`);
    output.write(`  Primary target: ${onboardingProviderLabel(provider)}\n`);
    output.write(`  Provider bundle: ${resolve(destination, selectedBundle)}\n`);
    output.write(`  Reviewable package: ${destination}\n`);
    output.write(`  Portable local archive (do not upload whole): ${archiveLocation}\n`);
    output.write(`  Organization map: ${mapLocation}\n`);
    if (scan.skipped.length) {
      output.write(`  Skipped: ${scan.skipped.length} path${scan.skipped.length === 1 ? "" : "s"}; see the reasons below\n`);
      scan.skipped.slice(0, 10).forEach((item) => output.write(`    - ${item.severity === "error" ? "ERROR " : ""}${item.path}: ${item.reason}\n`));
      if (scan.skipped.length > 10) output.write(`    - …and ${scan.skipped.length - 10} more\n`);
    }
    output.write(readiness.status === "ready"
      ? "  Next: run deltadotta validate, then follow the selected provider's INSTALL.md.\n"
      : "  Next: edit review/organization.review.json, then run deltadotta refine --package <folder>.\n");
    if (hasFlag(args, "--no-open") || hasFlag(args, "--yes")) output.write("  Map opening skipped.\n\n");
    else { openMap(mapLocation); output.write("  Opening the organization map in your browser…\n\n"); }
  } finally {
    rl.close();
  }
}

function readinessSummary(report: OrganizationReadinessReport) {
  return `${report.status} — ${report.score}/100, ${report.blockers} blocker${report.blockers === 1 ? "" : "s"}, ${report.warnings} warning${report.warnings === 1 ? "" : "s"}`;
}

function readinessArtifactsCurrent(
  files: Record<string, string>,
  report: OrganizationReadinessReport,
) {
  try {
    const recorded = JSON.parse(files["validation/readiness.json"] ?? "");
    return JSON.stringify(recorded) === JSON.stringify(report)
      && files["validation/readiness.md"] === readinessMarkdown(report);
  } catch {
    return false;
  }
}

function printReadinessIssues(report: OrganizationReadinessReport) {
  report.checks
    .filter((check) => check.status !== "pass")
    .slice(0, 12)
    .forEach((check) => output.write(`  - ${check.status.toUpperCase()}: ${check.title} — ${check.detail}\n`));
  const hidden = report.checks.filter((check) => check.status !== "pass").length - 12;
  if (hidden > 0) output.write(`  - …and ${hidden} more review item${hidden === 1 ? "" : "s"}\n`);
}

async function runRefine(args: string[]) {
  const packageFolder = resolve(argumentValue(args, "--package") ?? ".deltadotta/onboarding");
  const reviewLocation = resolve(argumentValue(args, "--review") ?? `${packageFolder}/review/organization.review.json`);
  const destination = resolve(argumentValue(args, "--output") ?? packageFolder);
  const organization = await readPackagedOrganization(packageFolder);
  let reviewContent: string;
  try { reviewContent = await readBoundedUtf8File(reviewLocation, maxReviewBytes, "organization review"); }
  catch (error) { throw new Error(`Could not read the organization review file: ${error instanceof Error ? error.message : reviewLocation}`); }
  let reviewValue: unknown;
  try { reviewValue = JSON.parse(reviewContent); }
  catch { throw new Error(`The organization review file is not valid JSON: ${reviewLocation}`); }
  const refined = applyOrganizationReview(organization, reviewValue, { sourceHash: evidenceHash(reviewContent) });
  const { mapLocation, archiveLocation, readiness } = await writeOrganizationPackage(destination, refined);

  output.write(`\n✓ Reviewed organization saved\n`);
  output.write(`  Organization: ${refined.name}\n`);
  output.write(`  Roles: ${refined.roles.length}; ${refined.roles.filter((role) => role.status === "ready").length} confirmed\n`);
  output.write(`  Readiness: ${readinessSummary(readiness)}\n`);
  output.write(`  Package: ${destination}\n`);
  output.write(`  Portable local archive (do not upload whole): ${archiveLocation}\n`);
  output.write(`  Organization map: ${mapLocation}\n`);
  if (readiness.status === "ready") {
    output.write("  Next: run deltadotta validate, then follow the selected provider INSTALL.md.\n\n");
  } else {
    printReadinessIssues(readiness);
    output.write("  Next: resolve the blockers in review/organization.review.json and run refine again.\n\n");
    process.exitCode = 2;
  }
}

async function runValidate(args: string[]) {
  const packageFolder = resolve(argumentValue(args, "--package") ?? ".deltadotta/onboarding");
  const organization = await readPackagedOrganization(packageFolder);
  const actualFiles = await readActualPackageFiles(packageFolder);
  const readiness = evaluateOrganizationReadiness(organization, {
    ...actualFiles,
    "validation/readiness.json": actualFiles["validation/readiness.json"] ?? "{}",
    "validation/readiness.md": actualFiles["validation/readiness.md"] ?? "# Readiness pending validation",
  });
  const readinessUpdates = {
    "validation/readiness.json": JSON.stringify(readiness, null, 2),
    "validation/readiness.md": readinessMarkdown(readiness),
  };
  const archiveLocation = `${packageFolder}.zip`;
  if (!readinessArtifactsCurrent(actualFiles, readiness) || !await pathExists(archiveLocation)) {
    await updateManagedPackageArtifacts(packageFolder, actualFiles, readinessUpdates);
  } else if (!(await stat(archiveLocation)).isFile()) {
    throw new Error(`package archive exists and is not a file: ${archiveLocation}`);
  }
  output.write(`\nDeltaDotta organization validation\n`);
  output.write(`  Package: ${packageFolder}\n`);
  output.write(`  Organization: ${organization.name}\n`);
  output.write(`  Readiness: ${readinessSummary(readiness)}\n`);
  printReadinessIssues(readiness);
  output.write(`  Report: ${resolve(packageFolder, "validation/readiness.md")}\n`);
  output.write(`  Portable archive current: ${archiveLocation}\n\n`);
  if (readiness.status !== "ready") process.exitCode = 2;
}

async function runInstall(args: string[]) {
  const packageFolder = resolve(argumentValue(args, "--package") ?? ".deltadotta/onboarding");
  const organization = await readPackagedOrganization(packageFolder);
  const requestedProvider = argumentValue(args, "--provider") ?? organization.launch?.provider;
  if (requestedProvider !== "chatgpt" && requestedProvider !== "claude") {
    throw new Error("install requires --provider chatgpt or --provider claude.");
  }
  const actualFiles = await readActualPackageFiles(packageFolder);
  const readiness = evaluateOrganizationReadiness(organization, actualFiles);
  output.write(`\nDeltaDotta ${onboardingProviderLabel(requestedProvider)} installation assistant\n`);
  output.write(`  Package readiness: ${readinessSummary(readiness)}\n`);
  if (readiness.status !== "ready") {
    printReadinessIssues(readiness);
    output.write("  Installation stopped. Resolve blockers and run validate again.\n\n");
    process.exitCode = 2;
    return;
  }
  if (!readinessArtifactsCurrent(actualFiles, readiness)) {
    output.write("  Installation stopped. The packaged readiness report is stale; run deltadotta validate, review the refreshed report, then try again.\n\n");
    process.exitCode = 2;
    return;
  }
  const providerFolder = resolve(packageFolder, "providers", requestedProvider);
  const providerUrl = requestedProvider === "chatgpt" ? "https://chatgpt.com/" : "https://claude.ai/projects";
  output.write(`  Official project surface: ${providerUrl}\n`);
  output.write(`  Project name: ${organization.name}\n`);
  output.write(`  Reviewed upload manifest: ${resolve(providerFolder, "UPLOAD-MANIFEST.md")}\n`);
  output.write(`  Paste as project instructions: ${resolve(providerFolder, "PROJECT-INSTRUCTIONS.md")}\n`);
  output.write("  Upload as project knowledge:\n");
  const knowledgePaths = Object.keys(actualFiles)
    .filter((path) => new RegExp(`^providers/${requestedProvider}/KNOWLEDGE(?:-\\d{3})?\\.md$`).test(path))
    .sort((left, right) => {
      const leftPrimary = left.endsWith("/KNOWLEDGE.md");
      const rightPrimary = right.endsWith("/KNOWLEDGE.md");
      return leftPrimary === rightPrimary ? left.localeCompare(right) : leftPrimary ? -1 : 1;
    });
  [
    ...knowledgePaths.map((path) => resolve(packageFolder, path)),
    resolve(packageFolder, "ORGANIZATION.md"),
    resolve(packageFolder, "GAPS.md"),
    resolve(packageFolder, "validation", "readiness.md"),
  ].forEach((path) => output.write(`    - ${path}\n`));
  output.write("  Keep the full portable ZIP, graph, review files, and source plans local; they are not provider knowledge.\n");
  output.write(`  Behavioral cases: ${resolve(packageFolder, "validation", "provider-evaluation-cases.md")}\n`);
  output.write(`  Record raw responses in: ${resolve(providerFolder, "EVALUATION-RESPONSES.json")}\n`);
  output.write(`  Then run: deltadotta evaluate --package ${JSON.stringify(packageFolder)} --results ${JSON.stringify(resolve(providerFolder, "EVALUATION-RESPONSES.json"))}\n`);
  output.write("  DeltaDotta does not upload files or change sharing/permissions automatically; those remain visible provider actions.\n");
  if (hasFlag(args, "--no-open")) output.write("  Provider opening skipped.\n\n");
  else {
    openMap(providerUrl);
    output.write(`  Opening ${onboardingProviderLabel(requestedProvider)} in your browser…\n\n`);
  }
}

function printProviderEvaluationFailures(report: ProviderEvaluationReport) {
  report.results.filter((result) => !result.passed).forEach((result) => {
    output.write(`  - FAIL: ${result.caseId}\n`);
    result.checks.filter((check) => !check.passed).forEach((check) => {
      output.write(`      ${check.name}: ${check.detail}\n`);
    });
  });
}

async function runEvaluate(args: string[]) {
  const packageFolder = resolve(argumentValue(args, "--package") ?? ".deltadotta/onboarding");
  const resultsInput = argumentValue(args, "--results");
  if (!resultsInput) throw new Error("evaluate requires --results <responses.json>.");
  const organization = await readPackagedOrganization(packageFolder);
  const actualFiles = await readActualPackageFiles(packageFolder);
  const readiness = evaluateOrganizationReadiness(organization, actualFiles);
  if (readiness.status !== "ready") {
    output.write(`\nProvider evaluation stopped: package readiness is ${readinessSummary(readiness)}.\n`);
    printReadinessIssues(readiness);
    process.exitCode = 2;
    return;
  }
  if (!readinessArtifactsCurrent(actualFiles, readiness)) {
    output.write("\nProvider evaluation stopped: the packaged readiness report is stale. Run deltadotta validate before evaluating the installed project.\n");
    process.exitCode = 2;
    return;
  }
  const resultsLocation = resolve(resultsInput);
  let resultsContent: string;
  try {
    resultsContent = await readBoundedUtf8File(
      resultsLocation,
      maxProviderEvaluationBytes,
      "provider evaluation responses",
    );
  } catch (error) {
    throw new Error(`Could not read provider evaluation responses: ${error instanceof Error ? error.message : resultsLocation}`);
  }
  const secretFindings = findSourceSecrets([{ path: resultsLocation, content: resultsContent, sourceType: "document" }]);
  if (secretFindings.length && !hasFlag(args, "--allow-secret-patterns")) {
    throw new Error(`Potential credentials were found in the provider responses (${secretFindings[0].categories.join(", ")}), so the results were not saved.`);
  }
  let submission: unknown;
  try { submission = JSON.parse(resultsContent); }
  catch { throw new Error(`Provider evaluation responses are not valid JSON: ${resultsLocation}`); }
  const report = scoreProviderEvaluation(organization, submission, {
    sourceHash: evidenceHash(resultsContent),
  });
  const evaluationPaths = [
    "validation/provider-evaluation.responses.json",
    "validation/provider-evaluation.json",
    "validation/provider-evaluation.md",
  ];
  const managedFiles = Array.from(new Set([
    ...Object.keys(actualFiles).filter(isGeneratedPackagePath),
    ...evaluationPaths,
  ])).sort();
  const evaluationUpdates = {
    "validation/provider-evaluation.responses.json": resultsContent,
    "validation/provider-evaluation.json": JSON.stringify(report, null, 2),
    "validation/provider-evaluation.md": providerEvaluationReportMarkdown(report),
    "validation/generated-files.json": JSON.stringify({
      schemaVersion: "1.0",
      files: managedFiles,
    }, null, 2),
  };
  const nextFiles = { ...actualFiles, ...evaluationUpdates };
  const nextReadiness = evaluateOrganizationReadiness(organization, nextFiles);
  const archiveLocation = await updateManagedPackageArtifacts(packageFolder, actualFiles, {
    ...evaluationUpdates,
    "validation/readiness.json": JSON.stringify(nextReadiness, null, 2),
    "validation/readiness.md": readinessMarkdown(nextReadiness),
  });
  output.write(`\nDeltaDotta provider behavioral evaluation\n`);
  output.write(`  Organization: ${organization.name}\n`);
  output.write(`  Provider: ${report.provider}\n`);
  output.write(`  Status: ${report.status}\n`);
  output.write(`  Score: ${report.score}/100 (${report.passed}/${report.total} cases)\n`);
  output.write(`  Report: ${resolve(packageFolder, "validation", "provider-evaluation.md")}\n`);
  output.write(`  Portable archive synchronized: ${archiveLocation}\n`);
  if (report.status !== "verified") {
    printProviderEvaluationFailures(report);
    output.write("  Fix the provider installation or organization package, then rerun every failed case in a fresh project chat.\n\n");
    process.exitCode = 2;
  } else {
    output.write("  The installed project preserved role routing, authority, escalation, and source-grounding behavior for every generated case.\n\n");
  }
}

async function runLaunch(args: string[]) {
  if (argumentValue(args, "--operating-authority") && argumentValue(args, "--deploy-authority")) {
    throw new Error("Use either --operating-authority or the legacy --deploy-authority alias, not both.");
  }
  const requestedTemplate = argumentValue(args, "--template");
  if (requestedTemplate && !isTemplate(requestedTemplate)) throw new Error("--template must be software or manufacturing.");
  const requestedProvider = argumentValue(args, "--provider");
  if (requestedProvider && requestedProvider !== "claude-code" && requestedProvider !== "codex") throw new Error("--provider must be claude-code or codex. ChatGPT uses the portable import guide in this release.");
  const rl = createInterface({ input, output });
  try {
    output.write("\nΔ Welcome to DeltaDotta\n\nWe’ll turn scattered team knowledge into a practical map, one safe AI role, and a reusable skills package. This usually takes under 10 minutes.\n");
    const repositoryInput = argumentValue(args, "--repo") ?? (hasFlag(args, "--yes") ? "." : await answerWithDefault("\nStep 1 — Where is the team workspace", resolve("."), rl));
    const repository = resolve(repositoryInput);
    let repositoryStats;
    try { repositoryStats = await stat(repository); } catch { throw new Error(`I can’t find that folder: ${repository}`); }
    if (!repositoryStats.isDirectory()) throw new Error(`That location is not a folder: ${repository}`);
    const templateChoice = requestedTemplate ?? (hasFlag(args, "--yes") ? "software" : await chooseOption("\nStep 2 — What kind of team are you setting up?", [
      { value: "software", label: "Software team", detail: "Engineering, DevOps, Design, and QA." },
      { value: "manufacturing", label: "Manufacturing team", detail: "Production, Quality, Process, and Maintenance." },
    ], "software", rl));
    if (!isTemplate(templateChoice)) throw new Error("Choose software or manufacturing.");
    const template = templateChoice;
    const details = templateDetails(template);
    const name = argumentValue(args, "--name") ?? (hasFlag(args, "--yes") ? `${titleFromPath(repository)} ${details.label}` : await answerWithDefault("\nStep 3 — What should we call this team", `${titleFromPath(repository)} ${details.label}`, rl));
    output.write("\nI’m looking through local runbooks, workflow files, ownership files, and existing instructions…\n");
    const scanned = await scanRepository(repository);
    const evidence = repositoryEvidence(scanned);
    output.write(`Found ${evidence.length} useful source${evidence.length === 1 ? "" : "s"} in ${scanned.length} readable file${scanned.length === 1 ? "" : "s"}. They’ll stay linked as tribal knowledge evidence.\n\n`);
    output.write("Now, five quick confirmations. Press Enter to keep the suggested answer.\n");
    const owner = argumentValue(args, "--owner") ?? await answerWithDefault(`\n1/5 ${details.ownerPrompt}`, details.ownerDefault, rl);
    const explicitAuthority = argumentValue(args, "--operating-authority") ?? argumentValue(args, "--deploy-authority");
    const authorityOwner = explicitAuthority ?? await answerWithDefault(`2/5 ${details.authorityPrompt}`, details.authorityDefault, rl);
    const operatingAuthority = explicitAuthority ?? launchAuthority(template, authorityOwner);
    const escalationOwner = argumentValue(args, "--escalation-owner") ?? await answerWithDefault(`3/5 ${details.escalationPrompt}`, owner, rl);
    const handoffTarget = argumentValue(args, "--handoff-target") ?? await answerWithDefault(`4/5 ${details.handoffPrompt}`, owner, rl);
    const availability = await Promise.all([providerAvailable("codex"), providerAvailable("claude-code")]);
    const defaultProvider = availability[0] ? "codex" : availability[1] ? "claude-code" : "codex";
    const providerChoice = requestedProvider ?? (hasFlag(args, "--yes") ? defaultProvider : await chooseOption("5/5 Which AI workspace should get this role?", [
      { value: "codex", label: "Codex", detail: availability[0] ? "Detected on this computer." : "Not detected; you can still create the portable setup." },
      { value: "claude-code", label: "Claude Code", detail: availability[1] ? "Detected on this computer." : "Not detected; you can still create the portable setup." },
    ], defaultProvider, rl));
    if (providerChoice !== "claude-code" && providerChoice !== "codex") throw new Error("Choose Codex or Claude Code.");
    const provider = providerChoice;
    const destination = resolve(argumentValue(args, "--output") ?? `${repository}/.deltadotta/launchpad`);
    let organization = createTeamLaunchpad({ template, organizationName: name, repositoryName: basename(repository), provider, owner, operatingAuthority, escalationOwner, handoffTarget, evidence });
    output.write(launchSummary(organization, evidence.length));
    if (!hasFlag(args, "--yes") && !await confirm(`Create this map and install the ${details.primaryRole} role`, rl)) {
      output.write("Launch cancelled. No files were changed.\n");
      return;
    }

    await writeFiles(destination, compilePackage(organization));
    if (hasFlag(args, "--no-install")) {
      const report = unavailableProviderReport(markPrimaryRoleInstalled(organization), provider, "Provider installation was skipped with --no-install. The map was generated, but DeltaDotta did not mark the first shift preflighted.");
      organization = applyFirstShiftReport(organization, report);
      await writeFiles(destination, {
        "verification/first-shift-report.md": reportMarkdown(report),
        "verification/first-shift-report.json": JSON.stringify(report, null, 2),
      });
      output.write(`  Provider install skipped; the ${details.primaryRole} role is marked needs refinement.\n`);
    } else {
      organization = markPrimaryRoleInstalled(organization);
      const installation = await installProviderAdapter(repository, destination, organization, provider);
      const report = installation.available ? verifyFirstShift(organization) : unavailableProviderReport(organization, provider);
      organization = applyFirstShiftReport(organization, report);
      await writeFiles(destination, {
        "verification/first-shift-report.md": reportMarkdown(report),
        "verification/first-shift-report.json": JSON.stringify(report, null, 2),
      });
      output.write(`  ${providerLabel(provider)} context ${installation.available ? "installed and package-preflighted" : "installed; provider executable was not found"}.\n`);
      output.write(`  Managed entrypoint: ${installation.entrypoint}\n`);
    }
    await writeFiles(destination, compilePackage(organization));
    const mapLocation = resolve(destination, "organization-map.html");
    await writeFile(mapLocation, renderOrganizationMap(organization), "utf8");
    output.write(`\n✓ Launch complete: ${organization.launch?.status ?? "needs-refinement"}\n`);
    output.write(`  Team map: ${mapLocation}\n`);
    output.write(`  Package: ${destination}\n`);
    output.write("  Knowledge process: capture → link owner → set boundary → preflight → refresh\n");
    output.write("  Next: open the map and refine any role still marked mapped or needs refinement.\n");
    if (hasFlag(args, "--no-open")) output.write("  Map opening skipped.\n\n");
    else { openMap(mapLocation); output.write("  Opening the hierarchy map in your browser…\n\n"); }
  } finally {
    rl.close();
  }
}

async function runInit(args: string[]) {
  const rl = createInterface({ input, output });
  try {
    output.write("\nΔ DeltaDotta — organization map interview\n\n");
    output.write("You will define direction, roles, decision rights, and handoffs.\n");
    const name = await requireAnswer("\nOrganization name: ", rl);
    const mission = await requireAnswer("What does this organization exist to make true? ", rl);
    const roles = await multiLine("Roles (use: Role title: what it owns). Leave empty for the product-startup template.", rl);
    const decisions = await multiLine("Decision rights (who can decide what without escalation?)", rl);
    const handoffs = await multiLine("Handoffs and escalation rules", rl);
    const organization = organizationFromInterview({ name, mission, roles, decisions, handoffs });
    const destination = resolve(argumentValue(args, "--output") ?? `${portableIdentifier(name, "organization")}-deltadotta-package`);
    await writeFiles(destination, compilePackage(organization));
    const mapLocation = resolve(destination, "organization-map.html");
    await writeFile(mapLocation, renderOrganizationMap(organization), "utf8");
    output.write(`\n✓ Created ${organization.roles.length} role skills in ${destination}\n`);
    output.write(`  Hierarchy map: ${mapLocation}\n`);
    if (hasFlag(args, "--no-open")) output.write("  Map opening skipped.\n\n");
    else { openMap(mapLocation); output.write("  Opening the hierarchy map in your browser…\n\n"); }
  } finally {
    rl.close();
  }
}

async function runCheck(args: string[]) {
  const explicitRepository = argumentValue(args, "--repo");
  const repository = resolve(explicitRepository ?? ".");
  const packageFolder = resolve(argumentValue(args, "--package") ?? `${repository}/.deltadotta/launchpad`);
  const graphLocation = resolve(packageFolder, "graph.json");
  let organization: Organization;
  try {
    const graph = JSON.parse(await readBoundedUtf8File(
      graphLocation,
      maxPackagedGraphBytes,
      "package graph",
    ));
    organization = parseImportedPackage(graph).organization;
  } catch (error) {
    throw new Error(`Could not read a DeltaDotta package at ${packageFolder}: ${error instanceof Error ? error.message : "unknown error"}`);
  }
  const sourcePlans = organization.sourcePlans ?? [];
  const localEvidence = organization.evidence.filter((item) => item.sourcePath && item.sourceHash && (!item.sourceConnector || item.sourceConnector === "local"));
  const tracedEvidence = localEvidence.filter((item) => (
    item.sourceBaseDirectory
    || sourcePlans.length <= 1
    || Boolean(explicitRepository)
  ));
  const externalEvidence = organization.evidence.filter((item) => item.sourceHash && item.sourceConnector && item.sourceConnector !== "local");
  const tracedIds = new Set([...tracedEvidence, ...externalEvidence].map((item) => item.id));
  const unverifiableEvidence = organization.evidence.filter((item) => item.sourceHash && !tracedIds.has(item.id));
  const missing: string[] = [];
  const changed: string[] = [];
  const unreadable: string[] = [];
  const localHashCache = new Map<string, Promise<string>>();
  for (const evidence of tracedEvidence) {
    const path = evidence.sourcePath!;
    const archiveMarker = path.indexOf("!/");
    const physicalPath = archiveMarker >= 0 ? path.slice(0, archiveMarker) : path;
    const baseDirectory = evidence.sourceBaseDirectory
      ?? (sourcePlans.length === 1 ? sourcePlans[0].baseDirectory : repository);
    const cacheKey = `${baseDirectory}\u0000${physicalPath}\u0000${evidence.sourceEncoding ?? "legacy"}\u0000${evidence.sourceType ? "typed" : "legacy"}`;
    try {
      let currentHash = localHashCache.get(cacheKey);
      if (!currentHash) {
        currentHash = (async () => {
          const location = resolve(baseDirectory, physicalPath);
          let content: string;
          if (evidence.sourceEncoding === "sqlite-schema") {
            content = await extractSqliteSchema(location);
          } else {
            const maxBytes = evidence.sourceEncoding === "binary"
              ? maxCheckBinaryBytes
              : evidence.sourceType
                ? maxCheckTextBytes
                : maxSourceBytes;
            const raw = await readBoundedFile(location, maxBytes, "freshness source");
            content = evidence.sourceEncoding === "binary"
              ? raw.toString("base64")
              : evidence.sourceType
                ? raw.toString("utf8").trim()
                : raw.toString("utf8").slice(0, maxSourceBytes);
          }
          return evidenceHash(content);
        })();
        localHashCache.set(cacheKey, currentHash);
      }
      if ((await currentHash) !== evidence.sourceHash) changed.push(archiveMarker >= 0 ? physicalPath : path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") missing.push(physicalPath);
      else unreadable.push(physicalPath);
    }
  }
  const uniqueMissing = Array.from(new Set(missing));
  const uniqueChanged = Array.from(new Set(changed));
  const uniqueUnreadable = Array.from(new Set(unreadable));
  const localIssueCount = uniqueMissing.length + uniqueChanged.length + uniqueUnreadable.length;
  if (!tracedEvidence.length && !externalEvidence.length && !unverifiableEvidence.length) {
    output.write("No fingerprinted evidence is linked yet. Add documents, codebase files, or database schema exports during refinement.\n");
  } else if (tracedEvidence.length && !localIssueCount) {
    output.write(`✓ Evidence is fresh (local): ${tracedEvidence.length} linked source${tracedEvidence.length === 1 ? "" : "s"} across ${localHashCache.size} physical snapshot${localHashCache.size === 1 ? "" : "s"} still exist and match their fingerprints.\n`);
  } else if (localIssueCount) {
    output.write(`Needs refinement: ${localIssueCount} linked source${localIssueCount === 1 ? "" : "s"} moved, disappeared, changed, or could not be safely read.\n`);
    uniqueMissing.forEach((path) => output.write(`  - missing: ${path}\n`));
    uniqueChanged.forEach((path) => output.write(`  - changed: ${path}\n`));
    uniqueUnreadable.forEach((path) => output.write(`  - unreadable or over limit: ${path}\n`));
    process.exitCode = 2;
  }
  if (externalEvidence.length || unverifiableEvidence.length) {
    const counts = new Map<string, number>();
    externalEvidence.forEach((item) => counts.set(item.sourceConnector!, (counts.get(item.sourceConnector!) ?? 0) + 1));
    if (unverifiableEvidence.length) counts.set("unmapped", unverifiableEvidence.length);
    const summary = Array.from(counts.entries()).map(([connector, count]) => `${connector}: ${count}`).join(", ");
    output.write(`Needs refresh verification: ${externalEvidence.length + unverifiableEvidence.length} fingerprinted snapshot${externalEvidence.length + unverifiableEvidence.length === 1 ? "" : "s"} cannot be proven current by the quick local check (${summary}).\n`);
    if (sourcePlans.length && sourcePlans.every((plan) => plan.replayable)) {
      output.write(`  Next: run deltadotta refresh --package ${JSON.stringify(packageFolder)} --output ${JSON.stringify(`${packageFolder}-refreshed`)}, review source changes, then refine again.\n`);
    } else {
      output.write("  Next: rerun onboarding with the required external connector inputs, signed URLs, or database environment variables, then review and refine the refreshed package.\n");
    }
    process.exitCode = 2;
  }
}

const normalizedArguments = normalizeCliArgs(process.argv.slice(2));
const knownCommands = new Set(Object.keys(commandOptionSpecs));
const firstArgument = normalizedArguments[0];
const command = firstArgument && knownCommands.has(firstArgument)
  ? firstArgument
  : firstArgument && !firstArgument.startsWith("-")
    ? firstArgument
    : "onboard";
const args = command === firstArgument ? normalizedArguments.slice(1) : normalizedArguments;
try {
  if (command === "help" || args.includes("--help") || args.includes("-h")) output.write(help);
  else if (args.includes("--version") || args.includes("-v")) output.write(`DeltaDotta ${cliVersion}\n`);
  else if (knownCommands.has(command)) {
    validateCommandArgs(command, args);
    if (command === "onboard") await runOnboard(args);
    else if (command === "merge") await runMerge(args);
    else if (command === "refresh") await runRefresh(args);
    else if (command === "refine") await runRefine(args);
    else if (command === "validate") await runValidate(args);
    else if (command === "install") await runInstall(args);
    else if (command === "evaluate") await runEvaluate(args);
    else if (command === "launch") await runLaunch(args);
    else if (command === "init") await runInit(args);
    else if (command === "check") await runCheck(args);
  }
  else {
    output.write(`Unknown command: ${command}\n\n${help}`);
    process.exitCode = 1;
  }
} catch (error) {
  output.write(`\nDeltaDotta could not complete this command: ${error instanceof Error ? error.message : "unknown error"}\n`);
  process.exitCode = 1;
}
