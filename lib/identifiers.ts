export function stableIdentifierHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function asciiSlug(value: string) {
  return value
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function portableIdentifier(value: string, prefix = "item", maxLength = 63) {
  const safePrefix = asciiSlug(prefix) || "item";
  const fallback = `${safePrefix}-${stableIdentifierHash(value)}`;
  const slug = asciiSlug(value) || fallback;
  return slug.slice(0, Math.max(1, maxLength)).replace(/-$/g, "") || fallback.slice(0, maxLength);
}

export function canonicalRoleKey(title: string) {
  const normalizedText = title.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
  const aliasCandidate = asciiSlug(normalizedText).replace(/-/g, "");
  const aliases: Record<string, string> = {
    ceo: "chiefexecutiveofficer",
    chiefexecutiveofficer: "chiefexecutiveofficer",
    coo: "chiefoperatingofficer",
    chiefoperatingofficer: "chiefoperatingofficer",
    cfo: "chieffinancialofficer",
    chieffinancialofficer: "chieffinancialofficer",
    cto: "chieftechnologyofficer",
    chieftechnologyofficer: "chieftechnologyofficer",
    cio: "chiefinformationofficer",
    chiefinformationofficer: "chiefinformationofficer",
    cmo: "chiefmarketingofficer",
    chiefmarketingofficer: "chiefmarketingofficer",
    cro: "chiefrevenueofficer",
    chiefrevenueofficer: "chiefrevenueofficer",
  };
  return aliases[aliasCandidate]
    || normalizedText
    || `unicode${stableIdentifierHash(title)}`;
}

export function roleArtifactSlugs(roles: Array<{ id: string; title: string }>) {
  const bases = roles.map((role) => portableIdentifier(role.title, "role"));
  const counts = new Map<string, number>();
  bases.forEach((base) => counts.set(base, (counts.get(base) ?? 0) + 1));
  const used = new Set<string>();
  return roles.map((role, index) => {
    const base = bases[index];
    let candidate = counts.get(base) === 1
      ? base
      : `${base.slice(0, 54).replace(/-$/g, "")}-${stableIdentifierHash(`${role.title}\u0000${role.id}`)}`;
    let suffix = 2;
    while (used.has(candidate)) {
      const suffixText = `-${suffix++}`;
      candidate = `${base.slice(0, 63 - suffixText.length).replace(/-$/g, "")}${suffixText}`;
    }
    used.add(candidate);
    return candidate;
  });
}
