from fastapi import APIRouter
from app.models.schemas import NameAssetsRequest, NameAssetsResponse
from app.services.gemini import name_assets
from app.services.image_io import download_image

router = APIRouter()


@router.post("/name-assets", response_model=NameAssetsResponse)
async def name_assets_endpoint(request: NameAssetsRequest) -> NameAssetsResponse:
    img = await download_image(str(request.image_url))
    result = await name_assets(img, request.boxes)
    # `result` already matches the response shape (names + structured collection
    # data); Pydantic validates/coerces the nested models.
    return NameAssetsResponse(**result)
