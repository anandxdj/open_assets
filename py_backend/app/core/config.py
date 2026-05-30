from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    CLOUDINARY_CLOUD_NAME: str = ""
    CLOUDINARY_API_KEY: str = ""
    CLOUDINARY_API_SECRET: str = ""

    # Gemini (asset naming)
    GEMINI_API_KEY: str = ""
    GEMINI_MODEL: str = "gemini-flash-lite-latest"

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
