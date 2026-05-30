import logging
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from slowapi.util import get_remote_address
from app.core.config import settings
from app.routers import detect, name, crop

logger = logging.getLogger("open_assets")

app = FastAPI(title="open_assets AI Service")

# Paths reachable without the internal shared secret.
_OPEN_PATHS = {"/health", "/docs", "/openapi.json", "/redoc"}


@app.middleware("http")
async def require_internal_token(request: Request, call_next):
    """SECURITY (#10): only the Node backend may call this internal service.

    Enforced only when INTERNAL_API_TOKEN is configured, so local dev without the
    secret still works. Keep port 8000 off the public internet regardless.
    """
    token = settings.INTERNAL_API_TOKEN
    if token and request.url.path not in _OPEN_PATHS:
        if request.headers.get("x-internal-token") != token:
            return JSONResponse(status_code=401, content={"detail": "Unauthorized"})
    return await call_next(request)

# SECURITY (#5): defense-in-depth IP rate limit. The service is internal-only,
# so this is a backstop against a compromised/misbehaving caller, not the
# primary control (that's the private network placement — see #10).
limiter = Limiter(key_func=get_remote_address, default_limits=["120/minute"])
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)

app.include_router(detect.router)
app.include_router(name.router)
app.include_router(crop.router)


@app.get("/health")
def health():
    return {"status": "OK"}


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    """Return a generic JSON 500 for any unhandled exception.

    SECURITY (#3): the exception type/message is logged server-side only — never
    returned to the caller, which could leak internal paths, library internals,
    or secrets embedded in error strings. FastAPI's own HTTPException handler is
    untouched, so deliberate 4xx details (e.g. image-fetch 422) still surface.
    """
    logger.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error"},
    )
