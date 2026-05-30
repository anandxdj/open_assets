import cloudinary
import cloudinary.uploader
from fastapi import HTTPException
from app.core.config import settings

cloudinary.config(
    cloud_name=settings.CLOUDINARY_CLOUD_NAME,
    api_key=settings.CLOUDINARY_API_KEY,
    api_secret=settings.CLOUDINARY_API_SECRET,
)


def upload_bytes(data: bytes, folder: str, public_id: str) -> dict:
    """Upload raw bytes to Cloudinary. Returns the full upload result dict."""
    try:
        result = cloudinary.uploader.upload(
            data,
            folder=folder,
            public_id=public_id,
            resource_type="image",
            overwrite=True,
        )
    except Exception as e:
        raise HTTPException(
            status_code=502,
            detail=f"Cloudinary upload failed for '{public_id}': {e}",
        )
    return result
