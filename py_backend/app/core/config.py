from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    CLOUDINARY_CLOUD_NAME: str = ""
    CLOUDINARY_API_KEY: str = ""
    CLOUDINARY_API_SECRET: str = ""

    # Gemini (asset naming) — the fallback provider.
    GEMINI_API_KEY: str = ""
    GEMINI_MODEL: str = "gemini-flash-lite-latest"

    # Open Quota (asset naming) — primary provider, tried before Gemini. Empty
    # key means Gemini-only, i.e. unchanged behaviour. Note this is the /llm
    # root, not the /llm/v1 the frontend uses: the native Gemini surface we call
    # lives at <root>/v1beta/models/<model>:generateContent.
    OPENQUOTA_API_KEY: str = ""
    OPENQUOTA_BASE_URL: str = "https://openquota.anands.dev/llm"
    # Must not contain a ':' — it would collide with the ':generateContent'
    # method suffix, so the auto:<strategy> forms are unusable here.
    # Legacy unified setting. New deployments should set OPENQUOTA_VISION_MODEL.
    OPENQUOTA_MODEL: str = "auto"
    # Asset naming always includes an image, so it uses this vision profile.
    OPENQUOTA_VISION_MODEL: str = ""

    # SECURITY (#9): only fetch images from these hosts (comma-separated). Empty
    # disables host allowlisting (private-IP blocking still applies).
    ALLOWED_IMAGE_HOSTS: str = "res.cloudinary.com,cloudinary.com"

    # SECURITY (#10): shared secret the Node backend must send in X-Internal-Token.
    # Empty disables the check (e.g. local dev) — set it in production.
    INTERNAL_API_TOKEN: str = ""

    # OpenCV detection tuning
    MIN_BOX_WIDTH: int = 20
    MIN_BOX_HEIGHT: int = 20
    MIN_BOX_AREA: int = 400
    BINARY_THRESH_VALUE: int = 240

    # Transparency detection: image is "transparent" only if it has an alpha
    # channel AND at least this fraction of pixels are meaningfully transparent.
    TRANSPARENCY_ALPHA_THRESHOLD: int = 250
    TRANSPARENCY_MIN_FRACTION: float = 0.01

    class Config:
        env_file = ".env"


settings = Settings()
