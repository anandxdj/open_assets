import { ApiError } from './ApiError';

/**
 * Ownership guard (SECURITY #2 — IDOR).
 *
 * Throws `403 Forbidden` unless the authenticated requester owns the resource.
 * Use after loading any resource by a client-supplied id (jobs, collections,
 * folders, images) to stop cross-tenant reads/writes.
 *
 * Fails closed: a missing requester id or a missing/blank resource owner is
 * always treated as "not the owner".
 */
export function assertOwner(
  resourceUserId: string | undefined | null,
  requesterId: string | undefined | null,
  message = 'You do not have access to this resource',
): void {
  if (!requesterId || !resourceUserId || resourceUserId !== requesterId) {
    throw ApiError.forbidden(message);
  }
}
