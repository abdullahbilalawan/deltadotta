import type { Organization, Role, SourceConflictField } from "./organization.js";
import { canonicalRoleKey, portableIdentifier, roleArtifactSlugs } from "./identifiers.js";
import { evidenceHash } from "./fingerprints.js";
import { enforceStructureLimit, organizationStructureLimits } from "./organization-limits.js";

export type OrganizationReviewTemplate = {
  schemaVersion: "1.0";
  instructions: string[];
  reviewedBy: string;
  reviewedAt: string;
  organization: {
    name: string;
    mission: string;
    roles: Array<{
      id: string;
      title: string;
      department: string;
      reportsTo: string | null;
      purpose: string;
      owns: string[];
      inputs: string[];
      outputs: string[];
      permissions: string[];
      collaborators: string[];
      escalatesTo: string | null;
      evidence: string[];
      confirmed: boolean;
    }>;
    sourceConflicts: Array<{
      id: string;
      roleTitle: string;
      field: SourceConflictField;
      claims: Array<{
        value: string;
        evidence: string[];
      }>;
      resolution: string;
      resolved: boolean;
    }>;
    ingestionWarnings: Array<{
      id: string;
      path: string;
      reason: string;
      acknowledged: boolean;
    }>;
  };
};

type ReviewedRoleInput = OrganizationReviewTemplate["organization"]["roles"][number];
type ReviewedConflictInput = OrganizationReviewTemplate["organization"]["sourceConflicts"][number];
type ReviewedWarningInput = OrganizationReviewTemplate["organization"]["ingestionWarnings"][number];

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requiredString(source: Record<string, unknown>, field: string, label: string) {
  const value = source[field];
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label}.${field} must be a non-empty string`);
  return value.trim();
}

function requiredStringList(source: Record<string, unknown>, field: string, label: string) {
  const value = source[field];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${label}.${field} must be an array of strings`);
  }
  enforceStructureLimit(`${label}.${field}`, value.length, organizationStructureLimits.itemsPerRoleField);
  return Array.from(new Set(value.map((item) => String(item).trim()).filter(Boolean)));
}

