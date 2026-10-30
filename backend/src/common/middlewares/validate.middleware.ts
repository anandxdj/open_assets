import type { Request, Response, NextFunction } from 'express';
import { ZodError, type ZodType } from 'zod';
import { ApiError } from '../utils/ApiError';

function formatIssues(error: ZodError): string {
  return error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ');
}

export const validate = (schema: ZodType) => {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsedValue = schema.parse(req.body);
      req.body = parsedValue; // Overwrite body with Zod's stripped/typed values
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        return next(ApiError.badRequest(formatIssues(error)));
      }
      next(error);
    }
  };
};

/** Same as `validate`, for the query string (pagination, filters). */
export const validateQuery = (schema: ZodType) => {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      req.query = schema.parse(req.query) as Request['query']; // coerced + defaulted values
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        return next(ApiError.badRequest(formatIssues(error)));
      }
      next(error);
    }
  };
};
