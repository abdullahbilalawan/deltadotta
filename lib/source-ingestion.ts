import { lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createRequire, isBuiltin } from "node:module";
import { basename, extname, isAbsolute, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import JSZip from "jszip";
import { evidenceHash, type RepositorySource, type SourceType } from "./organization.js";

const ignoredDirectories = new Set([
  ".git",
  ".next",
  ".turbo",
  ".deltadotta",
  "node_modules",
  "dist",
  "build",
  "coverage",
  "vendor",
]);
const ignoredFiles = new Set([".DS_Store", "Thumbs.db", "desktop.ini"]);

const documentExtensions = new Set([
  ".csv", ".html", ".htm", ".json", ".jsonl", ".md", ".mdx", ".rst",
  ".text", ".toml", ".tsv", ".txt", ".xml", ".yaml", ".yml",
]);
const databaseExtensions = new Set([".dbml", ".ddl", ".prisma", ".schema", ".sql"]);
const codeExtensions = new Set([
  ".bash", ".c", ".cc", ".conf", ".cpp", ".cs", ".css", ".go", ".graphql",
  ".h", ".hpp", ".ini", ".java", ".js", ".jsx", ".kt", ".kts", ".php", ".properties",
  ".py", ".rb", ".rs", ".scss", ".sh", ".swift", ".tf", ".tsx", ".ts", ".zsh",
]);
const specialTextFiles = /(?:^|\/)(?:AGENTS\.md|CLAUDE\.md|CODEOWNERS|Dockerfile|Makefile|Procfile)$/i;
const officeDocumentExtensions = new Set([".docx", ".odt", ".ods", ".odp", ".pdf", ".pptx", ".rtf", ".xlsx"]);
const unsupportedBinaryDocumentExtensions = new Set([".doc", ".ppt", ".xls"]);
const sqliteDatabaseExtensions = new Set([".db", ".sqlite", ".sqlite3"]);
const archiveExtensions = new Set([".zip"]);
const maxArchiveEntries = 1_000;

export type SourceScanOptions = {
  baseDirectory: string;
  sources: string[];
  databases?: string[];
  maxFiles?: number;
  maxBytesPerFile?: number;
  maxBinaryBytesPerFile?: number;
  maxTotalBytes?: number;
  excludedPaths?: string[];
};

export type SkippedSource = {
  path: string;
  reason: string;
  severity?: "warning" | "error";
};

export type SourceScanResult = {
  sources: RepositorySource[];
  skipped: SkippedSource[];
  totalBytes: number;
  counts: Record<SourceType, number>;
};

/**
 * Combines independently bounded connectors into one deterministic evidence
 * budget. Any overflow is an error so callers cannot mistake a partial
 * organization for a complete import.
 */
export function mergeSourceScanResults(
  results: SourceScanResult[],
  options: { maxFiles?: number; maxTotalBytes?: number } = {},
): SourceScanResult {
  const maxFiles = options.maxFiles ?? 500;
  const maxTotalBytes = options.maxTotalBytes ?? 4_000_000;
  if (!Number.isInteger(maxFiles) || maxFiles < 1) throw new Error("combined source maxFiles must be a positive integer");
  if (!Number.isInteger(maxTotalBytes) || maxTotalBytes < 1) throw new Error("combined source maxTotalBytes must be a positive integer");
  const sources: RepositorySource[] = [];
  const skipped = results.flatMap((result) => result.skipped);
  let totalBytes = 0;
  let fileOverflow = 0;
  let byteOverflow = 0;

  for (const result of results) {
    for (const source of result.sources) {
      const bytes = Buffer.byteLength(source.content);
      if (sources.length >= maxFiles) {
        fileOverflow += 1;
        continue;
      }
      if (totalBytes + bytes > maxTotalBytes) {
        byteOverflow += 1;
        continue;
      }
      sources.push(source);
      totalBytes += bytes;
    }
  }
  if (fileOverflow) {
    skipped.push({
      path: "(combined scan)",
      reason: `${fileOverflow} source${fileOverflow === 1 ? " was" : "s were"} omitted because the combined ${maxFiles}-file limit was reached`,
      severity: "error",
    });
  }
  if (byteOverflow) {
    skipped.push({
      path: "(combined scan)",
      reason: `${byteOverflow} source${byteOverflow === 1 ? " was" : "s were"} omitted because the combined ${maxTotalBytes}-byte limit was reached`,
      severity: "error",
    });
  }
  const counts: Record<SourceType, number> = { codebase: 0, document: 0, database: 0 };
  sources.forEach((source) => { counts[source.sourceType ?? "document"] += 1; });
  return { sources, skipped, totalBytes, counts };
}

function normalizedPath(path: string) {
  return path.replace(/\\/g, "/");
}

function sourceType(path: string, databaseHint: boolean): SourceType | null {
  const normalized = normalizedPath(path);
  const extension = extname(normalized).toLowerCase();
  if (databaseHint || databaseExtensions.has(extension) || sqliteDatabaseExtensions.has(extension) || /(?:^|\/)(?:database|db|migrations?|schema)(?:\/|$)/i.test(normalized)) return "database";
  if (officeDocumentExtensions.has(extension) || archiveExtensions.has(extension)) return "document";
  if (codeExtensions.has(extension) || specialTextFiles.test(normalized) || /(?:^|\/)\.github\/workflows\//i.test(normalized)) return "codebase";
  if (documentExtensions.has(extension) || (!extension && /(?:^|\/)(?:docs?|handbook|policies|runbooks?|knowledge)(?:\/|$)/i.test(normalized))) return "document";
  return null;
}

function unsupportedReason(path: string, databaseHint: boolean) {
  const extension = extname(path).toLowerCase();
  if (unsupportedBinaryDocumentExtensions.has(extension)) {
    return "legacy binary Office file; convert it to DOCX, XLSX, PPTX, PDF, text, CSV, or JSON before onboarding";
  }
  if (databaseHint) {
    return "unsupported database input; use SQLite or export schema metadata as SQL, DBML, Prisma, CSV, or JSON";
  }
  return "unsupported or non-text file";
}

function displayPath(baseDirectory: string, absolutePath: string) {
  const path = relative(baseDirectory, absolutePath);
  return normalizedPath(path && !path.startsWith("..") ? path : absolutePath);
}

function isProbablyBinary(content: Buffer) {
  const sample = content.subarray(0, Math.min(content.length, 8_000));
  return sample.includes(0);
}

function safeArchiveEntryPath(input: string) {
  const normalized = normalizedPath(input);
  if (!normalized
    || normalized.startsWith("/")
    || /^[A-Za-z]:\//.test(normalized)
    || normalized.includes("\u0000")
    || normalized.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error(`unsafe archive entry path: ${JSON.stringify(input)}`);
  }
  return normalized;
}

function truncateUtf8(input: string, maxBytes: number) {
  const encoded = Buffer.from(input);
  if (encoded.length <= maxBytes) return input;
  let end = maxBytes;
  while (end > 0 && (encoded[end] & 0xc0) === 0x80) end -= 1;
  return encoded.subarray(0, end).toString("utf8");
}

/** Reads SQLite structure only. No application rows are selected. */
export async function extractSqliteSchema(path: string) {
  const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as {
    DatabaseSync: new (location: string, options: Record<string, unknown>) => {
      prepare(sql: string): { all(): unknown[] };
      close(): void;
    };
  };
  const database = new DatabaseSync(path, {
    readOnly: true,
    enableForeignKeyConstraints: false,
    allowExtension: false,
  });
  try {
    const rows = database.prepare(`
      SELECT type, name, tbl_name AS tableName, sql
      FROM sqlite_schema
      WHERE sql IS NOT NULL
        AND name NOT LIKE 'sqlite_%'
      ORDER BY type, name
    `).all() as Array<{ type: string; name: string; tableName: string; sql: string }>;
    if (!rows.length) return "-- SQLite database contains no user-defined schema objects.";
    return rows.map((row) => `-- ${row.type}: ${row.name} (${row.tableName})\n${row.sql};`).join("\n\n");
  } finally {
    database.close();
  }
}

/**
 * Bounded multi-source ingestion for local organization knowledge.
 *
 * Inputs may be files or directories. Symlinks are intentionally skipped so a
 * scan cannot silently escape the paths the user selected.
 */
export async function collectKnowledgeSources(options: SourceScanOptions): Promise<SourceScanResult> {
  const baseDirectory = resolve(options.baseDirectory);
  const maxFiles = options.maxFiles ?? 500;
  const maxBytesPerFile = options.maxBytesPerFile ?? 128_000;
  const maxBinaryBytesPerFile = options.maxBinaryBytesPerFile ?? 25_000_000;
  const maxTotalBytes = options.maxTotalBytes ?? 4_000_000;
  const requested = [
    ...options.sources.map((path) => ({ path, databaseHint: false })),
    ...(options.databases ?? []).map((path) => ({ path, databaseHint: true })),
  ];
  const excludedPaths = (options.excludedPaths ?? []).map((path) => resolve(baseDirectory, path));
  const found: RepositorySource[] = [];
  const skipped: SkippedSource[] = [];
  const seen = new Set<string>();
  let totalBytes = 0;
  let fileLimitExceeded = false;
  let totalLimitExceeded = false;

  function recordFailure(path: string, reason: string, required: boolean) {
    skipped.push({ path, reason, severity: required ? "error" : "warning" });
  }

  async function visit(inputPath: string, databaseHint: boolean, required: boolean): Promise<void> {
    if (found.length >= maxFiles) {
      fileLimitExceeded = true;
      return;
    }
    if (totalBytes >= maxTotalBytes) {
      totalLimitExceeded = true;
      return;
    }
    const absolutePath = resolve(baseDirectory, inputPath);
    if (excludedPaths.some((excludedPath) => {
      const pathFromExclusion = relative(excludedPath, absolutePath);
      return pathFromExclusion === "" || (!pathFromExclusion.startsWith("..") && !isAbsolute(pathFromExclusion));
    })) return;
    if (seen.has(absolutePath)) return;
    seen.add(absolutePath);

    let details;
    try {
      details = await lstat(absolutePath);
    } catch {
      recordFailure(inputPath, "path does not exist or cannot be read", required);
      return;
    }

    if (details.isSymbolicLink()) {
      skipped.push({ path: displayPath(baseDirectory, absolutePath), reason: "symbolic link skipped" });
      return;
    }
    if (details.isDirectory()) {
      if (ignoredDirectories.has(basename(absolutePath))) return;
      let entries;
      try {
        entries = await readdir(absolutePath, { withFileTypes: true });
      } catch {
        recordFailure(displayPath(baseDirectory, absolutePath), "directory cannot be read", required);
        return;
      }
      for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
        if (found.length >= maxFiles) {
          fileLimitExceeded = true;
          break;
        }
        if (totalBytes >= maxTotalBytes) {
          totalLimitExceeded = true;
          break;
        }
        if (entry.isSymbolicLink()) {
          skipped.push({ path: displayPath(baseDirectory, resolve(absolutePath, entry.name)), reason: "symbolic link skipped" });
          continue;
        }
        if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
        if (!entry.isDirectory() && ignoredFiles.has(entry.name)) continue;
        await visit(resolve(absolutePath, entry.name), databaseHint, false);
      }
      return;
    }

    if (!details.isFile()) return;
    if (ignoredFiles.has(basename(absolutePath))) return;
    const type = sourceType(absolutePath, databaseHint);
    if (!type) {
      const extension = extname(absolutePath).toLowerCase();
      if (required || unsupportedBinaryDocumentExtensions.has(extension) || databaseHint) {
        recordFailure(
          displayPath(baseDirectory, absolutePath),
          unsupportedReason(absolutePath, databaseHint),
          required,
        );
      }
      return;
    }
    const extension = extname(absolutePath).toLowerCase();
    const officeDocument = officeDocumentExtensions.has(extension);
    const sqliteDatabase = sqliteDatabaseExtensions.has(extension);
    const archive = archiveExtensions.has(extension);
    const binaryContainer = officeDocument || archive;
    const inputLimit = binaryContainer ? maxBinaryBytesPerFile : maxBytesPerFile;
    if (!sqliteDatabase && details.size > inputLimit) {
      recordFailure(
        displayPath(baseDirectory, absolutePath),
        `larger than the ${inputLimit}-byte per-file limit`,
        required,
      );
      return;
    }
    if (!binaryContainer && !sqliteDatabase && totalBytes + details.size > maxTotalBytes) {
      recordFailure(
        displayPath(baseDirectory, absolutePath),
        `would exceed the ${maxTotalBytes}-byte scan limit`,
        required,
      );
      return;
    }

    let bytes: Buffer | undefined;
    if (!sqliteDatabase) {
      try {
        bytes = await readFile(absolutePath);
      } catch {
        recordFailure(displayPath(baseDirectory, absolutePath), "file cannot be read", required);
        return;
      }
    }
    if (bytes && !binaryContainer && isProbablyBinary(bytes)) {
      recordFailure(
        displayPath(baseDirectory, absolutePath),
        unsupportedReason(absolutePath, databaseHint),
        required,
      );
      return;
    }
    if (archive) {
      const archivePath = displayPath(baseDirectory, absolutePath);
      const archiveHash = evidenceHash(bytes!.toString("base64"));
      let zip: JSZip;
      try {
        zip = await JSZip.loadAsync(bytes!, { createFolders: true });
      } catch (error) {
        skipped.push({
          path: archivePath,
          reason: `ZIP export could not be opened: ${error instanceof Error ? error.message : "invalid archive"}`,
          severity: required ? "error" : "warning",
        });
        return;
      }
      const entries = Object.values(zip.files).filter((entry) => !entry.dir);
      if (entries.length > maxArchiveEntries) {
        skipped.push({
          path: archivePath,
          reason: `ZIP export contains ${entries.length} files, above the ${maxArchiveEntries}-entry limit`,
          severity: required ? "error" : "warning",
        });
        return;
      }
      const selected: Array<{ entry: (typeof entries)[number]; path: string; declaredBytes: number }> = [];
      const entryPaths = new Set<string>();
      const portableEntryPaths = new Set<string>();
      let expandedBytes = 0;
      try {
        for (const entry of entries) {
          const originalName = (entry as typeof entry & { unsafeOriginalName?: string }).unsafeOriginalName ?? entry.name;
          const path = safeArchiveEntryPath(originalName);
          const permissions = (entry as typeof entry & { unixPermissions?: number | string }).unixPermissions;
          if (typeof permissions === "number" && (permissions & 0o170000) === 0o120000) {
            throw new Error(`symbolic-link archive entry is not allowed: ${JSON.stringify(path)}`);
          }
          if (entryPaths.has(path)) throw new Error(`duplicate archive entry path: ${JSON.stringify(path)}`);
          entryPaths.add(path);
          const portablePath = path.normalize("NFC").toLocaleLowerCase("en-US");
          if (portableEntryPaths.has(portablePath)) {
            throw new Error(`archive entry path collides on case-insensitive or Unicode-normalizing filesystems: ${JSON.stringify(path)}`);
          }
          portableEntryPaths.add(portablePath);
          const metadata = entry as typeof entry & { _data?: { uncompressedSize?: number } };
          const declaredBytes = metadata._data?.uncompressedSize;
          if (!Number.isSafeInteger(declaredBytes) || declaredBytes! < 0) {
            throw new Error(`archive entry has no safe expanded-size metadata: ${JSON.stringify(path)}`);
          }
          expandedBytes += declaredBytes!;
          if (expandedBytes > maxBinaryBytesPerFile) {
            throw new Error(`expanded archive exceeds the ${maxBinaryBytesPerFile}-byte limit`);
          }
          const entryExtension = extname(path).toLowerCase();
          if (archiveExtensions.has(entryExtension)) {
            skipped.push({
              path: `${archivePath}!/${path}`,
              reason: "nested ZIP archives are not imported; extract the nested archive and select it separately",
              severity: required ? "error" : "warning",
            });
            continue;
          }
          if (unsupportedBinaryDocumentExtensions.has(entryExtension)) {
            skipped.push({
              path: `${archivePath}!/${path}`,
              reason: unsupportedReason(path, false),
              severity: required ? "error" : "warning",
            });
            continue;
          }
          if (sourceType(path, databaseHint)) selected.push({ entry, path, declaredBytes: declaredBytes! });
        }
      } catch (error) {
        skipped.push({
          path: archivePath,
          reason: `ZIP export rejected: ${error instanceof Error ? error.message : "unsafe archive metadata"}`,
          severity: required ? "error" : "warning",
        });
        return;
      }
      try {
        await JSZip.loadAsync(bytes!, { createFolders: true, checkCRC32: true });
      } catch (error) {
        skipped.push({
          path: archivePath,
          reason: `ZIP export integrity check failed: ${error instanceof Error ? error.message : "checksum mismatch"}`,
          severity: required ? "error" : "warning",
        });
        return;
      }
      if (!selected.length) {
        if (!skipped.some((item) => item.path.startsWith(`${archivePath}!/`) && item.severity === (required ? "error" : "warning"))) {
          recordFailure(archivePath, "ZIP export contains no supported knowledge files", required);
        }
        return;
      }
      const temporaryDirectory = await mkdtemp(resolve(tmpdir(), "deltadotta-zip-"));
      try {
        for (const { entry, path, declaredBytes } of selected) {
          const content = await entry.async("nodebuffer");
          if (content.length !== declaredBytes) throw new Error(`expanded size changed for archive entry ${JSON.stringify(path)}`);
          const location = resolve(temporaryDirectory, path);
          await mkdir(resolve(location, ".."), { recursive: true });
          await writeFile(location, content);
        }
        const remainingFiles = Math.max(1, maxFiles - found.length);
        const remainingBytes = Math.max(1, maxTotalBytes - totalBytes);
        const extracted = await collectKnowledgeSources({
          baseDirectory: temporaryDirectory,
          sources: ["."],
          maxFiles: remainingFiles,
          maxBytesPerFile,
          maxBinaryBytesPerFile,
          maxTotalBytes: remainingBytes,
        });
        extracted.sources.forEach((source) => {
          const contentBytes = Buffer.byteLength(source.content);
          found.push({
            ...source,
            path: `${archivePath}!/${source.path}`,
            sourceHash: archiveHash,
            sourceEncoding: "binary",
          });
          totalBytes += contentBytes;
        });
        skipped.push(...extracted.skipped.map((item) => ({
          ...item,
          path: `${archivePath}!/${item.path}`,
        })));
      } catch (error) {
        skipped.push({
          path: archivePath,
          reason: `ZIP export extraction failed: ${error instanceof Error ? error.message : "unknown archive error"}`,
          severity: required ? "error" : "warning",
        });
      } finally {
        await rm(temporaryDirectory, { force: true, recursive: true });
      }
      return;
    }
    let content: string;
    if (sqliteDatabase) {
      try {
        content = (await extractSqliteSchema(absolutePath)).trim();
      } catch (error) {
        skipped.push({
          path: displayPath(baseDirectory, absolutePath),
          reason: `SQLite schema extraction failed: ${error instanceof Error ? error.message : "unknown database error"}`,
          severity: required ? "error" : "warning",
        });
        return;
      }
    } else if (officeDocument) {
      try {
        if (extension === ".pdf" && typeof globalThis.DOMMatrix === "undefined") {
          const runtimeProcess = process as NodeJS.Process & { getBuiltinModule?: (id: string) => unknown };
          if (!runtimeProcess.getBuiltinModule) {
            const localRequire = createRequire(import.meta.url);
            runtimeProcess.getBuiltinModule = (id: string) => {
              if (!isBuiltin(id)) throw new Error(`Not a built-in Node.js module: ${id}`);
              return localRequire(id);
            };
          }
          const canvas = await import("@napi-rs/canvas");
          Object.assign(globalThis, {
            DOMMatrix: canvas.DOMMatrix,
            ImageData: canvas.ImageData,
            Path2D: canvas.Path2D,
          });
        }
        const { OfficeParser } = await import("officeparser");
        const ast = await OfficeParser.parseOffice(absolutePath, {
          extractAttachments: false,
          includeRawContent: false,
          ocr: false,
          outputErrorToConsole: false,
        });
        const rendered = await ast.to("text", {
          includeImages: false,
          textConfig: { preserveLayout: true, renderNotes: true },
        });
        content = typeof rendered.value === "string" ? rendered.value.trim() : "";
      } catch (error) {
        skipped.push({
          path: displayPath(baseDirectory, absolutePath),
          reason: `document text extraction failed: ${error instanceof Error ? error.message : "unknown parser error"}`,
          severity: required ? "error" : "warning",
        });
        return;
      }
    } else {
      content = bytes!.toString("utf8").trim();
    }
    if (!content) return;
    let extractedBytes = Buffer.byteLength(content);
    if (extractedBytes > maxBytesPerFile) {
      content = truncateUtf8(content, maxBytesPerFile);
      extractedBytes = Buffer.byteLength(content);
      skipped.push({ path: displayPath(baseDirectory, absolutePath), reason: `extracted text truncated at the ${maxBytesPerFile}-byte per-file limit` });
    }
    if (totalBytes + extractedBytes > maxTotalBytes) {
      recordFailure(
        displayPath(baseDirectory, absolutePath),
        `would exceed the ${maxTotalBytes}-byte scan limit`,
        required,
      );
      return;
    }
    totalBytes += extractedBytes;
    found.push({
      path: displayPath(baseDirectory, absolutePath),
      content,
      sourceType: type,
      sourceHash: officeDocument ? evidenceHash(bytes!.toString("base64")) : evidenceHash(content),
      sourceEncoding: sqliteDatabase ? "sqlite-schema" : officeDocument ? "binary" : "text",
    });
  }

  for (const item of requested) {
    await visit(item.path, item.databaseHint, true);
  }

  const counts: Record<SourceType, number> = { codebase: 0, document: 0, database: 0 };
  found.forEach((source) => { counts[source.sourceType ?? "document"] += 1; });
  if (fileLimitExceeded) skipped.push({ path: "(scan)", reason: `stopped at the ${maxFiles}-file limit`, severity: "error" });
  if (totalLimitExceeded) skipped.push({ path: "(scan)", reason: `stopped at the ${maxTotalBytes}-byte total limit`, severity: "error" });

  return { sources: found, skipped, totalBytes, counts };
}
