import { spawnSync } from "node:child_process";
import { access, mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(
  await readFile(join(projectRoot, "package.json"), "utf8"),
);
const keepTemporaryFiles = process.env.DELTADOTTA_KEEP_SMOKE_TEMP === "1";
const temporaryRoot = await mkdtemp(
  join(tmpdir(), "deltadotta-public-install-"),
);
let completed = false;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? projectRoot,
    encoding: "utf8",
    env: process.env,
    shell: options.shell ?? (process.platform === "win32" && command === "npm"),
  });

  if (result.error) {
    throw result.error;
  }

  const acceptedStatuses = options.acceptedStatuses ?? [0];
  if (!acceptedStatuses.includes(result.status)) {
    process.stdout.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
    throw new Error(
      `${command} ${args.join(" ")} exited with status ${result.status}`,
    );
  }

  if (!options.quiet) {
    process.stdout.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
  }

  return result;
}

async function requireFile(relativePath) {
  const location = join(temporaryRoot, relativePath);
  await access(location);
  return location;
}

try {
  console.log(
    `Creating a clean DeltaDotta ${packageJson.version} consumer install...`,
  );

  const packResult = run(
    "npm",
    ["pack", "--json", "--pack-destination", temporaryRoot],
    { quiet: true },
  );
  const packReport = JSON.parse(packResult.stdout);
  const tarballName = packReport.at(0)?.filename;
  if (!tarballName) {
    throw new Error("npm pack did not report a tarball filename");
  }

  const tarball = join(temporaryRoot, tarballName);
  const consumer = join(temporaryRoot, "consumer");
  await mkdir(consumer);
  run("npm", ["init", "--yes"], { cwd: consumer, quiet: true });
  run(
    "npm",
    ["install", tarball, "--ignore-scripts=false", "--no-audit", "--no-fund"],
    { cwd: consumer },
  );

  const installedCli = join(
    consumer,
    "node_modules",
    packageJson.name,
    packageJson.bin.deltadotta,
  );
  await access(installedCli);

  const installedBin = join(
    consumer,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "deltadotta.cmd" : "deltadotta",
  );
  await access(installedBin);

  const version = run(installedBin, ["--version"], {
    cwd: consumer,
    quiet: true,
    shell: process.platform === "win32",
  }).stdout.trim();
  if (version !== `DeltaDotta ${packageJson.version}`) {
    throw new Error(`unexpected CLI version output: ${version}`);
  }

  const output = join(temporaryRoot, "output");
  run(
    process.execPath,
    [
      installedCli,
      "onboard",
      "--repo",
      join(projectRoot, "docs", "demo-workspace"),
      "--source",
      ".",
      "--name",
      "Public Install Smoke",
      "--provider",
      "chatgpt",
      "--output",
      output,
      "--yes",
      "--no-open",
    ],
    {
      cwd: consumer,
      acceptedStatuses: [0, 2],
    },
  );

  run(process.execPath, [installedCli, "validate", "--package", output], {
    cwd: consumer,
    acceptedStatuses: [0, 2],
  });

  const requiredArtifacts = [
    "output/ORGANIZATION.md",
    "output/graph.json",
    "output/manifest.yaml",
    "output/providers/chatgpt/PROJECT-INSTRUCTIONS.md",
    "output/providers/chatgpt/UPLOAD-MANIFEST.md",
    "output/review/organization.review.json",
    "output/validation/readiness.json",
    "output.zip",
  ];
  await Promise.all(requiredArtifacts.map(requireFile));

  const readiness = JSON.parse(
    await readFile(join(output, "validation", "readiness.json"), "utf8"),
  );
  if (
    readiness.status !== "needs-review" ||
    !Number.isInteger(readiness.blockers) ||
    readiness.blockers < 1 ||
    !Array.isArray(readiness.checks) ||
    !readiness.checks.some((check) => check.status === "blocker")
  ) {
    throw new Error(
      "unreviewed demo package did not stop at the human-review gate",
    );
  }

  completed = true;
  console.log(
    `Public install smoke test passed: clean package install, CLI ${packageJson.version}, ` +
      "artifact generation, archive creation, and human-review enforcement.",
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  if (completed && !keepTemporaryFiles) {
    await rm(temporaryRoot, { recursive: true, force: true });
  } else {
    console.log(`Smoke-test files kept at ${temporaryRoot}`);
  }
}
