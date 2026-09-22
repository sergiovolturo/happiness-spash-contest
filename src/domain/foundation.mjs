/**
 * Step 1 domain contracts. This module is deliberately independent from
 * Supabase, Storage, Auth UI, submissions and voting implementation.
 */

export const CONTEST_STATUSES = Object.freeze([
  'DRAFT',
  'SUBMISSIONS_OPEN',
  'SUBMISSIONS_CLOSED',
  'MODERATION',
  'READY_FOR_VOTING',
  'VOTING_OPEN',
  'VOTING_CLOSED',
  'CLOSED',
]);

export const PARTICIPATION_STATUSES = Object.freeze([
  'ACTIVE',
  'WITHDRAWN',
  'CANCELLED',
]);

const nonEmpty = (value) => typeof value === 'string' && value.trim().length > 0;
const validDate = (value) => value === undefined || value === null ||
  (typeof value === 'string' && Number.isFinite(Date.parse(value)));

/** @param {Record<string, unknown>} input */
export function validateContestFoundation(input) {
  const errors = [];
  if (!nonEmpty(input?.slug)) errors.push('slug is required');
  if (!nonEmpty(input?.name)) errors.push('name is required');
  if (input?.status !== undefined && !CONTEST_STATUSES.includes(input.status)) {
    errors.push('status is invalid');
  }
  if (input?.configuration !== undefined &&
      (typeof input.configuration !== 'object' || input.configuration === null || Array.isArray(input.configuration))) {
    errors.push('configuration must be a JSON object');
  }
  if (input?.configurationVersion !== undefined &&
      (!Number.isInteger(input.configurationVersion) || input.configurationVersion < 1)) {
    errors.push('configurationVersion must be a positive integer');
  }
  for (const field of ['submissionsOpenAt', 'submissionsCloseAt', 'votingOpenAt', 'votingCloseAt']) {
    if (!validDate(input?.[field])) errors.push(`${field} must be a valid ISO date`);
  }
  if (validDate(input?.submissionsOpenAt) && validDate(input?.submissionsCloseAt) &&
      input.submissionsOpenAt && input.submissionsCloseAt &&
      Date.parse(input.submissionsOpenAt) >= Date.parse(input.submissionsCloseAt)) {
    errors.push('submissionsOpenAt must precede submissionsCloseAt');
  }
  if (validDate(input?.votingOpenAt) && validDate(input?.votingCloseAt) &&
      input.votingOpenAt && input.votingCloseAt &&
      Date.parse(input.votingOpenAt) >= Date.parse(input.votingCloseAt)) {
    errors.push('votingOpenAt must precede votingCloseAt');
  }
  if (validDate(input?.submissionsCloseAt) && validDate(input?.votingOpenAt) &&
      input.submissionsCloseAt && input.votingOpenAt &&
      Date.parse(input.submissionsCloseAt) > Date.parse(input.votingOpenAt)) {
    errors.push('submissionsCloseAt must not follow votingOpenAt');
  }
  return errors;
}

/** @param {Record<string, unknown>} input */
export function validateCategoryFoundation(input) {
  const errors = [];
  if (!nonEmpty(input?.contestId)) errors.push('contestId is required');
  if (!nonEmpty(input?.name)) errors.push('name is required');
  if (!nonEmpty(input?.slug)) errors.push('slug is required');
  if (!Number.isInteger(input?.submissionCap) || input.submissionCap < 1) {
    errors.push('submissionCap must be a positive integer');
  }
  if (!Number.isInteger(input?.finalistsCount) || input.finalistsCount < 1) {
    errors.push('finalistsCount must be a positive integer');
  }
  return errors;
}

/** @param {Record<string, unknown>} row */
export function toContestDto(row) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description ?? null,
    status: row.status ?? 'DRAFT',
    configurationVersion: row.configuration_version ?? 1,
    configuration: row.configuration ?? {},
    submissionsOpenAt: row.submissions_open_at ?? null,
    submissionsCloseAt: row.submissions_close_at ?? null,
    votingOpenAt: row.voting_open_at ?? null,
    votingCloseAt: row.voting_close_at ?? null,
  };
}

/** @param {Record<string, unknown>} row */
export function toCategoryDto(row) {
  return {
    id: row.id,
    contestId: row.contest_id,
    name: row.name,
    slug: row.slug,
    displayOrder: row.display_order,
    submissionCap: row.submission_cap,
    finalistsCount: row.finalists_count ?? 4,
    isActive: row.is_active ?? true,
  };
}
