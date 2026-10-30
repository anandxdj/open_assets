from pydantic import BaseModel, Field, HttpUrl
from typing import Literal, Optional


class DetectRequest(BaseModel):
    image_url: HttpUrl
    mode: Literal["auto", "light", "dark", "sampled"] = "auto"
    background_color: Optional[str] = None
    # 1-100, 50 = the built-in cut-off. Higher ignores fainter pixels, lower
    # picks up more. Gated to Pro by the Node API; defaults keep old behaviour.
    threshold: int = Field(default=50, ge=1, le=100)


class DetectedBox(BaseModel):
    id: str
    x: int
    y: int
    width: int
    height: int
    name: str           # e.g. "asset_001"


class DetectResponse(BaseModel):
    boxes: list[DetectedBox]
    image_width: int
    image_height: int
    detection_mode: str = "auto"
    detection_confidence: float = 0.0
    detection_warning: Optional[str] = None


class TransparencyResponse(BaseModel):
    transparent: bool
    image_width: int
    image_height: int


class BoxInput(BaseModel):
    id: str
    x: int
    y: int
    width: int
    height: int
    name: str           # systematic name (asset_001) — used as the label drawn for Gemini


class NameAssetsRequest(BaseModel):
    image_url: HttpUrl
    boxes: list[BoxInput]


class NamedAsset(BaseModel):
    systematic: str
    name: str
    folder: Optional[str] = None
    tags: list[str] = []
    description: Optional[str] = None
    dominant_colors: list[str] = []


class FolderSuggestion(BaseModel):
    name: str
    tags: list[str] = []


class CollectionSuggestion(BaseModel):
    name: Optional[str] = None
    tags: list[str] = []


class NameAssetsResponse(BaseModel):
    names: dict[str, str]                       # { "asset_001": "fire_sword", ... }
    collection: Optional[CollectionSuggestion] = None
    folders: list[FolderSuggestion] = []
    assets: list[NamedAsset] = []


class CropRequest(BaseModel):
    image_url: HttpUrl
    boxes: list[BoxInput]   # names already resolved to final asset names
    job_id: str
    # False (default): upload each crop to Cloudinary and return its URL.
    # True: touch no storage and return each crop as base64 PNG in `data_base64`;
    # the caller stores them (the local storage provider).
    inline: bool = False


class AssetResult(BaseModel):
    id: str
    name: str
    cropped_url: str = ""
    public_id: str = ""
    data_base64: Optional[str] = None   # only for `inline` crops


class CropResponse(BaseModel):
    assets: list[AssetResult]


class DetectUploadResponse(BaseModel):
    boxes: list[DetectedBox]
    image_width: int
    image_height: int
    asset_count: int
    detection_mode: str = "auto"
    detection_confidence: float = 0.0
    detection_warning: Optional[str] = None


class ExcaliburRecipe(BaseModel):
    schemaVersion: Literal[1]
    engine: Literal["openassets-excalibur"]
    engineVersion: Literal["2"]
    sourceSha256: str
    sourceKind: Literal["raster", "svg"] = "raster"
    cleanup: float = 2
    speckRemoval: float = 1
    contrast: float = 1
    background: Literal["transparent", "white", "dark"] = "transparent"
    scale: Literal[1, 2, 3] = 1
