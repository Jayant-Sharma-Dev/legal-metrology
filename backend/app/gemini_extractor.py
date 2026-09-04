import os
from pathlib import Path

from dotenv import load_dotenv
from google import genai
from google.genai import types
from pydantic import BaseModel


BACKEND_ROOT = Path(__file__).resolve().parents[1]
load_dotenv(BACKEND_ROOT / ".env")


class ProductFields(BaseModel):
    product_name: str | None = None
    manufacturer: str | None = None
    packer: str | None = None
    importer: str | None = None
    net_quantity: str | None = None
    mrp: str | None = None
    batch_number: str | None = None
    manufacturing_date: str | None = None
    expiry_date: str | None = None
    category: str | None = None


def extract_product_fields(ocr_text: str) -> ProductFields:
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY is not configured in backend/.env")

    prompt = f"""Extract product fields from the OCR text below.

Rules:
- Extract only information present in the OCR text.
- Never invent missing values.
- Use null when a field is not found.
- Normalize obvious OCR formatting errors only when confidence is reasonable.
- Do not determine legal compliance.
- Do not decide PASS/FAIL.

OCR text:
{ocr_text}
"""

    client = genai.Client(api_key=api_key)
    response = client.models.generate_content(
        model="gemini-3.5-flash-lite",
        contents=prompt,
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=ProductFields,
        ),
    )
    return ProductFields.model_validate_json(response.text)