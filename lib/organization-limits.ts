export const organizationStructureLimits = {
  roles: 10_000,
  evidence: 25_000,
  sourceConflicts: 50_000,
  sourcePlans: 50,
  ingestionWarnings: 50_000,
  itemsPerRoleField: 1_000,
  claimsPerConflict: 1_000,
  itemsPerSourcePlanField: 1_000,
  excludedPathsPerSourcePlan: 50,
} as const;

export function enforceStructureLimit(label: string, actual: number, maximum: number) {
  if (!Number.isSafeInteger(actual) || actual < 0 || actual > maximum) {
    throw new Error(`${label} contains ${actual} entries; the supported maximum is ${maximum}.`);
  }
}
