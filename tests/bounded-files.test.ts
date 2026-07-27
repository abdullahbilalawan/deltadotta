import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readBoundedFile, readBoundedUtf8File } from "../lib/bounded-files";

describe("bounded control-file reads", () => {
  it("accepts exact byte limits and rejects oversized files before parsing", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "deltadotta-bounded-read-"));
    const location = join(workspace, "control.json");
    await writeFile(location, "éé", "utf8");

    await expect(readBoundedUtf8File(location, 4, "control file")).resolves.toBe("éé");
    await expect(readBoundedFile(location, 4, "binary control file"))
      .resolves.toEqual(Buffer.from("éé"));
    await expect(readBoundedUtf8File(location, 3, "control file"))
      .rejects.toThrow("control file exceeds the 3-byte limit");
  });
});
