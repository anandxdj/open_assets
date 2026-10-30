export class ApiError extends Error {
    public statusCode: number;
    /** Optional machine-readable reason so clients can branch without parsing `message`. */
    public code?: string;

    constructor(statusCode: number, message: string, code?: string) {
      super(message);
      this.statusCode = statusCode;
      this.code = code;
      Error.captureStackTrace(this, this.constructor);
    }

    static badRequest(message = "Bad request", code?: string) { return new ApiError(400, message, code); }


    static unauthorized(message = "Unauthorized") { return new ApiError(401, message); }


    static forbidden(message = "Forbidden") { return new ApiError(403, message); }


    static notFound(message = "Not found") { return new ApiError(404, message); }


    static conflict(message = "Conflict") { return new ApiError(409, message); }

    static payloadTooLarge(message = "Payload too large", code?: string) { return new ApiError(413, message, code); }

    static internal(message = "Internal server error") { return new ApiError(500, message); }

    static badGateway(message = "Bad gateway", code?: string) { return new ApiError(502, message, code); }

    static serviceUnavailable(message = "Service unavailable", code?: string) { return new ApiError(503, message, code); }
  }
