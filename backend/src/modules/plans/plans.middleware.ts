import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ApiError } from '../../common/utils/ApiError';
import type { AuthRequest } from '../auth/auth.middleware';
import { assertEntitled, getEntitlements } from './entitlements';
import { releaseSheet, reserveSheet } from './sheetUsage.service';
import type { SheetReservation } from './sheetUsage.service';
import type { EntitlementKey } from './plans.types';

/**
 * Route guard: 403 PLAN_REQUIRED unless the user's effective plan includes
 * `key`. Put it after authenticate().
 *
 *   router.post('/things', authenticate(), requireEntitlement('teamSharing'), handler)
 */
export function requireEntitlement(key: EntitlementKey): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const user = (req as AuthRequest).user;
    if (!user) return next(ApiError.unauthorized('Not authenticated'));
    try {
      assertEntitled(user, key);
      next();
    } catch (err) {
      next(err);
    }
  };
}

type SheetLocals = { sheetReservation?: SheetReservation & { committed: boolean } };

/**
 * Upload guard. Takes one sheet from the user's monthly allowance before
 * anything is stored (put it before the multer middleware so an over-limit
 * request never buffers its file), or answers 403 SHEET_LIMIT.
 *
 * The slot is given back when the request ends without the controller calling
 * commitSheetReservation(res): a rejected file, a storage failure, a dropped
 * connection. Pro users are counted too, without a limit.
 */
export const enforceSheetLimit: RequestHandler = (req, res, next) => {
  const user = (req as AuthRequest).user;
  if (!user) return next(ApiError.unauthorized('Not authenticated'));

  const limit = getEntitlements(user).sheetsPerMonth;
  reserveSheet(user.id, limit)
    .then((reservation) => {
      const slot = { ...reservation, committed: false };
      (res.locals as SheetLocals).sheetReservation = slot;
      res.once('close', () => {
        if (!slot.committed) {
          releaseSheet(slot).catch((err) => console.error('[plans] failed to release sheet slot:', err));
        }
      });
      next();
    })
    .catch(next);
};

/** Marks the reserved sheet as spent. Call once the job exists. */
export function commitSheetReservation(res: Response): void {
  const slot = (res.locals as SheetLocals).sheetReservation;
  if (slot) slot.committed = true;
}
