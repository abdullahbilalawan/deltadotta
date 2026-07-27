export function isGeneratedPackagePath(path) {
    const normalized = path.replace(/\\/g, "/");
    if (!normalized || normalized.startsWith("/") || normalized.split("/").some((part) => part === "." || part === ".." || !part))
        return false;
    if ([
        "GAPS.md",
        "KNOWLEDGE-PROCESS.md",
        "ORGANIZATION.md",
        "PROVIDER-IMPORT.md",
        "graph.json",
        "manifest.yaml",
        "organization-map.html",
        "policies/authority.md",
        "policies/escalations.md",
        "policies/handoffs.md",
        "review/organization.review.json",
        "validation/generated-files.json",
        "validation/provider-evaluation-cases.json",
        "validation/provider-evaluation-cases.md",
        "validation/provider-evaluation.responses.json",
        "validation/provider-evaluation.json",
        "validation/provider-evaluation.md",
        "validation/provider-knowledge.json",
        "validation/readiness.json",
        "validation/readiness.md",
        "validation/source-ingestion.json",
        "validation/source-ingestion.md",
        "validation/source-plans.json",
        "validation/source-plans.md",
    ].includes(normalized))
        return true;
    if (/^roles\/[a-z0-9]+(?:-[a-z0-9]+)*\/SKILL\.md$/.test(normalized))
        return true;
    if (/^contracts\/[a-z0-9]+(?:-[a-z0-9]+)*\.md$/.test(normalized))
        return true;
    return /^providers\/(?:chatgpt|claude)\/(?:PROJECT-INSTRUCTIONS|GPT-INSTRUCTIONS|KNOWLEDGE(?:-\d{3})?|INSTALL|UPLOAD-MANIFEST)\.md$/.test(normalized)
        || /^providers\/(?:chatgpt|claude)\/EVALUATION-RESPONSES\.json$/.test(normalized);
}
