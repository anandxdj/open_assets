export class ApiError extends Error {
    public statusCode: number;
    /** Optional machine-readable code (e.g. PLAN_REQUIRED) clients can branch on. */
    public code?: string;
    /** Optional structured context returned next to the message. */
    public details?: Record<string, unknown>;

    constructor(statusCode: number, message: string, code?: string, details?: Record<string, unknown>) {
      super(message);
      this.statusCode = statusCode;
      if (code !== undefined) this.code = code;
      if (details !== undefined) this.details = details;
      Error.captureStackTrace(this, this.constructor);
    }

    static badRequest(message = "Bad request") { return new ApiError(400, message); }


    static unauthorized(message = "Unauthorized") { return new ApiError(401, message); }


    static forbidden(message = "Forbidden") { return new ApiError(403, message); }


    static notFound(message = "Not found") { return new ApiError(404, message); }


    static conflict(message = "Conflict") { return new ApiError(409, message); }

    static internal(message = "Internal server error") { return new ApiError(500, message); }
  }
