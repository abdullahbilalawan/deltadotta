import { execFile } from "node:child_process";
import { databaseDumpInvocation, sanitizeExternalLocator } from "./external-ingestion.js";
import { evidenceHash, type RepositorySource } from "./organization.js";
import type { SkippedSource, SourceScanResult } from "./source-ingestion.js";

export type DatabaseKnowledgeManifest = {
  schemaVersion: "1.0";
  connections: Array<{
    name: string;
    urlEnv: string;
    queries: Array<{
      name: string;
      sql: string;
    }>;
  }>;
};

export type DatabaseKnowledgeInvocation = {
  command: "psql" | "mysql";
  args: string[];
  env: NodeJS.ProcessEnv;
  connector: "postgresql" | "mysql";
  locator: string;
  queryName: string;
  maxRows: number;
};

type CommandRunner = (
  command: string,
  args: string[],
  options: { env: NodeJS.ProcessEnv; timeoutMs: number; maxBuffer: number },
) => Promise<{ stdout: string; stderr: string }>;

const defaultMaxRows = 500;
const defaultMaxBytesPerQuery = 1_000_000;
const defaultMaxTotalBytes = 4_000_000;
const defaultTimeoutMs = 15_000;

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function requiredString(source: Record<string, unknown>, field: string, label: string) {
  const value = source[field];
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label}.${field} must be a non-empty string`);
  return value.trim();
}

function manifestName(source: Record<string, unknown>, field: string, label: string) {
  const value = requiredString(source, field, label);
  if (value.length > 120) throw new Error(`${label}.${field} must be 120 characters or fewer`);
  if (/[\u0000-\u001f\u007f/\\]/.test(value)) {
    throw new Error(`${label}.${field} cannot contain control characters or path separators`);
  }
  return value;
}

export function parseDatabaseKnowledgeManifest(value: unknown): DatabaseKnowledgeManifest {
  const root = record(value, "database query manifest");
  if (root.schemaVersion !== "1.0") throw new Error("database query manifest schemaVersion must be \"1.0\"");
  if (!Array.isArray(root.connections) || !root.connections.length) {
    throw new Error("database query manifest connections must contain at least one connection");
  }
  if (root.connections.length > 10) throw new Error("database query manifest supports at most 10 connections");
  let totalQueries = 0;
  const connectionNames = new Set<string>();
  const connections = root.connections.map((value, connectionIndex) => {
    const label = `database query manifest connections[${connectionIndex}]`;
    const connection = record(value, label);
    const name = manifestName(connection, "name", label);
    if (connectionNames.has(name.toLowerCase())) throw new Error(`database query manifest contains duplicate connection name: ${name}`);
    connectionNames.add(name.toLowerCase());
    const urlEnv = requiredString(connection, "urlEnv", label);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(urlEnv)) throw new Error(`${label}.urlEnv must name an environment variable`);
    if (!Array.isArray(connection.queries) || !connection.queries.length) throw new Error(`${label}.queries must contain at least one query`);
    totalQueries += connection.queries.length;
    if (totalQueries > 50) throw new Error("database query manifest supports at most 50 queries");
    const queryNames = new Set<string>();
    const queries = connection.queries.map((value, queryIndex) => {
      const queryLabel = `${label}.queries[${queryIndex}]`;
      const query = record(value, queryLabel);
      const queryName = manifestName(query, "name", queryLabel);
      if (queryNames.has(queryName.toLowerCase())) throw new Error(`${label} contains duplicate query name: ${queryName}`);
      queryNames.add(queryName.toLowerCase());
      return {
        name: queryName,
        sql: validateReadOnlyQuery(requiredString(query, "sql", queryLabel)),
      };
    });
    return { name, urlEnv, queries };
  });
  return { schemaVersion: "1.0", connections };
}

function scrubSqlLiterals(sql: string) {
  let output = "";
  let quote: "'" | "\"" | "`" | null = null;
  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index];
    if (quote) {
      if (character === quote && sql[index + 1] === quote) {
        output += "  ";
        index += 1;
      } else if (character === quote) {
        quote = null;
        output += " ";
      } else {
        output += " ";
      }
    } else if (character === "'" || character === "\"" || character === "`") {
      quote = character;
      output += " ";
    } else {
      output += character;
    }
  }
  if (quote) throw new Error("database knowledge query contains an unterminated quoted value");
  return output;
}

