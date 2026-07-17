#!/usr/bin/env node
import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, relative, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { applyFirstShiftReport, compilePackage, createTeamLaunchpad, markPrimaryRoleInstalled, organizationFromInterview, repositoryEvidence, roleSkill, verifyFirstShift, } from "../lib/organization.js";
import { renderOrganizationMap } from "../lib/cli-viewer.js";
const help = `DeltaDotta CLI

Usage:
  deltadotta
  deltadotta launch [advanced options]
  deltadotta init [--output <folder>] [--no-open]
  deltadotta check [--repo <folder>] [--package <folder>]

Commands:
  (none)  Start the guided Team Launchpad. It asks one plain-language question
          at a time and never requires command-line options.
  launch  Same guided flow. Advanced options are available for scripting:
          --template <software|manufacturing> --repo <folder> --output <folder>
          --name <name> --provider <claude-code|codex> --yes --no-open --no-install
  init    The deeper, open-ended organization interview.
  check   Reports repository evidence that has moved or disappeared since launch.

Launch writes provider context as a managed DeltaDotta block in CLAUDE.md or
AGENTS.md. Use --no-install to generate the package without touching that file.
`;
const ignoredDirectories = new Set([".git", ".next", ".turbo", "node_modules", "dist", "build", "coverage", ".deltadotta"]);
const textExtensions = /(?:\.md|\.mdx|\.txt|\.csv|\.json|\.ya?ml|\.toml|\.ini|\.conf|\.sh|\.bash|\.zsh|\.js|\.ts|\.tsx|\.py|\.go|\.rb)$/i;
const maxScanFiles = 120;
const maxSourceBytes = 28_000;
function argumentValue(args, name) {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
}
function hasFlag(args, name) {
    return args.includes(name);
}
function titleFromPath(path) {
    return basename(path).replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) || "Team";
}
function isTemplate(value) {
    return value === "software" || value === "manufacturing";
}
function templateDetails(template) {
    return template === "software"
        ? { label: "Software", ownerPrompt: "Who owns engineering delivery", ownerDefault: "Engineering Lead", authorityPrompt: "Who may approve or stop a deployment", authorityDefault: "DevOps / Platform Engineer", escalationPrompt: "Who receives a production escalation", handoffPrompt: "Who receives the incident follow-up handoff", primaryRole: "DevOps / Platform Engineer" }
        : { label: "Manufacturing", ownerPrompt: "Who owns manufacturing operations", ownerDefault: "Manufacturing Director", authorityPrompt: "Who may stop an unsafe line or authorize a controlled restart", authorityDefault: "Production Operations Lead", escalationPrompt: "Who receives a safety or quality escalation", handoffPrompt: "Who receives the equipment or process follow-up handoff", primaryRole: "Production Operations Lead" };
}
async function multiLine(question, rl) {
    output.write(`\n${question}\nType one item per line. Press Enter on an empty line when finished.\n`);
    const values = [];
    while (true) {
        const answer = (await rl.question(values.length ? "  · " : "  > ")).trim();
        if (!answer)
            return values;
        values.push(answer);
    }
}
async function requireAnswer(question, rl) {
    while (true) {
        const answer = (await rl.question(question)).trim();
        if (answer)
            return answer;
        output.write("  Please enter a value.\n");
    }
}
async function answerWithDefault(question, fallback, rl) {
    const answer = (await rl.question(`${question} [${fallback}]: `)).trim();
    return answer || fallback;
}
async function chooseOption(question, choices, fallback, rl) {
    output.write(`\n${question}\n`);
    choices.forEach((choice, index) => output.write(`  ${index + 1}. ${choice.label}\n     ${choice.detail}\n`));
    while (true) {
        const answer = (await rl.question(`Choose 1-${choices.length} [${choices.findIndex((choice) => choice.value === fallback) + 1}]: `)).trim().toLowerCase();
        if (!answer)
            return fallback;
        const byNumber = Number.parseInt(answer, 10);
        if (Number.isInteger(byNumber) && choices[byNumber - 1])
            return choices[byNumber - 1].value;
        const byValue = choices.find((choice) => choice.value === answer);
        if (byValue)
            return byValue.value;
        output.write(`  Please choose a number from 1 to ${choices.length}.\n`);
    }
}
async function confirm(question, rl) {
    const answer = (await rl.question(`${question} [Y/n]: `)).trim().toLowerCase();
    return !answer || answer === "y" || answer === "yes";
}
function openMap(location) {
    const child = process.platform === "win32"
        ? execFile("cmd", ["/c", "start", "", location])
        : process.platform === "darwin"
            ? execFile("open", [location])
            : execFile("xdg-open", [location]);
    child.on("error", () => output.write(`  Map created at ${location}. Open it in any browser.\n`));
}
async function writeFiles(destination, files) {
    await Promise.all(Object.entries(files).map(async ([path, content]) => {
        const location = resolve(destination, path);
        await mkdir(dirname(location), { recursive: true });
        await writeFile(location, content, "utf8");
    }));
}
function isCandidateFile(path) {
    const normalized = path.replace(/\\/g, "/");
    return textExtensions.test(normalized)
        || /(?:^|\/)(?:CODEOWNERS|Dockerfile|Makefile|Procfile)$/i.test(normalized)
        || /(?:^|\/)(?:\.github\/workflows\/)/i.test(normalized);
}
async function scanRepository(root) {
    const found = [];
    async function visit(folder) {
        if (found.length >= maxScanFiles)
            return;
        let entries;
        try {
            entries = await readdir(folder, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
            if (found.length >= maxScanFiles)
                return;
            if (entry.isDirectory()) {
                if (!ignoredDirectories.has(entry.name))
                    await visit(resolve(folder, entry.name));
                continue;
            }
            if (!entry.isFile())
                continue;
            const location = resolve(folder, entry.name);
            const path = relative(root, location).replace(/\\/g, "/");
            if (!isCandidateFile(path))
                continue;
            try {
                const content = (await readFile(location, "utf8")).slice(0, maxSourceBytes);
                if (content.includes("\u0000"))
                    continue;
                found.push({ path, content });
            }
            catch { /* unreadable and binary files are intentionally skipped */ }
        }
    }
    await visit(root);
    return found;
}
async function providerAvailable(provider) {
    const command = provider === "claude-code" ? "claude" : "codex";
    return new Promise((done) => {
        const child = execFile(command, ["--version"], { timeout: 2_000 }, (error) => done(!error));
        child.on("error", () => done(false));
    });
}
function providerFile(provider) {
    return provider === "claude-code" ? "CLAUDE.md" : "AGENTS.md";
}
function providerLabel(provider) {
    return provider === "claude-code" ? "Claude Code" : "Codex";
}
function managedBlock(provider, roleTitle, relativeSkillPath) {
    return `\n<!-- deltadotta:start -->\n## DeltaDotta ${roleTitle}\n\nUse the verified ${providerLabel(provider)} role context at \`${relativeSkillPath}\`. It is read-only by default: do not deploy, restart equipment, alter infrastructure or operational systems, access production credentials, or modify repository files or production records unless an explicit human instruction changes that boundary.\n<!-- deltadotta:end -->\n`;
}
async function upsertManagedBlock(location, block) {
    let existing = "";
    try {
        existing = await readFile(location, "utf8");
    }
    catch { /* create it below */ }
    const start = "<!-- deltadotta:start -->";
    const end = "<!-- deltadotta:end -->";
    const expression = new RegExp(`${start.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?${end.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\n?`, "m");
    const next = expression.test(existing) ? existing.replace(expression, block.trimStart()) : `${existing.trimEnd()}${block}`;
    await mkdir(dirname(location), { recursive: true });
    await writeFile(location, next, "utf8");
}
async function installProviderAdapter(repository, destination, organization, provider) {
    const primaryRole = organization.roles.find((role) => role.id === organization.launch?.primaryRoleId);
    if (!primaryRole)
        throw new Error("The selected Launchpad template has no primary role to install.");
    const adapterDirectory = resolve(destination, "providers", provider);
    const adapterLocation = resolve(adapterDirectory, providerFile(provider));
    const relativeRoleSkill = relative(repository, adapterLocation).replace(/\\/g, "/") || providerFile(provider);
    const adapter = `# DeltaDotta ${primaryRole.title} for ${providerLabel(provider)}\n\n${roleSkill(primaryRole, organization)}\n\n## Safety boundary\nThis role is installed for read-only first-shift verification. Do not deploy, restart equipment, mutate infrastructure or operational systems, access production credentials, edit repository files, or change production records.\n`;
    await mkdir(adapterDirectory, { recursive: true });
    await writeFile(adapterLocation, adapter, "utf8");
    await writeFile(resolve(adapterDirectory, "INSTALL.md"), `# Installed ${providerLabel(provider)} context\n\nDeltaDotta maintains the provider entrypoint in \`${providerFile(provider)}\` at the repository root. The full role context lives at \`${relative(repository, adapterLocation).replace(/\\/g, "/")}\`.\n`, "utf8");
    const entrypoint = resolve(repository, providerFile(provider));
    await upsertManagedBlock(entrypoint, managedBlock(provider, primaryRole.title, relativeRoleSkill));
    return { adapterLocation, entrypoint, available: await providerAvailable(provider) };
}
function reportMarkdown(report) {
    const checks = report.checks.map((check) => `- ${check.passed ? "PASS" : "NEEDS REFINEMENT"} — **${check.name}**: ${check.detail}`).join("\n");
    return `# First-shift verification\n\n- Provider: ${report.provider}\n- Role: ${report.roleId}\n- Result: ${report.passed ? "VERIFIED" : "NEEDS REFINEMENT"}\n- Safety: read-only; no deployment, infrastructure mutation, production credentials, or repository changes are permitted.\n\n## Scenario\n${report.scenario}\n\n## Checks\n${checks}\n`;
}
function unavailableProviderReport(organization, provider, reason) {
    const report = verifyFirstShift(organization);
    return {
        ...report,
        provider,
        passed: false,
        checks: [...report.checks, { name: "Provider availability", passed: false, detail: reason ?? `${providerLabel(provider)} was not found on PATH. The map and context were generated, but DeltaDotta did not mark the first shift verified.` }],
    };
}
function launchSummary(organization, evidenceCount) {
    const roles = organization.roles.map((role) => `  ${role.id === organization.launch?.primaryRoleId ? "★" : "•"} ${role.title} — ${role.launchStatus ?? "mapped"}`).join("\n");
    return `\n${organization.launch?.template === "manufacturing" ? "Manufacturing" : "Software"} Launchpad\n  Organization: ${organization.name}\n  Evidence sources: ${evidenceCount || "none — template defaults will be labeled"}\n${roles}\n`;
}
async function runLaunch(args) {
    const requestedTemplate = argumentValue(args, "--template");
    if (requestedTemplate && !isTemplate(requestedTemplate))
        throw new Error("--template must be software or manufacturing.");
    const requestedProvider = argumentValue(args, "--provider");
    if (requestedProvider && requestedProvider !== "claude-code" && requestedProvider !== "codex")
        throw new Error("--provider must be claude-code or codex. ChatGPT uses the portable import guide in this release.");
    const rl = createInterface({ input, output });
    try {
        output.write("\nΔ Welcome to DeltaDotta\n\nWe’ll build a practical team map, set up one safe AI role, and open it for you. This usually takes under 10 minutes.\n");
        const repositoryInput = argumentValue(args, "--repo") ?? (hasFlag(args, "--yes") ? "." : await answerWithDefault("\nStep 1 — Where is the team workspace", resolve("."), rl));
        const repository = resolve(repositoryInput);
        let repositoryStats;
        try {
            repositoryStats = await stat(repository);
        }
        catch {
            throw new Error(`I can’t find that folder: ${repository}`);
        }
        if (!repositoryStats.isDirectory())
            throw new Error(`That location is not a folder: ${repository}`);
        const templateChoice = requestedTemplate ?? (hasFlag(args, "--yes") ? "software" : await chooseOption("\nStep 2 — What kind of team are you setting up?", [
            { value: "software", label: "Software team", detail: "Engineering, DevOps, Design, and QA." },
            { value: "manufacturing", label: "Manufacturing team", detail: "Production, Quality, Process, and Maintenance." },
        ], "software", rl));
        if (!isTemplate(templateChoice))
            throw new Error("Choose software or manufacturing.");
        const template = templateChoice;
        const details = templateDetails(template);
        const name = argumentValue(args, "--name") ?? (hasFlag(args, "--yes") ? `${titleFromPath(repository)} ${details.label}` : await answerWithDefault("\nStep 3 — What should we call this team", `${titleFromPath(repository)} ${details.label}`, rl));
        output.write("\nI’m looking through local runbooks, workflow files, ownership files, and existing instructions…\n");
        const scanned = await scanRepository(repository);
        const evidence = repositoryEvidence(scanned);
        output.write(`Found ${evidence.length} useful source${evidence.length === 1 ? "" : "s"} in ${scanned.length} readable file${scanned.length === 1 ? "" : "s"}. They’ll stay linked to the map.\n\n`);
        output.write("Now, five quick confirmations. Press Enter to keep the suggested answer.\n");
        const owner = argumentValue(args, "--owner") ?? await answerWithDefault(`\n1/5 ${details.ownerPrompt}`, details.ownerDefault, rl);
        const operatingAuthority = argumentValue(args, "--operating-authority") ?? argumentValue(args, "--deploy-authority") ?? await answerWithDefault(`2/5 ${details.authorityPrompt}`, details.authorityDefault, rl);
        const escalationOwner = argumentValue(args, "--escalation-owner") ?? await answerWithDefault(`3/5 ${details.escalationPrompt}`, owner, rl);
        const handoffTarget = argumentValue(args, "--handoff-target") ?? await answerWithDefault(`4/5 ${details.handoffPrompt}`, owner, rl);
        const availability = await Promise.all([providerAvailable("codex"), providerAvailable("claude-code")]);
        const defaultProvider = availability[0] ? "codex" : availability[1] ? "claude-code" : "codex";
        const providerChoice = requestedProvider ?? (hasFlag(args, "--yes") ? defaultProvider : await chooseOption("5/5 Which AI workspace should get this role?", [
            { value: "codex", label: "Codex", detail: availability[0] ? "Detected on this computer." : "Not detected; you can still create the portable setup." },
            { value: "claude-code", label: "Claude Code", detail: availability[1] ? "Detected on this computer." : "Not detected; you can still create the portable setup." },
        ], defaultProvider, rl));
        if (providerChoice !== "claude-code" && providerChoice !== "codex")
            throw new Error("Choose Codex or Claude Code.");
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
            const report = unavailableProviderReport(markPrimaryRoleInstalled(organization), provider, "Provider installation was skipped with --no-install. The map was generated, but DeltaDotta did not mark the first shift verified.");
            organization = applyFirstShiftReport(organization, report);
            await writeFiles(destination, {
                "verification/first-shift-report.md": reportMarkdown(report),
                "verification/first-shift-report.json": JSON.stringify(report, null, 2),
            });
            output.write(`  Provider install skipped; the ${details.primaryRole} role is marked needs refinement.\n`);
        }
        else {
            organization = markPrimaryRoleInstalled(organization);
            const installation = await installProviderAdapter(repository, destination, organization, provider);
            const report = installation.available ? verifyFirstShift(organization) : unavailableProviderReport(organization, provider);
            organization = applyFirstShiftReport(organization, report);
            await writeFiles(destination, {
                "verification/first-shift-report.md": reportMarkdown(report),
                "verification/first-shift-report.json": JSON.stringify(report, null, 2),
            });
            output.write(`  ${providerLabel(provider)} context ${installation.available ? "installed and preflight-verified" : "installed; provider executable was not found"}.\n`);
            output.write(`  Managed entrypoint: ${installation.entrypoint}\n`);
        }
        await writeFiles(destination, compilePackage(organization));
        const mapLocation = resolve(destination, "organization-map.html");
        await writeFile(mapLocation, renderOrganizationMap(organization), "utf8");
        output.write(`\n✓ Launch complete: ${organization.launch?.status ?? "needs-refinement"}\n`);
        output.write(`  Team map: ${mapLocation}\n`);
        output.write(`  Package: ${destination}\n`);
        output.write("  Next: open the map and refine any role still marked mapped or needs refinement.\n");
        if (hasFlag(args, "--no-open"))
            output.write("  Map opening skipped.\n\n");
        else {
            openMap(mapLocation);
            output.write("  Opening the hierarchy map in your browser…\n\n");
        }
    }
    finally {
        rl.close();
    }
}
async function runInit(args) {
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
        const destination = resolve(argumentValue(args, "--output") ?? `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-deltadotta-package`);
        await writeFiles(destination, compilePackage(organization));
        const mapLocation = resolve(destination, "organization-map.html");
        await writeFile(mapLocation, renderOrganizationMap(organization), "utf8");
        output.write(`\n✓ Created ${organization.roles.length} role skills in ${destination}\n`);
        output.write(`  Hierarchy map: ${mapLocation}\n`);
        if (hasFlag(args, "--no-open"))
            output.write("  Map opening skipped.\n\n");
        else {
            openMap(mapLocation);
            output.write("  Opening the hierarchy map in your browser…\n\n");
        }
    }
    finally {
        rl.close();
    }
}
async function runCheck(args) {
    const repository = resolve(argumentValue(args, "--repo") ?? ".");
    const packageFolder = resolve(argumentValue(args, "--package") ?? `${repository}/.deltadotta/launchpad`);
    const graphLocation = resolve(packageFolder, "graph.json");
    let organization;
    try {
        const graph = JSON.parse(await readFile(graphLocation, "utf8"));
        if (!graph.organization)
            throw new Error("graph.json has no organization.");
        organization = graph.organization;
    }
    catch (error) {
        throw new Error(`Could not read a DeltaDotta package at ${packageFolder}: ${error instanceof Error ? error.message : "unknown error"}`);
    }
    const repositoryEvidence = organization.evidence.filter((item) => item.kind === "repository");
    const missing = [];
    for (const evidence of repositoryEvidence) {
        const path = evidence.name.replace(/^Repository:\s*/, "");
        try {
            await stat(resolve(repository, path));
        }
        catch {
            missing.push(path);
        }
    }
    if (!repositoryEvidence.length)
        output.write("No repository evidence is linked yet. Add runbooks, workflows, or CODEOWNERS during refinement.\n");
    else if (!missing.length)
        output.write(`✓ Evidence is fresh: ${repositoryEvidence.length} linked repository source${repositoryEvidence.length === 1 ? "" : "s"} still exist.\n`);
    else {
        output.write(`Needs refinement: ${missing.length} linked repository source${missing.length === 1 ? "" : "s"} moved or disappeared.\n`);
        missing.forEach((path) => output.write(`  - ${path}\n`));
        process.exitCode = 2;
    }
}
const [command = "launch", ...args] = process.argv.slice(2);
try {
    if (command === "--help" || command === "-h" || command === "help")
        output.write(help);
    else if (command === "launch")
        await runLaunch(args);
    else if (command === "init")
        await runInit(args);
    else if (command === "check")
        await runCheck(args);
    else {
        output.write(`Unknown command: ${command}\n\n${help}`);
        process.exitCode = 1;
    }
}
catch (error) {
    output.write(`\nDeltaDotta could not complete this command: ${error instanceof Error ? error.message : "unknown error"}\n`);
    process.exitCode = 1;
}
