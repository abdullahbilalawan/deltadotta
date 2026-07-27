import { findSourceSecrets } from "./source-safety.js";
import { isGeneratedPackagePath } from "./package-paths.js";
import { canonicalRoleKey, roleArtifactSlugs } from "./identifiers.js";
import { evidenceHash } from "./fingerprints.js";
import { providerHandoffArtifactPaths, providerKnowledgeLimits } from "./provider-constraints.js";
const requiredPackageFiles = [
    "manifest.yaml",
    "ORGANIZATION.md",
    "graph.json",
    "GAPS.md",
    "providers/chatgpt/PROJECT-INSTRUCTIONS.md",
    "providers/chatgpt/KNOWLEDGE.md",
    "providers/chatgpt/INSTALL.md",
    "providers/chatgpt/UPLOAD-MANIFEST.md",
    "providers/chatgpt/EVALUATION-RESPONSES.json",
    "providers/claude/PROJECT-INSTRUCTIONS.md",
    "providers/claude/KNOWLEDGE.md",
    "providers/claude/INSTALL.md",
    "providers/claude/UPLOAD-MANIFEST.md",
    "providers/claude/EVALUATION-RESPONSES.json",
    "review/organization.review.json",
    "validation/provider-evaluation-cases.json",
    "validation/provider-evaluation-cases.md",
    "validation/provider-knowledge.json",
    "validation/readiness.json",
    "validation/readiness.md",
    "validation/generated-files.json",
    "validation/source-ingestion.json",
    "validation/source-ingestion.md",
];
export function evaluateOrganizationReadiness(organization, files) {
    const checks = [];
    const add = (check) => checks.push(check);
    const recognizedFingerprint = (value) => Boolean(value && /^(?:sha256-[a-f0-9]{64}|fnv1a-[a-f0-9]{8})$/i.test(value));
    const evidenceIds = new Set(organization.evidence.map((evidence) => evidence.id));
    const fingerprintedEvidenceIds = new Set(organization.evidence.filter((evidence) => recognizedFingerprint(evidence.sourceHash)).map((evidence) => evidence.id));
    const roleIds = new Set(organization.roles.map((role) => role.id));
    const fingerprintedEvidence = organization.evidence.filter((evidence) => recognizedFingerprint(evidence.sourceHash) && (evidence.sourcePath || evidence.sourceLocator));
    add({
        id: "organization-identity",
        status: organization.name.trim() && organization.mission.trim() ? "pass" : "blocker",
        title: "Organization identity",
        detail: organization.name.trim() && organization.mission.trim()
            ? "Organization name and mission are defined."
            : "Organization name and mission are both required.",
    });
    add({
        id: "source-provenance",
        status: fingerprintedEvidence.length ? "pass" : "blocker",
        title: "Source provenance",
        detail: fingerprintedEvidence.length
            ? `${fingerprintedEvidence.length} external source snapshot${fingerprintedEvidence.length === 1 ? " is" : "s are"} fingerprinted.`
            : "No fingerprinted document, codebase, or database source is linked.",
    });
    const presentSourceTypes = new Set(organization.evidence.map((evidence) => evidence.sourceType).filter(Boolean));
    add({
        id: "source-diversity",
        status: presentSourceTypes.size >= 2 ? "pass" : "warning",
        title: "Source diversity",
        detail: presentSourceTypes.size >= 2
            ? `Evidence spans ${Array.from(presentSourceTypes).join(", ")}.`
            : "Only one source class is represented; cross-check important claims against another system of record when one exists.",
    });
    const sourceConflicts = organization.sourceConflicts ?? [];
    const unresolvedSourceConflicts = sourceConflicts.filter((conflict) => {
        const resolution = conflict.resolution;
        return !resolution
            || !resolution.reviewedBy
            || !resolution.reviewedAt
            || !recognizedFingerprint(resolution.sourceHash)
            || resolution.sourceHash !== organization.review?.sourceHash;
    });
    add({
        id: "source-conflicts",
        status: unresolvedSourceConflicts.length ? "blocker" : "pass",
        title: "Cross-source organization conflicts",
        detail: unresolvedSourceConflicts.length
            ? `${unresolvedSourceConflicts.length} conflicting department, reporting, or authority claim${unresolvedSourceConflicts.length === 1 ? " requires" : "s require"} an explicit canonical review decision.`
            : sourceConflicts.length
                ? `${sourceConflicts.length} cross-source conflict${sourceConflicts.length === 1 ? " was" : "s were"} explicitly resolved in the fingerprinted review.`
                : "No conflicting structured department, reporting, or authority claims were detected.",
    });
    const unacknowledgedIngestionWarnings = organization.ingestion?.warnings.filter((warning) => {
        const acknowledgement = warning.acknowledgement;
        return !acknowledgement
            || !acknowledgement.reviewedBy
            || !acknowledgement.reviewedAt
            || !recognizedFingerprint(acknowledgement.sourceHash)
            || acknowledgement.sourceHash !== organization.review?.sourceHash;
    }) ?? [];
    add({
        id: "source-ingestion",
        status: !organization.ingestion
            ? "warning"
            : unacknowledgedIngestionWarnings.length
                ? "blocker"
                : organization.ingestion.warnings.length ? "warning" : "pass",
        title: "Source ingestion completeness",
        detail: !organization.ingestion
            ? "This organization predates the persistent source-ingestion report; regenerate it before relying on completeness claims."
            : unacknowledgedIngestionWarnings.length
                ? `${unacknowledgedIngestionWarnings.length} retained ingestion warning${unacknowledgedIngestionWarnings.length === 1 ? " requires" : "s require"} explicit acknowledgement in organization.review.json.`
                : organization.ingestion.warnings.length
                    ? `${organization.ingestion.warnings.length} retained ingestion warning${organization.ingestion.warnings.length === 1 ? " was" : "s were"} acknowledged in the fingerprinted review and remain visible in validation/source-ingestion.md.`
                    : `${organization.ingestion.sourceCount} selected source${organization.ingestion.sourceCount === 1 ? " was" : "s were"} retained without ingestion warnings.`,
    });
    const sourcePlans = organization.sourcePlans ?? [];
    const nonReplayablePlans = sourcePlans.filter((plan) => !plan.replayable);
    add({
        id: "source-refresh",
        status: !sourcePlans.length || nonReplayablePlans.length ? "warning" : "pass",
        title: "Repeatable source refresh",
        detail: !sourcePlans.length
            ? "No replay plan is recorded; rerun onboard to make future source refreshes reproducible."
            : nonReplayablePlans.length
                ? `${nonReplayablePlans.length} source plan${nonReplayablePlans.length === 1 ? " requires" : "s require"} new connector input because secrets or signed locations were intentionally not stored.`
                : `${sourcePlans.length} source plan${sourcePlans.length === 1 ? " is" : "s are"} replayable using stored locations and environment-variable names.`,
    });
    add({
        id: "human-review",
        status: organization.review?.reviewedBy && organization.review.reviewedAt && recognizedFingerprint(organization.review.sourceHash) ? "pass" : "blocker",
        title: "Accountable human review",
        detail: organization.review?.reviewedBy && organization.review.reviewedAt && recognizedFingerprint(organization.review.sourceHash)
            ? `Reviewed by ${organization.review.reviewedBy} at ${organization.review.reviewedAt}.`
            : "An accountable reviewer, review timestamp, and fingerprinted review file are required.",
    });
    add({
        id: "role-scope",
        status: organization.roles.length ? "pass" : "blocker",
        title: "Canonical role scope",
        detail: organization.roles.length
            ? `${organization.roles.length} role${organization.roles.length === 1 ? " is" : "s are"} in the canonical scope.`
            : "The organization contains no roles.",
    });
    const seenRoleIds = new Set();
    const seenRoleTitles = new Set();
    const duplicateIds = organization.roles.filter((role) => {
        if (seenRoleIds.has(role.id))
            return true;
        seenRoleIds.add(role.id);
        return false;
    });
    const duplicateTitles = organization.roles.filter((role) => {
        const key = canonicalRoleKey(role.title);
        if (seenRoleTitles.has(key))
            return true;
        seenRoleTitles.add(key);
        return false;
    });
    add({
        id: "role-uniqueness",
        status: duplicateIds.length || duplicateTitles.length ? "blocker" : "pass",
        title: "Unique roles",
        detail: duplicateIds.length || duplicateTitles.length
            ? "Duplicate role ids or titles must be resolved."
            : "Role ids and titles are unique.",
    });
    for (const role of organization.roles) {
        const reviewed = role.status === "ready"
            && role.review?.reviewedBy
            && role.review.reviewedAt
            && recognizedFingerprint(role.review.sourceHash)
            && role.review.sourceHash === organization.review?.sourceHash;
        add({
            id: `role-review-${role.id}`,
            status: reviewed ? "pass" : "blocker",
            title: `${role.title}: reviewed`,
            detail: reviewed ? "The role is explicitly confirmed by the accountable reviewer." : "The role remains inferred or unconfirmed.",
            roleId: role.id,
        });
        const genericPurpose = /^(?:review and confirm|define why|own the work and decisions assigned)/i.test(role.purpose.trim());
        const genericOwnership = role.owns.every((item) => /(?:responsibilities described in the linked evidence|operating scope for|not yet defined)/i.test(item));
        const genericAuthority = role.permissions.every((item) => /^(?:decide within this role.?s scope|approve work within team scope|not yet defined)$/i.test(item));
        const coreComplete = Boolean(role.purpose.trim() && !genericPurpose && role.owns.length && !genericOwnership && role.permissions.length && !genericAuthority);
        add({
            id: `role-boundary-${role.id}`,
            status: coreComplete ? "pass" : "blocker",
            title: `${role.title}: purpose, ownership, and authority`,
            detail: coreComplete
                ? "Purpose, owned scope, and authority boundaries are defined."
                : "Purpose, at least one owned area, and at least one authority boundary are required.",
            roleId: role.id,
        });
        const badEvidence = role.evidenceIds.filter((id) => !evidenceIds.has(id));
        const fingerprintedRoleEvidence = role.evidenceIds.filter((id) => fingerprintedEvidenceIds.has(id));
        add({
            id: `role-evidence-${role.id}`,
            status: badEvidence.length || !role.evidenceIds.length || !fingerprintedRoleEvidence.length ? "blocker" : "pass",
            title: `${role.title}: evidence`,
            detail: badEvidence.length
                ? `Unknown evidence references: ${badEvidence.join(", ")}.`
                : !role.evidenceIds.length
                    ? "At least one source must support this role."
                    : !fingerprintedRoleEvidence.length
                        ? "At least one linked source must have a content fingerprint."
                        : `${role.evidenceIds.length} source${role.evidenceIds.length === 1 ? " is" : "s are"} linked, including fingerprinted evidence.`,
            roleId: role.id,
        });
        const unknownManager = role.reportsTo && !roleIds.has(role.reportsTo);
        add({
            id: `role-reporting-${role.id}`,
            status: unknownManager ? "blocker" : "pass",
            title: `${role.title}: reporting line`,
            detail: unknownManager ? `Unknown manager id: ${role.reportsTo}.` : role.reportsTo ? "Reporting line resolves to a known role." : "Role is explicitly top-level.",
            roleId: role.id,
        });
        const unknownEscalation = role.escalatesTo && !roleIds.has(role.escalatesTo);
        const escalationValid = !unknownEscalation && (!role.reportsTo || Boolean(role.escalatesTo));
        add({
            id: `role-escalation-${role.id}`,
            status: escalationValid ? "pass" : "blocker",
            title: `${role.title}: escalation`,
            detail: escalationValid
                ? role.escalatesTo ? "Escalation is explicit and resolves." : "Top-level role has no higher escalation target."
                : unknownEscalation ? `Unknown escalation id: ${role.escalatesTo}.` : "Every non-top-level role needs a known escalation target.",
            roleId: role.id,
        });
        const genericHandoff = role.inputs.every((item) => /^(?:linked source evidence|human owner confirmation|organization context)$/i.test(item))
            || role.outputs.every((item) => /^(?:source-backed decisions|explicit handoffs and unresolved gaps|clear decisions and completed work)$/i.test(item));
        add({
            id: `role-handoff-${role.id}`,
            status: role.inputs.length && role.outputs.length && !genericHandoff ? "pass" : "warning",
            title: `${role.title}: handoff contract`,
            detail: role.inputs.length && role.outputs.length && !genericHandoff
                ? "Inputs and outputs are explicit."
                : "Replace generic or missing inputs and outputs with explicit handoff contracts.",
            roleId: role.id,
        });
    }
    const parents = new Map(organization.roles.map((role) => [role.id, role.reportsTo]));
    const cycleRoles = new Set();
    const reachesCycle = new Map();
    for (const role of organization.roles) {
        const path = [];
        const pathIndexes = new Map();
        let cursor = role.id;
        let cyclic = false;
        while (cursor) {
            const cached = reachesCycle.get(cursor);
            if (cached !== undefined) {
                cyclic = cached;
                break;
            }
            if (pathIndexes.has(cursor)) {
                cyclic = true;
                break;
            }
            pathIndexes.set(cursor, path.length);
            path.push(cursor);
            cursor = parents.get(cursor);
        }
        path.forEach((id) => reachesCycle.set(id, cyclic));
        if (cyclic)
            cycleRoles.add(role.id);
    }
    add({
        id: "reporting-cycles",
        status: cycleRoles.size ? "blocker" : "pass",
        title: "Acyclic reporting graph",
        detail: cycleRoles.size ? `Reporting cycles affect: ${Array.from(cycleRoles).join(", ")}.` : "No circular reporting relationships were found.",
    });
    const ownership = new Map();
    organization.roles.forEach((role) => role.owns.forEach((item) => {
        const key = item.trim().toLowerCase();
        ownership.set(key, [...(ownership.get(key) ?? []), role.title]);
    }));
    const overlappingOwnership = Array.from(ownership.entries()).filter(([, owners]) => owners.length > 1);
    add({
        id: "ownership-overlap",
        status: overlappingOwnership.length ? "warning" : "pass",
        title: "Unambiguous final ownership",
        detail: overlappingOwnership.length
            ? overlappingOwnership.map(([area, owners]) => `${area}: ${owners.join(", ")}`).join("; ")
            : "No exact ownership area is assigned to multiple roles.",
    });
    const topLevelRoles = organization.roles.filter((role) => !role.reportsTo);
    add({
        id: "top-level-roles",
        status: topLevelRoles.length === 1 ? "pass" : topLevelRoles.length ? "warning" : "blocker",
        title: "Top-level accountability",
        detail: topLevelRoles.length === 1
            ? `${topLevelRoles[0].title} is the single top-level role.`
            : topLevelRoles.length
                ? `${topLevelRoles.length} top-level roles are declared; confirm how cross-role deadlocks are resolved.`
                : "At least one top-level role is required.",
    });
    const secretFindings = findSourceSecrets(organization.evidence.map((evidence) => ({
        path: evidence.sourcePath ?? evidence.sourceLocator ?? evidence.name,
        content: evidence.excerpt,
        sourceType: evidence.sourceType,
    })));
    add({
        id: "credential-safety",
        status: secretFindings.length ? "blocker" : "pass",
        title: "Credential safety",
        detail: secretFindings.length
            ? `${secretFindings.length} evidence source${secretFindings.length === 1 ? "" : "s"} match high-confidence credential patterns.`
            : "No high-confidence credential patterns were found in packaged evidence.",
    });
    if (files) {
        const expectedFiles = [
            ...requiredPackageFiles,
            ...(sourcePlans.length ? ["validation/source-plans.json", "validation/source-plans.md"] : []),
            ...roleArtifactSlugs(organization.roles).map((slug) => `roles/${slug}/SKILL.md`),
        ];
        const missingFiles = expectedFiles.filter((path) => typeof files[path] !== "string" || !files[path].trim());
        add({
            id: "provider-artifacts",
            status: missingFiles.length ? "blocker" : "pass",
            title: "Claude and ChatGPT artifacts",
            detail: missingFiles.length ? `Missing artifacts: ${missingFiles.join(", ")}.` : "Required Claude and ChatGPT instructions, knowledge, reviewed upload manifests, and install guides are present.",
        });
        let generatedInventoryValid = false;
        try {
            const parsed = JSON.parse(files["validation/generated-files.json"] ?? "");
            const inventory = Array.isArray(parsed.files) ? parsed.files : [];
            const actualManagedPaths = Object.keys(files).filter(isGeneratedPackagePath).sort();
            const sortedInventory = inventory.every((path) => typeof path === "string")
                ? [...inventory].sort()
                : [];
            generatedInventoryValid = parsed.schemaVersion === "1.0"
                && inventory.length > 0
                && inventory.every((path) => typeof path === "string" && isGeneratedPackagePath(path))
                && new Set(inventory).size === inventory.length
                && expectedFiles.every((path) => inventory.includes(path))
                && JSON.stringify(sortedInventory) === JSON.stringify(actualManagedPaths);
        }
        catch {
            generatedInventoryValid = false;
        }
        add({
            id: "generated-file-inventory",
            status: generatedInventoryValid ? "pass" : "blocker",
            title: "Generated package file inventory",
            detail: generatedInventoryValid
                ? "Every required generated artifact is listed in a traversal-safe managed namespace."
                : "The generated-file inventory is missing, unsafe, duplicated, or incomplete.",
        });
        let reviewArtifactValid = false;
        try {
            const content = files["review/organization.review.json"] ?? "";
            const parsed = JSON.parse(content);
            reviewArtifactValid = parsed.schemaVersion === "1.0"
                && parsed.organization?.name === organization.name
                && (organization.review
                    ? parsed.reviewedBy === organization.review.reviewedBy
                        && parsed.reviewedAt === organization.review.reviewedAt
                        && recognizedFingerprint(organization.review.sourceHash)
                        && evidenceHash(content) === organization.review.sourceHash
                    : parsed.reviewedBy === "" && parsed.reviewedAt === "");
        }
        catch {
            reviewArtifactValid = false;
        }
        add({
            id: "review-artifact-integrity",
            status: reviewArtifactValid ? "pass" : "blocker",
            title: "Canonical review artifact integrity",
            detail: reviewArtifactValid
                ? organization.review
                    ? "The packaged canonical review matches the SHA-256 attestation used by every reviewed role and decision."
                    : "The editable draft review matches the organization awaiting confirmation."
                : "review/organization.review.json is missing, invalid, or does not match the organization review attestation.",
        });
        let sourcePlanArtifactValid = !sourcePlans.length;
        if (sourcePlans.length) {
            try {
                const parsed = JSON.parse(files["validation/source-plans.json"] ?? "");
                sourcePlanArtifactValid = JSON.stringify(parsed) === JSON.stringify(sourcePlans)
                    && Boolean(files["validation/source-plans.md"]?.trim());
            }
            catch {
                sourcePlanArtifactValid = false;
            }
        }
        add({
            id: "source-refresh-artifact",
            status: sourcePlanArtifactValid ? "pass" : "blocker",
            title: "Source refresh artifact integrity",
            detail: sourcePlanArtifactValid
                ? sourcePlans.length ? "The packaged source replay plans match the organization graph." : "This package has no source replay plans to verify."
                : "The packaged source replay plans are missing, invalid, or disagree with the organization graph.",
        });
        let ingestionArtifactValid = false;
        try {
            const parsed = JSON.parse(files["validation/source-ingestion.json"] ?? "");
            const counts = parsed.counts;
            const warnings = parsed.warnings;
            ingestionArtifactValid = parsed.schemaVersion === "1.0"
                && (parsed.status === "complete" || parsed.status === "complete-with-warnings")
                && typeof parsed.recordedAt === "string"
                && Boolean(parsed.recordedAt)
                && Number.isInteger(parsed.sourceCount)
                && Number(parsed.sourceCount) >= 0
                && Number.isInteger(parsed.totalBytes)
                && Number(parsed.totalBytes) >= 0
                && Number.isInteger(parsed.durationMs)
                && Number(parsed.durationMs) >= 0
                && Boolean(counts)
                && Number.isInteger(counts?.document)
                && Number(counts?.document) >= 0
                && Number.isInteger(counts?.codebase)
                && Number(counts?.codebase) >= 0
                && Number.isInteger(counts?.database)
                && Number(counts?.database) >= 0
                && Array.isArray(warnings)
                && parsed.sourceCount === Number(counts?.document) + Number(counts?.codebase) + Number(counts?.database)
                && parsed.status === (warnings.length ? "complete-with-warnings" : "complete");
            if (ingestionArtifactValid && organization.ingestion) {
                ingestionArtifactValid = parsed.status === organization.ingestion.status
                    && parsed.recordedAt === organization.ingestion.recordedAt
                    && parsed.sourceCount === organization.ingestion.sourceCount
                    && parsed.totalBytes === organization.ingestion.totalBytes
                    && parsed.durationMs === organization.ingestion.durationMs
                    && counts?.document === organization.ingestion.counts.document
                    && counts?.codebase === organization.ingestion.counts.codebase
                    && counts?.database === organization.ingestion.counts.database
                    && JSON.stringify(warnings) === JSON.stringify(organization.ingestion.warnings);
            }
        }
        catch {
            ingestionArtifactValid = false;
        }
        add({
            id: "source-ingestion-artifact",
            status: ingestionArtifactValid ? "pass" : "blocker",
            title: "Source ingestion artifact integrity",
            detail: ingestionArtifactValid
                ? "The machine-readable source-ingestion report matches the organization graph."
                : "validation/source-ingestion.json is missing, invalid, or does not match graph.json.",
        });
        let providerManifestValid = false;
        let providerHandoffValid = false;
        let providerCapacityValid = false;
        const missingRoleTitles = [];
        const missingEvidenceIds = [];
        try {
            const parsed = JSON.parse(files["validation/provider-knowledge.json"] ?? "");
            let manifestsValid = parsed.schemaVersion === "1.0";
            let handoffsValid = parsed.schemaVersion === "1.0";
            let capacitiesValid = true;
            for (const provider of ["chatgpt", "claude"]) {
                const label = provider === "chatgpt" ? "ChatGPT" : "Claude";
                const limits = providerKnowledgeLimits[provider];
                const manifest = parsed.providers?.[provider];
                const records = Array.isArray(manifest?.files) ? manifest.files : [];
                const expectedPaths = Object.keys(files)
                    .filter((path) => new RegExp(`^providers/${provider}/KNOWLEDGE(?:-\\d{3})?\\.md$`).test(path))
                    .sort((left, right) => {
                    const leftPrimary = left.endsWith("/KNOWLEDGE.md");
                    const rightPrimary = right.endsWith("/KNOWLEDGE.md");
                    return leftPrimary === rightPrimary ? left.localeCompare(right) : leftPrimary ? -1 : 1;
                });
                const manifestPaths = records.map((record) => typeof record.path === "string" ? record.path : "");
                const expectedHandoffPaths = providerHandoffArtifactPaths(provider);
                const handoffRecords = Array.isArray(manifest?.handoffFiles)
                    ? manifest.handoffFiles
                    : [];
                const handoffPaths = handoffRecords.map((record) => typeof record.path === "string" ? record.path : "");
                const maxBytes = typeof manifest?.maxBytesPerKnowledgeFile === "number" ? manifest.maxBytesPerKnowledgeFile : 0;
                const manifestRoleIds = Array.isArray(manifest?.roleIds) ? manifest.roleIds : [];
                const manifestEvidenceIds = Array.isArray(manifest?.evidenceIds) ? manifest.evidenceIds : [];
                manifestsValid = manifestsValid
                    && maxBytes === limits.maxBytesPerFile
                    && manifest?.reservedProjectFiles === limits.reservedProjectFiles
                    && JSON.stringify(manifestPaths) === JSON.stringify(expectedPaths)
                    && JSON.stringify(manifestRoleIds) === JSON.stringify(organization.roles.map((role) => role.id))
                    && JSON.stringify(manifestEvidenceIds) === JSON.stringify(organization.evidence.map((evidence) => evidence.id))
                    && records.every((record) => {
                        if (typeof record.path !== "string" || typeof record.bytes !== "number" || typeof record.sha256 !== "string")
                            return false;
                        const content = files[record.path];
                        return typeof content === "string"
                            && new TextEncoder().encode(content).length === record.bytes
                            && record.bytes <= maxBytes
                            && evidenceHash(content) === record.sha256;
                    });
                handoffsValid = handoffsValid
                    && JSON.stringify(handoffPaths) === JSON.stringify(expectedHandoffPaths)
                    && handoffRecords.every((record) => {
                        if (typeof record.path !== "string" || typeof record.bytes !== "number" || typeof record.sha256 !== "string")
                            return false;
                        const content = files[record.path];
                        return typeof content === "string"
                            && new TextEncoder().encode(content).length === record.bytes
                            && evidenceHash(content) === record.sha256;
                    });
                const combinedKnowledge = expectedPaths.map((path) => files[path]).join("\n");
                const roleRecords = new Map(Array.from(combinedKnowledge.matchAll(/^## (.+)\n- Role id: (.+)$/gm), (match) => [match[2].trim(), match[1].trim()]));
                const evidenceRecords = new Set(Array.from(combinedKnowledge.matchAll(/^- Evidence id: (.+)$/gm), (match) => match[1].trim()));
                organization.roles.forEach((role) => {
                    if (roleRecords.get(role.id) !== role.title)
                        missingRoleTitles.push(`${label}: ${role.title}`);
                });
                organization.evidence.forEach((evidence) => {
                    if (!evidenceRecords.has(evidence.id))
                        missingEvidenceIds.push(`${label}: ${evidence.id}`);
                });
                const reservedFiles = limits.reservedProjectFiles;
                const projectFileCount = typeof manifest?.projectFileCount === "number" ? manifest.projectFileCount : -1;
                const maxProjectFiles = typeof manifest?.maxProjectFiles === "number" ? manifest.maxProjectFiles : -1;
                capacitiesValid = capacitiesValid
                    && projectFileCount === expectedPaths.length + reservedFiles
                    && manifest?.capacity === "within-current-limits";
                if (provider === "chatgpt") {
                    capacitiesValid = capacitiesValid
                        && maxProjectFiles === providerKnowledgeLimits.chatgpt.maxProjectFiles
                        && projectFileCount <= maxProjectFiles;
                }
            }
            providerManifestValid = manifestsValid && !missingRoleTitles.length && !missingEvidenceIds.length;
            providerHandoffValid = handoffsValid;
            providerCapacityValid = capacitiesValid;
        }
        catch {
            providerManifestValid = false;
            providerHandoffValid = false;
            providerCapacityValid = false;
        }
        add({
            id: "provider-knowledge-integrity",
            status: providerManifestValid ? "pass" : "blocker",
            title: "Provider knowledge completeness and integrity",
            detail: providerManifestValid
                ? "Every bounded Claude and ChatGPT knowledge part matches its SHA-256 manifest and covers every canonical role and evidence source."
                : "Provider knowledge parts, hashes, byte sizes, or role/evidence coverage do not match validation/provider-knowledge.json.",
        });
        add({
            id: "provider-handoff-integrity",
            status: providerHandoffValid ? "pass" : "blocker",
            title: "Provider handoff artifact integrity",
            detail: providerHandoffValid
                ? "Every instruction, upload manifest, install guide, organization summary, gaps report, and behavioral test matches its SHA-256 handoff record."
                : "A provider-facing instruction, upload file, manifest, guide, or behavioral test is missing or does not match validation/provider-knowledge.json.",
        });
        add({
            id: "provider-knowledge-capacity",
            status: providerCapacityValid ? "pass" : "blocker",
            title: "Provider project file capacity",
            detail: providerCapacityValid
                ? "The generated upload manifests fit DeltaDotta's current documented Claude and ChatGPT Project file bounds."
                : "The generated knowledge parts exceed current provider project file bounds or the capacity manifest is invalid.",
        });
        add({
            id: "provider-role-fidelity",
            status: missingRoleTitles.length || missingEvidenceIds.length ? "blocker" : "pass",
            title: "Provider role fidelity",
            detail: missingRoleTitles.length || missingEvidenceIds.length
                ? `Provider knowledge coverage is incomplete: ${[...missingRoleTitles, ...missingEvidenceIds].join(", ")}.`
                : "Every canonical role and evidence source appears in both provider knowledge bundles.",
        });
    }
    const blockers = checks.filter((check) => check.status === "blocker").length;
    const warnings = checks.filter((check) => check.status === "warning").length;
    const earned = checks.reduce((score, check) => score + (check.status === "pass" ? 1 : check.status === "warning" ? 0.5 : 0), 0);
    return {
        schemaVersion: "1.0",
        organization: organization.name,
        provider: organization.launch?.provider ?? "provider-neutral",
        status: blockers ? "needs-review" : "ready",
        score: checks.length ? Math.round((earned / checks.length) * 100) : 0,
        blockers,
        warnings,
        checks,
    };
}
export function readinessMarkdown(report) {
    const checks = report.checks
        .map((check) => `- ${check.status === "pass" ? "PASS" : check.status === "warning" ? "WARNING" : "BLOCKER"} — **${check.title}**: ${check.detail}`)
        .join("\n");
    return `# Organization readiness report\n\n- Organization: ${report.organization}\n- Provider target: ${report.provider}\n- Status: ${report.status}\n- Readiness score: ${report.score}/100\n- Blockers: ${report.blockers}\n- Warnings: ${report.warnings}\n\nA package is ready only when every blocker is resolved. Warnings are explicit review items, not silent assumptions.\n\n## Checks\n\n${checks}\n`;
}