/** Allows one bounded SELECT/CTE only; transaction-level read-only mode remains the final guard. */
export function validateReadOnlyQuery(input: string) {
  let sql = input.trim();
  if (sql.length > 20_000) throw new Error("database knowledge query exceeds the 20,000-character limit");
  if (sql.endsWith(";")) sql = sql.slice(0, -1).trim();
  if (!sql) throw new Error("database knowledge query is empty");
  const scrubbed = scrubSqlLiterals(sql);
  if (/(?:--|\/\*|\*\/|#)/.test(scrubbed)) throw new Error("database knowledge queries cannot contain SQL comments");
  if (scrubbed.includes(";")) throw new Error("database knowledge queries must contain exactly one statement");
  if (!/^\s*(?:select|with)\b/i.test(scrubbed)) throw new Error("database knowledge queries must start with SELECT or WITH");
  const forbidden = /\b(?:insert|update|delete|merge|alter|create|drop|truncate|grant|revoke|copy|call|execute|do|vacuum|analyze|refresh|replace|load|lock|set|reset|begin|commit|rollback|into)\b|\bfor\s+(?:no\s+key\s+update|key\s+share|update|share)\b|:=/i;
  const match = forbidden.exec(scrubbed);
  if (match) throw new Error(`database knowledge query contains forbidden operation: ${match[0].toUpperCase()}`);
  const unsafeFunction = /\b(?:dblink|dblink_exec|get_lock|release_lock|release_all_locks|sleep|benchmark|load_file|lo_import|lo_export|lo_unlink|nextval|setval|set_config|pg_(?:try_)?advisory_(?:xact_)?(?:lock|unlock)(?:_shared|_all)?|pg_notify|pg_sleep|pg_sleep_for|pg_sleep_until|pg_read_file|pg_read_binary_file|pg_ls_dir|pg_ls_logdir|pg_ls_waldir|pg_ls_archive_statusdir|pg_stat_file|pg_cancel_backend|pg_terminate_backend|pg_reload_conf|pg_rotate_logfile|pg_log_backend_memory_contexts|pg_export_snapshot|pg_create_restore_point|pg_switch_wal|pg_wal_replay_pause|pg_wal_replay_resume|pg_promote|pg_backup_start|pg_backup_stop)\s*\(/i.exec(scrubbed);
  if (unsafeFunction) throw new Error(`database knowledge query contains forbidden function: ${unsafeFunction[0].replace(/\s*\($/, "").toUpperCase()}`);
  return sql;
}

function databaseName(url: URL) {
  const name = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
  if (!name) throw new Error("database URL must include a database name");
  return name;
}

export function databaseKnowledgeInvocation(
  databaseUrl: string,
  queryName: string,
  query: string,
  options: { environment?: NodeJS.ProcessEnv; maxRows?: number; timeoutMs?: number } = {},
): DatabaseKnowledgeInvocation {
  const environment = options.environment ?? process.env;
  const maxRows = options.maxRows ?? defaultMaxRows;
  const timeoutMs = options.timeoutMs ?? 10_000;
  if (!Number.isInteger(maxRows) || maxRows < 1 || maxRows > 5_000) throw new Error("database knowledge maxRows must be between 1 and 5000");
  const sql = validateReadOnlyQuery(query);
  const dump = databaseDumpInvocation(databaseUrl, environment);
  const url = new URL(databaseUrl);
  url.password = "";
  const locator = `${sanitizeExternalLocator(databaseUrl)}#query=${encodeURIComponent(queryName)}`;
  if (dump.connector === "postgresql") {
    const boundedQuery = `SELECT COALESCE(json_agg(row_to_json(deltadotta_rows)), '[]'::json)
FROM (
  SELECT * FROM (${sql}) AS deltadotta_query
  LIMIT ${maxRows + 1}
) AS deltadotta_rows`;
    const pgOptions = `${environment.PGOPTIONS ?? ""} -c default_transaction_read_only=on -c statement_timeout=${timeoutMs}`.trim();
    return {
      command: "psql",
      args: ["--no-psqlrc", "--quiet", "--tuples-only", "--no-align", "--set", "ON_ERROR_STOP=1", "--dbname", url.toString(), "--command", boundedQuery],
      env: { ...dump.env, PGOPTIONS: pgOptions },
      connector: "postgresql",
      locator,
      queryName,
      maxRows,
    };
  }
  const boundedQuery = `SET SESSION MAX_EXECUTION_TIME=${timeoutMs};
START TRANSACTION READ ONLY;
SELECT * FROM (${sql}) AS deltadotta_query LIMIT ${maxRows + 1};
ROLLBACK;`;
  return {
    command: "mysql",
    args: [
      "--batch",
      "--connect-timeout=10",
      "--host", url.hostname,
      "--port", url.port || "3306",
      "--user", decodeURIComponent(url.username),
      "--database", databaseName(url),
      "--execute", boundedQuery,
    ],
    env: dump.env,
    connector: "mysql",
    locator,
    queryName,
    maxRows,
  };
}

const defaultRunner: CommandRunner = (command, args, options) => new Promise((done, reject) => {
  execFile(command, args, {
    env: options.env,
    timeout: options.timeoutMs,
    maxBuffer: options.maxBuffer,
    windowsHide: true,
  }, (error, stdout, stderr) => {
    if (error) {
      reject(new Error(String(stderr || error.message).trim() || `${command} exited unsuccessfully`));
      return;
    }
    done({ stdout: String(stdout), stderr: String(stderr) });
  });
});

function parsePostgresRows(stdout: string, maxRows: number) {
  const candidate = stdout.split("\n").map((line) => line.trim()).filter(Boolean).find((line) => line.startsWith("["));
  if (!candidate) throw new Error("psql returned no JSON row set");
  const value = JSON.parse(candidate) as unknown;
  if (!Array.isArray(value)) throw new Error("psql row set was not a JSON array");
  return {
    content: JSON.stringify(value.slice(0, maxRows), null, 2),
    truncated: value.length > maxRows,
  };
}

function parseMysqlRows(stdout: string, maxRows: number) {
  const lines = stdout.replace(/\r/g, "").split("\n").filter((line) => line.length);
  if (!lines.length) return { content: "No rows returned.", truncated: false };
  const rowCount = Math.max(0, lines.length - 1);
  return {
    content: lines.slice(0, maxRows + 1).join("\n"),
    truncated: rowCount > maxRows,
  };
}

function positiveInteger(value: number, label: string, upperBound: number) {
  if (!Number.isInteger(value) || value < 1 || value > upperBound) {
    throw new Error(`${label} must be between 1 and ${upperBound}`);
  }
  return value;
}

function safeDatabaseError(error: unknown, databaseUrl: string) {
  let message = error instanceof Error ? error.message : String(error);
  const secrets = [databaseUrl];
  try {
    const parsed = new URL(databaseUrl);
    if (parsed.password) secrets.push(decodeURIComponent(parsed.password), parsed.password);
  } catch {
    // URL validation is reported by databaseKnowledgeInvocation.
  }
  for (const secret of secrets.filter(Boolean)) message = message.split(secret).join("[redacted]");
  return message;
}

export async function collectDatabaseKnowledge(
  manifestValue: unknown,
  options: {
    environment?: NodeJS.ProcessEnv;
    maxRows?: number;
    maxBytesPerQuery?: number;
    maxTotalBytes?: number;
    timeoutMs?: number;
    runner?: CommandRunner;
  } = {},
): Promise<SourceScanResult> {
  const manifest = parseDatabaseKnowledgeManifest(manifestValue);
  const environment = options.environment ?? process.env;
  const maxRows = positiveInteger(options.maxRows ?? defaultMaxRows, "database knowledge maxRows", 5_000);
  const maxBytesPerQuery = positiveInteger(options.maxBytesPerQuery ?? defaultMaxBytesPerQuery, "database knowledge maxBytesPerQuery", 10_000_000);
  const maxTotalBytes = positiveInteger(options.maxTotalBytes ?? defaultMaxTotalBytes, "database knowledge maxTotalBytes", 40_000_000);
  const timeoutMs = positiveInteger(options.timeoutMs ?? defaultTimeoutMs, "database knowledge timeoutMs", 120_000);
  const runner = options.runner ?? defaultRunner;
  const sources: RepositorySource[] = [];
  const skipped: SkippedSource[] = [];
  let totalBytes = 0;

  for (const connection of manifest.connections) {
    const databaseUrl = environment[connection.urlEnv];
    if (!databaseUrl) {
      skipped.push({ path: connection.name, reason: `database URL environment variable ${connection.urlEnv} is not set`, severity: "error" });
      continue;
    }
    for (const query of connection.queries) {
      const path = `${connection.name}/${query.name}`;
      if (totalBytes >= maxTotalBytes) {
        skipped.push({ path, reason: `aggregate database knowledge limit of ${maxTotalBytes} bytes was reached`, severity: "error" });
        continue;
      }
      let invocation: DatabaseKnowledgeInvocation;
      try {
        invocation = databaseKnowledgeInvocation(databaseUrl, query.name, query.sql, {
          environment,
          maxRows,
          timeoutMs,
        });
      } catch (error) {
        skipped.push({ path, reason: safeDatabaseError(error, databaseUrl), severity: "error" });
        continue;
      }
      try {
        const result = await runner(invocation.command, invocation.args, {
          env: invocation.env,
          timeoutMs,
          maxBuffer: maxBytesPerQuery,
        });
        const parsed = invocation.connector === "postgresql"
          ? parsePostgresRows(result.stdout, invocation.maxRows)
          : parseMysqlRows(result.stdout, invocation.maxRows);
        const contentBytes = Buffer.byteLength(parsed.content);
        if (contentBytes > maxBytesPerQuery) throw new Error(`query output exceeds the ${maxBytesPerQuery}-byte limit`);
        if (totalBytes + contentBytes > maxTotalBytes) {
          skipped.push({ path, reason: `query output would exceed the aggregate ${maxTotalBytes}-byte database knowledge limit`, severity: "error" });
          continue;
        }
        sources.push({
          path,
          content: parsed.content,
          sourceType: "database",
          sourceHash: evidenceHash(parsed.content),
          sourceEncoding: "text",
          sourceConnector: invocation.connector,
          sourceLocator: invocation.locator,
          sourceRevision: evidenceHash(query.sql),
        });
        totalBytes += contentBytes;
        if (parsed.truncated) skipped.push({ path, reason: `query result truncated at ${invocation.maxRows} rows` });
      } catch (error) {
        skipped.push({
          path,
          reason: `read-only query failed: ${safeDatabaseError(error, databaseUrl)}`,
          severity: "error",
        });
      }
    }
  }
  return {
    sources,
    skipped,
    totalBytes,
    counts: { codebase: 0, document: 0, database: sources.length },
  };
}
