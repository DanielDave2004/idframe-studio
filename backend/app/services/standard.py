"""Deterministic portrait processing with optional non-generative formal attire overlays."""
from io import BytesIO
from PIL import Image, ImageOps, ImageEnhance, ImageDraw

BACKGROUND = {"white": (255, 255, 255), "gray": (234, 237, 240), "blue": (216, 232, 247)}
ATTIRES = {"original", "black_suit", "navy_suit", "gray_suit", "white_polo"}


def _find_face(image: Image.Image):
    """Optional OpenCV detector; returns center/radius in source pixels."""
    try:
        import cv2
        import numpy as np
        import os
        frame = cv2.cvtColor(np.array(ImageOps.contain(image, (1200, 1200)).convert('RGB')), cv2.COLOR_RGB2GRAY)
        scale = image.width / frame.shape[1]
        classifier = cv2.CascadeClassifier(os.path.join(cv2.data.haarcascades, 'haarcascade_frontalface_default.xml'))
        candidates = classifier.detectMultiScale(frame, scaleFactor=1.1, minNeighbors=5, minSize=(45, 45))
        if len(candidates) == 0:
            return None
        x, y, width, height = max(candidates, key=lambda r: r[2] * r[3])
        return {
            "cx": (x + width / 2) * scale,
            "cy": (y + height / 2) * scale,
            "width": width * scale,
            "height": height * scale,
            "x": x * scale,
            "y": y * scale,
        }
    except (ImportError, OSError, AttributeError):
        return None


def _crop_portrait(image: Image.Image) -> Image.Image:
    """Square portrait, face placed slightly above the middle when detected."""
    width, height = image.size
    detected = _find_face(image)
    if detected:
        cx = detected["cx"]
        cy = detected["cy"]
        face_height = detected["height"]
        side = max(face_height / 0.43, 1)
        side = min(max(side, min(width, height) * 0.55), min(width, height))
        x0 = cx - side / 2
        y0 = cy - side * 0.40
    else:
        side = min(width, height)
        x0 = (width - side) / 2
        y0 = max(0, (height - side) * 0.30)
    x0 = max(0, min(x0, width - side))
    y0 = max(0, min(y0, height - side))
    return image.crop((round(x0), round(y0), round(x0 + side), round(y0 + side)))


def _draw_jacket(draw: ImageDraw.ImageDraw, face: dict | None, attire: str) -> None:
    cx = face["cx"] if face else 300
    face_h = face["height"] if face else 170
    chin = (face["y"] + face_h * 1.04) if face else 262
    jacket_top = max(chin - 10, 235)
    shirt_top = jacket_top + 12
    shoulder_span = max(370, min(520, face_h * 2.9))
    waist_span = shoulder_span * 0.72
    bottom_y = 630
    left_shoulder = cx - shoulder_span / 2
    right_shoulder = cx + shoulder_span / 2
    left_waist = cx - waist_span / 2
    right_waist = cx + waist_span / 2

    if attire == "black_suit":
        jacket = (44, 50, 60, 255)
    elif attire == "navy_suit":
        jacket = (31, 52, 92, 255)
    else:
        jacket = (97, 106, 120, 255)

    shirt = (252, 252, 252, 255)
    tie = (39, 44, 52, 245)

    # Jacket body
    draw.polygon([
        (left_shoulder, jacket_top + 36),
        (cx - 42, jacket_top + 18),
        (left_waist, bottom_y),
        (cx - 26, bottom_y),
        (cx - 10, jacket_top + 122),
    ], fill=jacket)
    draw.polygon([
        (right_shoulder, jacket_top + 36),
        (cx + 42, jacket_top + 18),
        (right_waist, bottom_y),
        (cx + 26, bottom_y),
        (cx + 10, jacket_top + 122),
    ], fill=jacket)

    # Shirt torso
    draw.polygon([
        (cx - 78, shirt_top + 26),
        (cx + 78, shirt_top + 26),
        (cx + 56, bottom_y),
        (cx - 56, bottom_y),
    ], fill=shirt)

    # Collars
    draw.polygon([(cx - 84, shirt_top + 8), (cx - 10, shirt_top + 8), (cx - 40, shirt_top + 56)], fill=shirt)
    draw.polygon([(cx + 84, shirt_top + 8), (cx + 10, shirt_top + 8), (cx + 40, shirt_top + 56)], fill=shirt)
    # Lapels
    draw.polygon([(cx - 114, jacket_top + 20), (cx - 12, jacket_top + 24), (cx - 54, jacket_top + 102)], fill=jacket)
    draw.polygon([(cx + 114, jacket_top + 20), (cx + 12, jacket_top + 24), (cx + 54, jacket_top + 102)], fill=jacket)

    # Tie
    tie_top = shirt_top + 22
    draw.polygon([
        (cx, tie_top), (cx - 18, tie_top + 26), (cx, tie_top + 46), (cx + 18, tie_top + 26)
    ], fill=tie)
    draw.polygon([
        (cx - 16, tie_top + 40), (cx + 16, tie_top + 40), (cx + 28, tie_top + 160), (cx - 28, tie_top + 160)
    ], fill=tie)


