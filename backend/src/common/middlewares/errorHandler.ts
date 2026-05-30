import type { Request, Response, NextFunction } from 'express';
import { ApiError } from '../utils/ApiError';

export const errorHandler = (err: any, req: Request, res: Response, next: NextFunction): void => {
  if (err instanceof ApiError) {
    res.status(err.statusCode).json({ success: false, message: err.message });
    return;
  }
  
  console.error(`[Unhandled Error]`, err);
  res.status(500).json({ 
    success: false, 
    message: 'Internal Server Error' 
  });
};