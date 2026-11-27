from io import BytesIO
from PIL import Image, ImageEnhance, ImageFilter, ImageOps, UnidentifiedImageError
from fastapi import HTTPException, UploadFile
from app.core.config import MAX_UPLOAD_BYTES, MAX_IMAGE_PIXELS

ALLOWED = {"image/jpeg", "image/png", "image/webp"}

async def read_image(file: UploadFile) -> Image.Image:
    if file.content_type not in ALLOWED:
        raise HTTPException(415, "Upload a JPG, PNG, or WebP image.")
    data = await file.read(MAX_UPLOAD_BYTES + 1)
    if not data or len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "Image must be under 8 MB.")
    try:
        with Image.open(BytesIO(data)) as image:
            if image.format not in {"JPEG", "PNG", "WEBP"}:
                raise HTTPException(415, "Unsupported image format.")
            if image.width * image.height > MAX_IMAGE_PIXELS:
                raise HTTPException(413, "Image dimensions exceed the processing limit.")
            image = ImageOps.exif_transpose(image)
            image.load()
            return image.convert("RGB")
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError) as exc:
        raise HTTPException(422, "Image is corrupted or unsupported.") from exc


def analyze(image: Image.Image) -> dict:
    thumbnail = ImageOps.contain(image, (128, 128)).convert("L")
    from PIL import ImageStat
    brightness = ImageStat.Stat(thumbnail).mean[0]
    edge_score = ImageStat.Stat(thumbnail.filter(ImageFilter.FIND_EDGES)).mean[0]
    tips = []
    if min(image.size) < 600:
        tips.append("Low resolution. A larger original photo may give better results.")
    if brightness < 65:
        tips.append("Your photo looks dark. Try a brighter source image.")
    if brightness > 210:
        tips.append("Your photo looks very bright. Facial details may be washed out.")
    if edge_score < 9:
        tips.append("The image may be blurry or lack detail. Check it visually.")
    if not tips:
        tips.append("Basic image checks passed. Face suitability still needs visual review.")
    return {"width": image.width, "height": image.height, "brightness": round(brightness, 1), "edgeScore": round(edge_score, 1), "tips": tips}


def polish(image: Image.Image, strength: float) -> bytes:
    # Only deterministic exposure/contrast/sharpness adjustments. No fabricated face data.
    adjusted = ImageEnhance.Contrast(image).enhance(1.0 + 0.12 * strength)
    adjusted = ImageEnhance.Color(adjusted).enhance(1.0 + 0.04 * strength)
    adjusted = ImageEnhance.Sharpness(adjusted).enhance(1.0 + 0.22 * strength)
    output = BytesIO()
    adjusted.save(output, format="JPEG", quality=92, optimize=True)
    return output.getvalue()
