import { readFile, stat } from "node:fs/promises";
export async function readBoundedFile(location, maxBytes, label = "file") {
    if (!Number.isInteger(maxBytes) || maxBytes < 1) {
        throw new Error(`${label} byte limit must be a positive integer`);
    }
    const details = await stat(location);
    if (!details.isFile())
        throw new Error(`${label} is not a regular file: ${location}`);
    if (details.size > maxBytes) {
        throw new Error(`${label} exceeds the ${maxBytes}-byte limit: ${location}`);
    }
    const content = await readFile(location);
    if (content.length > maxBytes) {
        throw new Error(`${label} grew beyond the ${maxBytes}-byte limit while it was being read: ${location}`);
    }
    return content;
}
export async function readBoundedUtf8File(location, maxBytes, label = "file") {
    return (await readBoundedFile(location, maxBytes, label)).toString("utf8");
}