def _draw_polo(draw: ImageDraw.ImageDraw, face: dict | None) -> None:
    cx = face["cx"] if face else 300
    face_h = face["height"] if face else 170
    chin = (face["y"] + face_h * 1.03) if face else 262
    top = max(chin, 240)
    shoulder_span = max(360, min(520, face_h * 2.8))
    bottom_y = 620
    fill = (247, 247, 247, 255)
    shadow = (222, 224, 227, 255)

    draw.rounded_rectangle((cx - shoulder_span / 2, top + 26, cx + shoulder_span / 2, bottom_y), radius=34, fill=fill)
    draw.polygon([(cx - 94, top + 26), (cx - 12, top + 26), (cx - 42, top + 82)], fill=fill)
    draw.polygon([(cx + 94, top + 26), (cx + 12, top + 26), (cx + 42, top + 82)], fill=fill)
    draw.polygon([(cx - 94, top + 26), (cx - 12, top + 26), (cx - 56, top + 94)], fill=shadow)
    draw.polygon([(cx + 94, top + 26), (cx + 12, top + 26), (cx + 56, top + 94)], fill=shadow)
    draw.line((cx, top + 28, cx, top + 120), fill=(210, 212, 216, 255), width=2)
    for y in (top + 44, top + 60):
        draw.ellipse((cx - 4, y - 4, cx + 4, y + 4), fill=(190, 192, 197, 255))


def _apply_attire(base: Image.Image, attire: str) -> Image.Image:
    if attire == "original":
        return base
    overlay = Image.new("RGBA", base.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    face = _find_face(base)
    if attire in {"black_suit", "navy_suit", "gray_suit"}:
        _draw_jacket(draw, face, attire)
    elif attire == "white_polo":
        _draw_polo(draw, face)
    return Image.alpha_composite(base.convert("RGBA"), overlay).convert("RGB")


def standard_photo(
    image: Image.Image,
    *,
    background: str = 'white',
    strength: float = 0.5,
    remove_background: bool = False,
    attire: str = 'original',
) -> bytes:
    if background not in BACKGROUND:
        raise ValueError('Unsupported background color')
    if not (0 <= strength <= 1):
        raise ValueError('Strength must be from 0 to 1')
    if attire not in ATTIRES:
        raise ValueError('Unsupported attire option')

    subject = image.convert('RGB')
    subject = ImageOps.autocontrast(subject, cutoff=0.4 * strength)
    subject = ImageEnhance.Contrast(subject).enhance(1.0 + 0.1 * strength)
    subject = ImageEnhance.Color(subject).enhance(1.0 + 0.035 * strength)
    subject = ImageEnhance.Sharpness(subject).enhance(1.0 + 0.15 * strength)

    if remove_background:
        try:
            from rembg import remove, new_session
        except ImportError as exc:
            raise RuntimeError('Background removal is optional. Install with: pip install "rembg[cpu]"') from exc
        layer = remove(subject, session=new_session('u2netp')).convert('RGBA')
        base = Image.new('RGBA', layer.size, BACKGROUND[background] + (255,))
        subject = Image.alpha_composite(base, layer).convert('RGB')

    cropped = _crop_portrait(subject)
    result = cropped.resize((600, 600), Image.Resampling.LANCZOS)
    result = _apply_attire(result, attire)

    output = BytesIO()
    result.save(output, format='JPEG', quality=94, optimize=True, dpi=(300, 300))
    return output.getvalue()
