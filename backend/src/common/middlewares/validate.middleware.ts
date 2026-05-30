import type { Request, Response, NextFunction } from 'express';
import { ZodError, type ZodType } from 'zod';
import { ApiError } from '../utils/ApiError';

export const validate = (schema: ZodType) => {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsedValue = schema.parse(req.body);
      req.body = parsedValue; // Overwrite body with Zod's stripped/typed values
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const errorMessage = error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ');
        return next(ApiError.badRequest(errorMessage));
      }
      next(error);
    }
  };
};