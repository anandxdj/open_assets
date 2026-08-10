import numpy as np
import cv2
from fastapi import APIRouter, UploadFile, File, HTTPException
from app.models.schemas import DetectRequest, DetectResponse, TransparencyResponse, DetectUploadResponse
from app.services.detection import find_bounding_boxes, is_transparent
from app.services.image_io import download_image

router = APIRouter()


@router.post("/detect", response_model=DetectResponse)
async def detect_assets(request: DetectRequest) -> DetectResponse:
    img = await download_image(str(request.image_url))
    result = find_bounding_boxes(img, request.mode, request.background_color)
    return DetectResponse(**result)


@router.post("/detect-upload", response_model=DetectUploadResponse)
async def detect_assets_upload(file: UploadFile = File(...)) -> DetectUploadResponse:
    contents = await file.read()
    nparr = np.frombuffer(contents, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_UNCHANGED)
    if img is None:
        raise HTTPException(status_code=400, detail="Invalid image file")
    result = find_bounding_boxes(img)
    return DetectUploadResponse(**result, asset_count=len(result["boxes"]))


@router.post("/check-transparency", response_model=TransparencyResponse)
async def check_transparency(request: DetectRequest) -> TransparencyResponse:
    img = await download_image(str(request.image_url))
    h, w = img.shape[:2]
    return TransparencyResponse(transparent=is_transparent(img), image_width=w, image_height=h)
