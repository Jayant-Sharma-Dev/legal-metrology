import os
import json

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from google import genai
from google.genai import types

load_dotenv()

# ── App ───────────────────────────────────────────────────────────────────────

app = FastAPI(title="Legal Metrology API", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Gemini client ─────────────────────────────────────────────────────────────

client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))
@app.get("/models")
async def list_models():
    models = client.models.list()
    return {"models": [m.name for m in models]}

# ── Prompt ────────────────────────────────────────────────────────────────────

EXTRACTION_PROMPT = """
You are a Legal Metrology compliance inspector for India.

Analyze this product label image and extract the following fields.
Return ONLY valid JSON — no markdown, no code fences, no explanation.

{
  "product_name": "string or null",
  "manufacturer": "string or null",
  "net_quantity": "string or null",
  "unit": "string or null",
  "mrp": "string or null",
  "packing_date": "string or null",
  "best_before": "string or null",
  "consumer_care": "string or null",
  "fssai_number": "string or null",
  "country_of_origin": "string or null",
  "raw_text": "all visible text on the label as a single string"
}

Rules:
- Extract exactly what is printed. Do not infer or guess.
- For net_quantity, extract the number only (e.g. "70" not "70g").
- For unit, extract the unit only (e.g. "g", "ml", "pieces").
- For mrp, extract digits only (e.g. "14" not "Rs.14" or "₹14").
- If a field is not visible or not present, return null.
"""

# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/")
async def root():
    return {"status": "ok", "service": "Legal Metrology API"}


@app.get("/health")
async def health():
    return {"status": "healthy"}


@app.post("/inspect")
async def inspect_product(image: UploadFile = File(...)):
    """
    Accept a product label image.
    Return Gemini-extracted fields as structured JSON.
    """

    # ── validate ──────────────────────────────────────────────────────────────
    if not image.content_type or not image.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="File must be an image")

    content = await image.read()

    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Image too large (max 10 MB)")

    # ── call Gemini Vision ────────────────────────────────────────────────────
    try:
        image_part = types.Part.from_bytes(
            data=content,
            mime_type=image.content_type,
        )

        response = client.models.generate_content(
            model="gemini-1.5-flash",
            contents=[image_part, EXTRACTION_PROMPT],
        )

        raw = response.text.strip()

        # Strip markdown fences Gemini sometimes adds despite instructions
        if raw.startswith("```"):
            lines = raw.splitlines()
            # drop first line (```json or ```) and last line (```)
            raw = "\n".join(lines[1:-1]).strip()

        extracted = json.loads(raw)

    except json.JSONDecodeError as e:
        raise HTTPException(
            status_code=500,
            detail=f"Gemini returned invalid JSON: {e}. Raw: {raw[:300]}",
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Extraction failed: {type(e).__name__}: {e}",
        )

    return {
        "success": True,
        "extraction": extracted,
    }