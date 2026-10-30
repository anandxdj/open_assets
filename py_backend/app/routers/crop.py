import base64

import cv2
from fastapi import APIRouter
from app.models.schemas import CropRequest, CropResponse, AssetResult
from app.services.image_io import download_image

router = APIRouter()


@router.post("/crop", response_model=CropResponse)
async def crop(request: CropRequest) -> CropResponse:
    img = await download_image(str(request.image_url))
    img_h, img_w = img.shape[:2]

    assets: list[AssetResult] = []
    for box in request.boxes:
        x = max(0, box.x)
        y = max(0, box.y)
        x2 = min(img_w, box.x + box.width)
        y2 = min(img_h, box.y + box.height)
        if x2 <= x or y2 <= y:
            continue

        cropped = img[y:y2, x:x2]
        _, buf = cv2.imencode(".png", cropped)

        if request.inline:
            # No storage here: the caller (local storage provider) keeps the bytes.
            assets.append(AssetResult(
                id=box.id,
                name=box.name,
                data_base64=base64.b64encode(buf.tobytes()).decode("ascii"),
            ))
            continue

        # Imported here so inline crops work without Cloudinary configured or installed.
        from app.services.cloudinary_client import upload_bytes

        result = upload_bytes(
            data=buf.tobytes(),
            folder=f"open_assets/crops/{request.job_id}",
            public_id=box.name,
        )

        assets.append(AssetResult(
            id=box.id,
            name=box.name,
            cropped_url=result["secure_url"],
            public_id=result["public_id"],
        ))

    return CropResponse(assets=assets)
