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


def verify_face(image: Image.Image) -> dict:
    """Detect a frontal face on the server, without requiring browser WebGL."""
    import cv2
    import numpy as np

    # Keep the analysis fast for oversized camera images. Normalize the returned
    # bounding box to the *original* image via ratios in the scaled image.
    gray = np.asarray(ImageOps.grayscale(image))
    original_height, original_width = gray.shape
    scale = min(1.0, 1000.0 / max(original_width, original_height))
    if scale < 1:
        gray = cv2.resize(gray, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    gray = cv2.equalizeHist(gray)
    classifier = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
    if classifier.empty():
        raise HTTPException(503, "Face verification service is unavailable.")
    # minNeighbors=5 filters common false positives on logos and objects.
    faces = classifier.detectMultiScale(gray, scaleFactor=1.08, minNeighbors=5, minSize=(32, 32))
    if len(faces) == 0:
        return {"found": False, "face": None}
    x, y, w, h = sorted(faces, key=lambda box: int(box[2]) * int(box[3]), reverse=True)[0]
    height, width = gray.shape
    # A usable portrait should have a reasonably large face. Small accidental
    # Haar matches on logos/illustrations are not enough to authorize AI use.
    if w / width < 0.14 or h / height < 0.14:
        return {"found": False, "face": None}
    return {"found": True, "face": {
        "x": float((x + w / 2) / width),
        "y": float((y + h / 2) / height),
        "width": float(w / width),
        "height": float(h / height),
    }}
