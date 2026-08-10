import cv2
import numpy as np
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import Response

from app.models.schemas import ExcaliburRecipe

router = APIRouter()


def _remove_small_components(mask: np.ndarray, threshold: int) -> np.ndarray:
    if threshold <= 0:
        return mask
    labels_count, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    cleaned = np.zeros_like(mask)
    for label in range(1, labels_count):
        if stats[label, cv2.CC_STAT_AREA] >= threshold:
            cleaned[labels == label] = 255
    return cleaned


def _stroke_clarity(bgr: np.ndarray, alpha: np.ndarray, clarity: float, speck_removal: float) -> np.ndarray:
    """Sharpen only thin text/line structures while preserving the background.

    Diagram backgrounds are often textured or softly shaded. A global bilateral
    filter makes labels softer, and a global sharpen makes the background noisy.
    This derives a conservative mask from local detail, morphology, and edges,
    then applies a luminance-only unsharp pass inside that mask.
    """
    if clarity <= 0:
        return bgr

    lab = cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB)
    luminance = lab[:, :, 0]
    sigma = 0.7 + (clarity / 10.0) * 1.3
    local_base = cv2.GaussianBlur(luminance, (0, 0), sigma)
    detail = cv2.absdiff(luminance, local_base)

    kernel_size = 3 if clarity < 6 else 5
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (kernel_size, kernel_size))
    bright_strokes = cv2.morphologyEx(luminance, cv2.MORPH_TOPHAT, kernel)
    dark_strokes = cv2.morphologyEx(luminance, cv2.MORPH_BLACKHAT, kernel)
    gradient_x = cv2.Scharr(luminance, cv2.CV_32F, 1, 0)
    gradient_y = cv2.Scharr(luminance, cv2.CV_32F, 0, 1)
    gradient = cv2.convertScaleAbs(cv2.magnitude(gradient_x, gradient_y), alpha=0.22)
    structure = np.maximum.reduce([detail, bright_strokes, dark_strokes, gradient])

    median = float(np.median(structure))
    mad = float(np.median(np.abs(structure.astype(np.float32) - median)))
    # High clarity admits weaker antialiased strokes; low clarity is deliberately
    # conservative so an already-sharp diagram remains unchanged.
    threshold = max(8.0, median + (4.8 - clarity * 0.28) * max(mad, 2.0))
    mask = np.where(structure >= threshold, 255, 0).astype(np.uint8)
    if np.any(alpha < 255):
        mask = cv2.bitwise_and(mask, np.where(alpha > 4, 255, 0).astype(np.uint8))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8), iterations=1)
    mask = _remove_small_components(mask, int(round(speck_removal * 2)))
    soft_mask = cv2.GaussianBlur(mask, (0, 0), 0.85).astype(np.float32) / 255.0

    signed_detail = luminance.astype(np.float32) - local_base.astype(np.float32)
    noise_floor = 1.5 + (10.0 - clarity) * 0.22
    signed_detail = np.sign(signed_detail) * np.maximum(np.abs(signed_detail) - noise_floor, 0.0)
    gain = 0.65 + clarity * 0.12
    sharpened = np.clip(luminance.astype(np.float32) + signed_detail * gain, 0, 255)
    enhanced_luminance = luminance.astype(np.float32) * (1.0 - soft_mask) + sharpened * soft_mask
    lab[:, :, 0] = enhanced_luminance.astype(np.uint8)
    return cv2.cvtColor(lab, cv2.COLOR_LAB2BGR)


@router.post("/enhance/excalibur", response_class=Response)
async def excalibur_enhance(image: UploadFile = File(...), recipe: str = Form(...)) -> Response:
    try:
        parsed_recipe = ExcaliburRecipe.model_validate_json(recipe)
    except ValueError as error:
        raise HTTPException(status_code=422, detail="Invalid enhancement recipe") from error

    contents = await image.read()
    source = cv2.imdecode(np.frombuffer(contents, np.uint8), cv2.IMREAD_UNCHANGED)
    if source is None:
        raise HTTPException(status_code=422, detail="Could not decode image")
    height, width = source.shape[:2]
    if width < 1 or height < 1 or width > 12000 or height > 12000:
        raise HTTPException(status_code=422, detail="Unsupported image dimensions")

    image = source
    recipe = parsed_recipe
    if image.ndim == 2:
        image = cv2.cvtColor(image, cv2.COLOR_GRAY2BGRA)
    elif image.shape[2] == 3:
        image = cv2.cvtColor(image, cv2.COLOR_BGR2BGRA)

    bgr = image[:, :, :3]
    alpha = image[:, :, 3]
    if recipe.scale > 1:
        bgr = cv2.resize(bgr, None, fx=recipe.scale, fy=recipe.scale, interpolation=cv2.INTER_LANCZOS4)
        alpha = cv2.resize(alpha, None, fx=recipe.scale, fy=recipe.scale, interpolation=cv2.INTER_LANCZOS4)
    bgr = _stroke_clarity(bgr, alpha, recipe.cleanup, recipe.speckRemoval)
    if recipe.contrast != 1:
        bgr = cv2.convertScaleAbs(bgr, alpha=recipe.contrast, beta=0)

    result = cv2.merge([bgr[:, :, 0], bgr[:, :, 1], bgr[:, :, 2], alpha])
    if recipe.background == "white":
        canvas = np.full_like(result[:, :, :3], 255)
        mask = alpha.astype(np.float32)[:, :, None] / 255.0
        result = cv2.cvtColor((bgr * mask + canvas * (1 - mask)).astype(np.uint8), cv2.COLOR_BGR2BGRA)
        result[:, :, 3] = 255
    elif recipe.background == "dark":
        canvas = np.full_like(result[:, :, :3], 24)
        mask = alpha.astype(np.float32)[:, :, None] / 255.0
        result = cv2.cvtColor((bgr * mask + canvas * (1 - mask)).astype(np.uint8), cv2.COLOR_BGR2BGRA)
        result[:, :, 3] = 255
    ok, encoded = cv2.imencode(".png", result)
    if not ok:
        raise RuntimeError("Could not encode enhanced PNG")
    return Response(content=encoded.tobytes(), media_type="image/png")
