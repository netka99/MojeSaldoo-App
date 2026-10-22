import io
import uuid

from django.core.files.base import ContentFile
from PIL import Image, ImageOps, UnidentifiedImageError

MAX_UPLOAD_BYTES = 5 * 1024 * 1024
THUMB_PX = 128
ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/png", "image/webp"}


class ProductImageError(Exception):
    def __init__(self, message: str):
        self.message = message
        super().__init__(message)


def build_product_thumbnail(uploaded) -> ContentFile:
    """Center-crop an upload to a small JPEG. The original file is not kept."""
    size = getattr(uploaded, "size", None)
    if size is not None and size > MAX_UPLOAD_BYTES:
        raise ProductImageError("Zdjęcie jest za duże. Maksymalnie 5 MB.")

    content_type = (getattr(uploaded, "content_type", "") or "").split(";")[0].strip().lower()
    if content_type not in ALLOWED_CONTENT_TYPES:
        raise ProductImageError("Dozwolone formaty: JPEG, PNG, WebP.")

    try:
        uploaded.seek(0)
        img = Image.open(uploaded)
        img = ImageOps.exif_transpose(img)
        img = img.convert("RGB")
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise ProductImageError("Nie udało się odczytać zdjęcia.") from exc

    width, height = img.size
    if width < 1 or height < 1:
        raise ProductImageError("Nie udało się odczytać zdjęcia.")
    side = min(width, height)
    left = (width - side) // 2
    top = (height - side) // 2
    img = img.crop((left, top, left + side, top + side))
    img = img.resize((THUMB_PX, THUMB_PX), Image.Resampling.LANCZOS)

    buffer = io.BytesIO()
    img.save(buffer, format="JPEG", quality=75, optimize=True)
    return ContentFile(buffer.getvalue(), name=f"{uuid.uuid4().hex}.jpg")
