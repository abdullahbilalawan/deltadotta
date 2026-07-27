import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { collectKnowledgeSources } from "./source-ingestion.js";
import { evidenceHash } from "./organization.js";
const defaultMaxFiles = 500;
const defaultMaxBytesPerSource = 1_000_000;
const defaultMaxBinaryBytes = 25_000_000;
const defaultMaxTotalBytes = 4_000_000;
const defaultTimeoutMs = 30_000;
const maxExternalConnectorInputs = 50;
const httpConcurrency = 4;
function redact(input, secretValues) {
    return secretValues.filter(Boolean).reduce((value, secret) => value.split(secret).join("[redacted]"), input);
}
export function sanitizeExternalLocator(input) {
    try {
        const url = new URL(input);
        url.username = "";
        url.password = "";
        url.search = "";
        url.hash = "";
        return url.toString();
    }
    catch {
        return input.replace(/(https?:\/\/[^:/\s]+:)[^@\s]+@/i, "$1[redacted]@");
    }
}
function safeError(error, secrets) {
    const message = error instanceof Error ? error.message : String(error);
    return redact(message, secrets);
}
function runCommand(command, args, options) {
    return new Promise((done, reject) => {
        execFile(command, args, {
            cwd: options.cwd,
            env: options.env,
            timeout: options.timeoutMs,
            maxBuffer: options.maxBuffer,
            windowsHide: true,
        }, (error, stdout, stderr) => {
            if (error) {
                const detail = String(stderr || error.message).trim();
                reject(new Error(detail || `${command} exited unsuccessfully`));
                return;
            }
            done({ stdout: String(stdout), stderr: String(stderr) });
        });
    });
}
function contentExtension(url, response) {
    const disposition = response.headers.get("content-disposition") ?? "";
    const encodedName = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
    const plainName = /filename="?([^";]+)"?/i.exec(disposition)?.[1];
    const suppliedName = encodedName ? decodeURIComponent(encodedName) : plainName;
    const suppliedExtension = extname(suppliedName ? basename(suppliedName) : "").toLowerCase();
    if (suppliedExtension)
        return suppliedExtension;
    const pathExtension = extname(url.pathname).toLowerCase();
    if (pathExtension)
        return pathExtension;
    const contentType = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    const mappings = {
        "application/json": ".json",
        "application/pdf": ".pdf",
        "application/rtf": ".rtf",
        "application/zip": ".zip",
        "application/vnd.oasis.opendocument.presentation": ".odp",
        "application/vnd.oasis.opendocument.spreadsheet": ".ods",
        "application/vnd.oasis.opendocument.text": ".odt",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
        "text/csv": ".csv",
        "text/html": ".html",
        "text/markdown": ".md",
        "text/tab-separated-values": ".tsv",
        "text/plain": ".txt",
        "text/xml": ".xml",
    };
    return mappings[contentType] ?? ".txt";
}
async function boundedResponseBody(response, maxBytes) {
    const declaredLength = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
        throw new Error(`response declares ${declaredLength} bytes, above the ${maxBytes}-byte limit`);
    }
    if (!response.body)
        return Buffer.alloc(0);
    const chunks = [];
    const reader = response.body.getReader();
    let total = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done)
                break;
            total += value.byteLength;
            if (total > maxBytes)
                throw new Error(`response exceeded the ${maxBytes}-byte limit`);
            chunks.push(Buffer.from(value));
        }
    }
    finally {
        if (total > maxBytes)
            await reader.cancel();
    }
    return Buffer.concat(chunks, total);
}
function isSecureHttpSource(input) {
    const url = new URL(input);
    if (url.username || url.password)
        throw new Error("credentials in document URLs are not accepted; use --http-token-env");
    if (url.protocol === "https:")
        return url;
    if (url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1"))
        return url;
    throw new Error("document URLs must use HTTPS (plain HTTP is allowed only for localhost)");
}
async function fetchWithSafeRedirects(requestedUrl, authorization, timeoutMs) {
    let currentUrl = requestedUrl;
    for (let redirects = 0; redirects <= 5; redirects += 1) {
        const response = await fetch(currentUrl, {
            headers: authorization ? { authorization } : undefined,
            redirect: "manual",
            signal: AbortSignal.timeout(timeoutMs),
        });
        if (![301, 302, 303, 307, 308].includes(response.status))
            return response;
        const location = response.headers.get("location");
        if (!location)
            throw new Error(`HTTP ${response.status} redirect had no location`);
        if (redirects === 5)
            throw new Error("document URL exceeded the 5-redirect limit");
        const nextUrl = isSecureHttpSource(new URL(location, currentUrl).toString());
        if (nextUrl.origin !== currentUrl.origin)
            authorization = undefined;
        currentUrl = nextUrl;
    }
    throw new Error("document URL redirect failed");
}
async function collectHttpSource(input, options) {
    const requestedUrl = isSecureHttpSource(input);
    const token = options.httpTokenEnv ? process.env[options.httpTokenEnv] : undefined;
    if (options.httpTokenEnv && !token)
        throw new Error(`environment variable ${options.httpTokenEnv} is not set`);
    const authorization = token ? (/^(?:Bearer|Basic)\s/i.test(token) ? token : `Bearer ${token}`) : undefined;
    const response = await fetchWithSafeRedirects(requestedUrl, authorization, options.timeoutMs);
    if (!response.ok)
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
    const finalUrl = isSecureHttpSource(response.url);
    const extension = contentExtension(finalUrl, response);
    const binary = [".docx", ".odt", ".ods", ".odp", ".pdf", ".pptx", ".rtf", ".xlsx", ".zip"].includes(extension);
    const bytes = await boundedResponseBody(response, binary ? options.maxBinaryBytes : options.maxBytesPerSource);
    const temporaryDirectory = await mkdtemp(resolve(tmpdir(), "deltadotta-http-"));
    try {
        const location = resolve(temporaryDirectory, `download${extension}`);
        await writeFile(location, bytes);
        const scan = await collectKnowledgeSources({
            baseDirectory: temporaryDirectory,
            sources: [location],
            maxFiles: 1,
            maxBytesPerFile: options.maxBytesPerSource,
            maxBinaryBytesPerFile: options.maxBinaryBytes,
            maxTotalBytes: options.maxBytesPerSource,
        });
        if (!scan.sources.length) {
            const reason = scan.skipped[0]?.reason ?? "document contained no supported text";
            throw new Error(reason);
        }
        const locator = sanitizeExternalLocator(finalUrl.toString());
        return {
            sources: scan.sources.map((source) => ({
                ...source,
                path: source.path.includes("!/")
                    ? `${locator}!/${source.path.slice(source.path.indexOf("!/") + 2)}`
                    : locator,
                sourceConnector: "https",
                sourceLocator: locator,
            })),
            skipped: scan.skipped.map((item) => ({ ...item, path: locator })),
        };
    }
    finally {
        await rm(temporaryDirectory, { force: true, recursive: true });
    }
}
function parseGitSpec(input) {
    const marker = input.lastIndexOf("#");
    if (marker <= 0)
        return { repository: input, ref: undefined };
    return { repository: input.slice(0, marker), ref: input.slice(marker + 1) || undefined };
}
function validateGitRepository(repository) {
    try {
        const url = new URL(repository);
        if ((url.protocol === "http:" || url.protocol === "https:") && (url.username || url.password)) {
            throw new Error("credentials in HTTPS Git URLs are not accepted; use a Git credential manager");
        }
    }
    catch (error) {
        if (error instanceof Error && error.message.startsWith("credentials in HTTPS Git URLs"))
            throw error;
        // SCP-style SSH locations and local repository paths are valid Git inputs.
    }
}
async function collectGitRepository(input, options) {
    const { repository, ref } = parseGitSpec(input);
    validateGitRepository(repository);
    const locator = sanitizeExternalLocator(repository);
    const temporaryDirectory = await mkdtemp(resolve(tmpdir(), "deltadotta-git-"));
    const checkout = resolve(temporaryDirectory, "repository");
    const args = ["clone", "--depth", "1", "--single-branch", "--no-tags", "--filter=blob:limit=25000000"];
    if (ref)
        args.push("--branch", ref);
    args.push("--", repository, checkout);
    try {
        await runCommand("git", args, {
            timeoutMs: Math.max(options.timeoutMs, 60_000),
            maxBuffer: 1_000_000,
            env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
        });
        const revision = (await runCommand("git", ["-C", checkout, "rev-parse", "HEAD"], {
            timeoutMs: options.timeoutMs,
            maxBuffer: 100_000,
        })).stdout.trim();
        const scan = await collectKnowledgeSources({
            baseDirectory: checkout,
            sources: ["."],
            maxFiles: options.maxFiles,
            maxBytesPerFile: options.maxBytesPerSource,
            maxBinaryBytesPerFile: options.maxBinaryBytes,
            maxTotalBytes: options.maxTotalBytes,
        });
        if (!scan.sources.length) {
            const reason = scan.skipped[0]?.reason ?? "Git snapshot contained no supported knowledge files";
            throw new Error(reason);
        }
        const revisionLabel = revision.slice(0, 12);
        return {
            sources: scan.sources.map((source) => ({
                ...source,
                path: `git:${locator}@${revisionLabel}/${source.path}`,
                sourceConnector: "git",
                sourceLocator: locator,
                sourceRevision: revision,
            })),
            skipped: scan.skipped.map((item) => ({
                ...item,
                path: `git:${locator}@${revisionLabel}/${item.path}`,
            })),
        };
    }
    catch (error) {
        throw new Error(safeError(error, [repository, input]));
    }
    finally {
        await rm(temporaryDirectory, { force: true, recursive: true });
    }
}
function databaseName(url) {
    const name = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
    if (!name)
        throw new Error("database URL must include a database name");
    return name;
}
export function databaseDumpInvocation(input, environment = process.env) {
    const url = new URL(input);
    for (const key of url.searchParams.keys()) {
        if (/(?:password|passwd|pwd|secret|token|api.?key)/i.test(key)) {
            throw new Error("database credentials in URL query parameters are not accepted; use the URL password field or client environment variables");
        }
    }
    const password = decodeURIComponent(url.password);
    url.password = "";
    const locator = sanitizeExternalLocator(url.toString());
    if (url.protocol === "postgres:" || url.protocol === "postgresql:") {
        const connection = url.toString();
        return {
            command: "pg_dump",
            args: [
                "--schema-only",
                "--no-owner",
                "--no-privileges",
                "--no-comments",
                "--lock-wait-timeout=5000",
                "--dbname",
                connection,
            ],
            env: { ...environment, ...(password ? { PGPASSWORD: password } : {}) },
            connector: "postgresql",
            locator,
        };
    }
    if (url.protocol === "mysql:") {
        const name = databaseName(url);
        return {
            command: "mysqldump",
            args: [
                "--no-data",
                "--compact",
                "--skip-comments",
                "--skip-dump-date",
                "--host",
                url.hostname,
                "--port",
                url.port || "3306",
                "--user",
                decodeURIComponent(url.username),
                "--",
                name,
            ],
            env: { ...environment, ...(password ? { MYSQL_PWD: password } : {}) },
            connector: "mysql",
            locator,
        };
    }
    throw new Error("database URL must use postgresql://, postgres://, or mysql://");
}
async function collectDatabaseSchema(input, maxBytes, timeoutMs) {
    const invocation = databaseDumpInvocation(input);
    const parsed = new URL(input);
    const password = decodeURIComponent(parsed.password);
    try {
        const result = await runCommand(invocation.command, invocation.args, {
            timeoutMs,
            maxBuffer: maxBytes,
            env: invocation.env,
        });
        const content = result.stdout
            .split("\n")
            .filter((line) => !/^\\(?:un)?restrict\b/.test(line))
            .join("\n")
            .trim();
        if (!content)
            throw new Error(`${invocation.command} returned an empty schema`);
        return {
            path: `${invocation.locator}#schema`,
            content,
            sourceType: "database",
            sourceHash: evidenceHash(content),
            sourceEncoding: "text",
            sourceConnector: invocation.connector,
            sourceLocator: invocation.locator,
        };
    }
    catch (error) {
        throw new Error(safeError(error, [input, password]));
    }
}
function emptyCounts() {
    return { codebase: 0, document: 0, database: 0 };
}
async function mapConcurrent(items, concurrency, worker) {
    const results = new Array(items.length);
    let nextIndex = 0;
    const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
        while (nextIndex < items.length) {
            const index = nextIndex;
            nextIndex += 1;
            results[index] = await worker(items[index]);
        }
    });
    await Promise.all(runners);
    return results;
}
/** Collects remote sources without persisting credentials or temporary checkouts. */
export async function collectExternalSources(options) {
    const requestedConnectorCount = (options.urls?.length ?? 0)
        + (options.gitRepositories?.length ?? 0)
        + (options.databaseUrls?.length ?? 0);
    if (requestedConnectorCount > maxExternalConnectorInputs) {
        throw new Error(`external ingestion supports at most ${maxExternalConnectorInputs} connector inputs per run`);
    }
    const maxFiles = options.maxFiles ?? defaultMaxFiles;
    const maxBytesPerSource = options.maxBytesPerSource ?? defaultMaxBytesPerSource;
    const maxBinaryBytes = options.maxBinaryBytes ?? defaultMaxBinaryBytes;
    const maxTotalBytes = options.maxTotalBytes ?? defaultMaxTotalBytes;
    const timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
    const sources = [];
    const skipped = [];
    let totalBytes = 0;
    function append(items, itemSkipped = []) {
        skipped.push(...itemSkipped);
        for (const source of items) {
            const size = Buffer.byteLength(source.content);
            if (sources.length >= maxFiles) {
                skipped.push({ path: source.path, reason: `stopped at the ${maxFiles}-file limit`, severity: "error" });
                continue;
            }
            if (totalBytes + size > maxTotalBytes) {
                skipped.push({ path: source.path, reason: `would exceed the ${maxTotalBytes}-byte external-source limit`, severity: "error" });
                continue;
            }
            sources.push(source);
            totalBytes += size;
        }
    }
    const httpResults = await mapConcurrent(options.urls ?? [], httpConcurrency, async (input) => {
        const locator = sanitizeExternalLocator(input);
        try {
            return await collectHttpSource(input, {
                baseDirectory: options.baseDirectory,
                httpTokenEnv: options.httpTokenEnv,
                maxBytesPerSource,
                maxBinaryBytes,
                timeoutMs,
            });
        }
        catch (error) {
            return {
                sources: [],
                skipped: [{ path: locator, reason: `HTTPS ingestion failed: ${safeError(error, [input])}`, severity: "error" }],
            };
        }
    });
    httpResults.forEach((result) => append(result.sources, result.skipped));
    for (const input of options.gitRepositories ?? []) {
        const locator = sanitizeExternalLocator(parseGitSpec(input).repository);
        try {
            const result = await collectGitRepository(input, {
                baseDirectory: options.baseDirectory,
                maxFiles: Math.max(0, maxFiles - sources.length),
                maxBytesPerSource,
                maxBinaryBytes,
                maxTotalBytes: Math.max(0, maxTotalBytes - totalBytes),
                timeoutMs,
            });
            append(result.sources, result.skipped);
        }
        catch (error) {
            skipped.push({ path: locator, reason: `Git ingestion failed: ${safeError(error, [input])}`, severity: "error" });
        }
    }
    for (const input of options.databaseUrls ?? []) {
        let locator = "remote database";
        try {
            locator = sanitizeExternalLocator(input);
            append([await collectDatabaseSchema(input, Math.min(maxBytesPerSource, maxTotalBytes - totalBytes), timeoutMs)]);
        }
        catch (error) {
            skipped.push({ path: locator, reason: `database schema extraction failed: ${safeError(error, [input])}`, severity: "error" });
        }
    }
    const counts = emptyCounts();
    sources.forEach((source) => { counts[source.sourceType ?? "document"] += 1; });
    return { sources, skipped, totalBytes, counts };
}