function requiredReference(source: Record<string, unknown>, field: string, label: string) {
  if (!Object.prototype.hasOwnProperty.call(source, field)) {
    throw new Error(`${label}.${field} must be present and contain a role title/id or null`);
  }
  const value = source[field];
  if (value === null) return null;
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label}.${field} must contain a role title/id or null`);
  return value.trim();
}

function normalizedId(value: string) {
  return portableIdentifier(value, "role");
}

function parseReview(value: unknown) {
  const root = record(value, "review");
  if (root.schemaVersion !== "1.0") throw new Error("review.schemaVersion must be \"1.0\"");
  const reviewedBy = requiredString(root, "reviewedBy", "review");
  const reviewedAt = requiredString(root, "reviewedAt", "review");
  if (!Number.isFinite(Date.parse(reviewedAt))) throw new Error("review.reviewedAt must be an ISO-8601 date or timestamp");
  const organization = record(root.organization, "review.organization");
  const name = requiredString(organization, "name", "review.organization");
  const mission = requiredString(organization, "mission", "review.organization");
  if (!Array.isArray(organization.roles) || !organization.roles.length) {
    throw new Error("review.organization.roles must contain at least one role");
  }
  enforceStructureLimit("review.organization.roles", organization.roles.length, organizationStructureLimits.roles);
  const roles = organization.roles.map((value, index): ReviewedRoleInput => {
    const label = `review.organization.roles[${index}]`;
    const role = record(value, label);
    if (typeof role.confirmed !== "boolean") throw new Error(`${label}.confirmed must be true or false`);
    return {
      id: typeof role.id === "string" && role.id.trim() ? normalizedId(role.id) : "",
      title: requiredString(role, "title", label),
      department: requiredString(role, "department", label),
      reportsTo: requiredReference(role, "reportsTo", label),
      purpose: requiredString(role, "purpose", label),
      owns: requiredStringList(role, "owns", label),
      inputs: requiredStringList(role, "inputs", label),
      outputs: requiredStringList(role, "outputs", label),
      permissions: requiredStringList(role, "permissions", label),
      collaborators: requiredStringList(role, "collaborators", label),
      escalatesTo: requiredReference(role, "escalatesTo", label),
      evidence: requiredStringList(role, "evidence", label),
      confirmed: role.confirmed,
    };
  });
  const missingRoleIds = roleArtifactSlugs(roles.map((role, index) => ({
    id: role.id || `review-role-${index}`,
    title: role.title,
  })));
  roles.forEach((role, index) => {
    if (!role.id) role.id = missingRoleIds[index];
  });
  const sourceConflicts = (organization.sourceConflicts === undefined ? [] : organization.sourceConflicts);
  if (!Array.isArray(sourceConflicts)) throw new Error("review.organization.sourceConflicts must be an array");
  enforceStructureLimit("review.organization.sourceConflicts", sourceConflicts.length, organizationStructureLimits.sourceConflicts);
  const conflictIds = new Set<string>();
  const conflicts = sourceConflicts.map((value, index): ReviewedConflictInput => {
    const label = `review.organization.sourceConflicts[${index}]`;
    const conflict = record(value, label);
    const id = requiredString(conflict, "id", label);
    if (conflictIds.has(id)) throw new Error(`duplicate reviewed source conflict id: ${id}`);
    conflictIds.add(id);
    const field = conflict.field;
    if (field !== "department" && field !== "reportsTo" && field !== "authority") throw new Error(`${label}.field must be department, reportsTo, or authority`);
    if (!Array.isArray(conflict.claims) || conflict.claims.length < 2) throw new Error(`${label}.claims must contain at least two claims`);
    enforceStructureLimit(`${label}.claims`, conflict.claims.length, organizationStructureLimits.claimsPerConflict);
    const claims = conflict.claims.map((value, claimIndex) => {
      const claimLabel = `${label}.claims[${claimIndex}]`;
      const claim = record(value, claimLabel);
      return {
        value: requiredString(claim, "value", claimLabel),
        evidence: requiredStringList(claim, "evidence", claimLabel),
      };
    });
    if (typeof conflict.resolution !== "string") throw new Error(`${label}.resolution must be a string`);
    if (typeof conflict.resolved !== "boolean") throw new Error(`${label}.resolved must be true or false`);
    return {
      id,
      roleTitle: requiredString(conflict, "roleTitle", label),
      field,
      claims,
      resolution: conflict.resolution.trim(),
      resolved: conflict.resolved,
    };
  });
  const ingestionWarnings = organization.ingestionWarnings === undefined ? [] : organization.ingestionWarnings;
  if (!Array.isArray(ingestionWarnings)) throw new Error("review.organization.ingestionWarnings must be an array");
  enforceStructureLimit("review.organization.ingestionWarnings", ingestionWarnings.length, organizationStructureLimits.ingestionWarnings);
  const warningIds = new Set<string>();
  const warnings = ingestionWarnings.map((value, index): ReviewedWarningInput => {
    const label = `review.organization.ingestionWarnings[${index}]`;
    const warning = record(value, label);
    const id = requiredString(warning, "id", label);
    if (warningIds.has(id)) throw new Error(`duplicate reviewed ingestion warning id: ${id}`);
    warningIds.add(id);
    if (typeof warning.acknowledged !== "boolean") throw new Error(`${label}.acknowledged must be true or false`);
    return {
      id,
      path: requiredString(warning, "path", label),
      reason: requiredString(warning, "reason", label),
      acknowledged: warning.acknowledged,
    };
  });
  return { reviewedBy, reviewedAt, name, mission, roles, conflicts, warnings };
}

export function createOrganizationReviewTemplate(organization: Organization): OrganizationReviewTemplate {
  const titleForRole = (id: string | undefined) => organization.roles.find((role) => role.id === id)?.title ?? null;
  return {
    schemaVersion: "1.0",
    instructions: [
      "Review every field against accountable human owners and the linked evidence.",
      "Read validation/source-ingestion.md and account for every retained truncation or skipped-path warning before confirming scope.",
      "Remove false-positive roles and add missing roles so this list is the canonical organization scope.",
      "Use a role title or id for reportsTo and escalatesTo; use null only for a true top-level role.",
      "Keep confirmed false until purpose, ownership, authority, reporting, escalation, handoffs, and evidence are accurate.",
      "For every source conflict, set resolution to the canonical reviewed department, reporting value, or one exact canonical permission, then set resolved to true. If the role is removed, use: Role removed from canonical scope.",
      "Set acknowledged to true for every ingestion warning only after confirming the canonical role scope accounts for the missing or bounded material.",
      "Fill reviewedBy and reviewedAt, then run deltadotta refine --package <folder> --review <this-file>.",
    ],
    reviewedBy: organization.review?.reviewedBy ?? "",
    reviewedAt: organization.review?.reviewedAt ?? "",
    organization: {
      name: organization.name,
      mission: organization.mission,
      roles: organization.roles.map((role) => ({
        id: role.id,
        title: role.title,
        department: role.department,
        reportsTo: titleForRole(role.reportsTo),
        purpose: role.purpose,
        owns: role.owns,
        inputs: role.inputs,
        outputs: role.outputs,
        permissions: role.permissions,
        collaborators: role.collaborators,
        escalatesTo: titleForRole(role.escalatesTo),
        evidence: role.evidenceIds.map((id) => organization.evidence.find((item) => item.id === id)?.name ?? id),
        confirmed: role.status === "ready" && Boolean(role.review),
      })),
      sourceConflicts: (organization.sourceConflicts ?? []).map((conflict) => ({
        id: conflict.id,
        roleTitle: conflict.roleTitle,
        field: conflict.field,
        claims: conflict.claims.map((claim) => ({
          value: claim.value,
          evidence: claim.evidenceIds.map((id) => organization.evidence.find((item) => item.id === id)?.name ?? id),
        })),
        resolution: conflict.resolution?.value ?? "",
        resolved: Boolean(conflict.resolution),
      })),
      ingestionWarnings: (organization.ingestion?.warnings ?? []).map((warning) => ({
        id: warning.id,
        path: warning.path,
        reason: warning.reason,
        acknowledged: Boolean(warning.acknowledgement),
      })),
    },
  };
}

export function applyOrganizationReview(
  base: Organization,
  value: unknown,
  options: { sourceHash?: string } = {},
): Organization {
  const review = parseReview(value);
  const ids = new Set<string>();
  const titles = new Set<string>();
  review.roles.forEach((role, index) => {
    if (!role.id) throw new Error(`review.organization.roles[${index}].id could not be derived`);
    if (ids.has(role.id)) throw new Error(`duplicate reviewed role id: ${role.id}`);
    const normalizedTitle = canonicalRoleKey(role.title);
    if (titles.has(normalizedTitle)) throw new Error(`duplicate reviewed role title: ${role.title}`);
    ids.add(role.id);
    titles.add(normalizedTitle);
  });
  const idByReference = new Map<string, string>();
  review.roles.forEach((role) => {
    idByReference.set(role.id.toLowerCase(), role.id);
    idByReference.set(role.title.toLowerCase(), role.id);
    idByReference.set(canonicalRoleKey(role.title), role.id);
  });
  const evidenceByReference = new Map<string, string>();
  base.evidence.forEach((evidence) => {
    evidenceByReference.set(evidence.id.toLowerCase(), evidence.id);
    evidenceByReference.set(evidence.name.toLowerCase(), evidence.id);
  });
  const resolveRole = (reference: string | null, label: string) => {
    if (reference === null) return undefined;
    const id = idByReference.get(reference.toLowerCase()) ?? idByReference.get(canonicalRoleKey(reference));
    if (!id) throw new Error(`${label} references unknown role: ${reference}`);
    return id;
  };
  const roles: Role[] = review.roles.map((role, index) => {
    const evidenceIds = role.evidence.map((reference) => {
      const id = evidenceByReference.get(reference.toLowerCase());
      if (!id) throw new Error(`review.organization.roles[${index}].evidence references unknown source: ${reference}`);
      return id;
    });
    const reportsTo = resolveRole(role.reportsTo, `review.organization.roles[${index}].reportsTo`);
    const escalatesTo = resolveRole(role.escalatesTo, `review.organization.roles[${index}].escalatesTo`);
    if (reportsTo === role.id) throw new Error(`${role.title} cannot report to itself`);
    if (escalatesTo === role.id) throw new Error(`${role.title} cannot escalate to itself`);
    return {
      id: role.id,
      title: role.title,
      department: role.department,
      reportsTo,
      purpose: role.purpose,
      owns: role.owns,
      inputs: role.inputs,
      outputs: role.outputs,
      permissions: role.permissions,
      collaborators: role.collaborators,
      escalatesTo,
      evidenceIds,
      status: role.confirmed ? "ready" : "draft",
      launchStatus: "package-ready",
      review: role.confirmed ? {
        reviewedBy: review.reviewedBy,
        reviewedAt: review.reviewedAt,
        sourceHash: options.sourceHash,
      } : undefined,
    };
  });
  const baseConflicts = base.sourceConflicts ?? [];
  const baseConflictIds = new Set(baseConflicts.map((conflict) => conflict.id));
  const unknownConflictIds = review.conflicts.filter((conflict) => !baseConflictIds.has(conflict.id)).map((conflict) => conflict.id);
  if (unknownConflictIds.length) throw new Error(`review contains unknown source conflict ids: ${unknownConflictIds.join(", ")}`);
  const decisionByConflict = new Map(review.conflicts.map((conflict) => [conflict.id, conflict]));
  const sourceConflicts = baseConflicts.map((conflict) => {
    const decision = decisionByConflict.get(conflict.id);
    if (!decision?.resolved) return { ...conflict, resolution: undefined };
    if (!decision.resolution) throw new Error(`source conflict ${conflict.id} is marked resolved but has no resolution`);
    const reviewedRole = review.roles.find((role) => canonicalRoleKey(role.title) === canonicalRoleKey(conflict.roleTitle));
    const normalize = (input: string) => input.trim().toLowerCase().replace(/\s+/g, " ");
    let canonicalValue: string;
    if (!reviewedRole) {
      canonicalValue = "Role removed from canonical scope";
    } else if (conflict.field === "department") {
      canonicalValue = reviewedRole.department;
    } else if (conflict.field === "reportsTo") {
      canonicalValue = reviewedRole.reportsTo ?? "No direct manager";
    } else {
      const canonicalPermission = reviewedRole.permissions
        .find((permission) => normalize(permission) === normalize(decision.resolution));
      if (!canonicalPermission) {
        throw new Error(`source conflict ${conflict.id} resolution must match one exact canonical reviewed permission`);
      }
      canonicalValue = canonicalPermission;
    }
    if (normalize(decision.resolution) !== normalize(canonicalValue)) {
      throw new Error(`source conflict ${conflict.id} resolution must match the canonical reviewed value: ${canonicalValue}`);
    }
    return {
      ...conflict,
      resolution: {
        value: canonicalValue,
        reviewedBy: review.reviewedBy,
        reviewedAt: review.reviewedAt,
        sourceHash: options.sourceHash,
      },
    };
  });
  const baseWarnings = base.ingestion?.warnings ?? [];
  const baseWarningIds = new Set(baseWarnings.map((warning) => warning.id));
  const unknownWarningIds = review.warnings.filter((warning) => !baseWarningIds.has(warning.id)).map((warning) => warning.id);
  if (unknownWarningIds.length) throw new Error(`review contains unknown ingestion warning ids: ${unknownWarningIds.join(", ")}`);
  const decisionByWarning = new Map(review.warnings.map((warning) => [warning.id, warning]));
  const ingestion = base.ingestion ? {
    ...base.ingestion,
    warnings: baseWarnings.map((warning) => {
      const decision = decisionByWarning.get(warning.id);
      if (decision && (decision.path !== warning.path || decision.reason !== warning.reason)) {
        throw new Error(`ingestion warning ${warning.id} path or reason does not match the packaged source report`);
      }
      return {
        ...warning,
        acknowledgement: decision?.acknowledged ? {
          reviewedBy: review.reviewedBy,
          reviewedAt: review.reviewedAt,
          sourceHash: options.sourceHash,
        } : undefined,
      };
    }),
  } : undefined;
  const primaryRoleId = roles.find((role) => !role.reportsTo)?.id ?? roles[0].id;
  const reviewedOrganization: Organization = {
    ...base,
    name: review.name,
    mission: review.mission,
    version: base.version + 1,
    roles,
    sourceConflicts,
    ingestion,
    updatedAt: "Just now",
    review: {
      reviewedBy: review.reviewedBy,
      reviewedAt: review.reviewedAt,
      sourceHash: options.sourceHash,
    },
    launch: {
      template: base.launch?.template ?? "general",
      provider: base.launch?.provider ?? "chatgpt",
      status: "package-ready",
      startedAt: base.launch?.startedAt ?? "Just now",
      primaryRoleId,
    },
  };
  const canonicalReviewHash = evidenceHash(JSON.stringify(
    createOrganizationReviewTemplate(reviewedOrganization),
    null,
    2,
  ));
  return {
    ...reviewedOrganization,
    roles: reviewedOrganization.roles.map((role) => ({
      ...role,
      review: role.review ? { ...role.review, sourceHash: canonicalReviewHash } : undefined,
    })),
    sourceConflicts: reviewedOrganization.sourceConflicts?.map((conflict) => ({
      ...conflict,
      resolution: conflict.resolution
        ? { ...conflict.resolution, sourceHash: canonicalReviewHash }
        : undefined,
    })),
    ingestion: reviewedOrganization.ingestion
      ? {
        ...reviewedOrganization.ingestion,
        warnings: reviewedOrganization.ingestion.warnings.map((warning) => ({
          ...warning,
          acknowledgement: warning.acknowledgement
            ? { ...warning.acknowledgement, sourceHash: canonicalReviewHash }
            : undefined,
        })),
      }
      : undefined,
    review: reviewedOrganization.review
      ? { ...reviewedOrganization.review, sourceHash: canonicalReviewHash }
      : undefined,
  };
}
