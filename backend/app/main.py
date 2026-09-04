import os
import base64
import json
import tempfile
from pathlib import Path

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
import google.generativeai as genai

load_dotenv()

app = FastAPI(title="Legal Metrology API", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # lock down after SIH demo
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Gemini setup ──────────────────────────────────────────────────────────────

genai.configure(api_key=os.getenv("GEMINI_API_KEY"))
model = genai.GenerativeModel("gemini-1.5-flash")

EXTRACTION_PROMPT = """
You are a Legal Metrology compliance inspector for India.

Analyze this product label image and extract the following fields.
Return ONLY valid JSON, no markdown, no explanation.

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
  "raw_text": "all visible text on label as single string"
}

Rules:
- Extract exactly what is printed. Do not infer or guess.
- For net_quantity, extract the number only (e.g. "70" not "70g")
- For unit, extract the unit only (e.g. "g", "ml", "pieces")
- For mrp, extract digits only (e.g. "14" not "Rs.14" or "₹14")
- If a field is not visible or not present, return null
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
    Accepts a product label image.
    Returns extracted fields via Gemini Vision.
    """
    # Validate
    if not image.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="File must be an image")

    content = await image.read()

    if len(content) > 10 * 1024 * 1024:  # 10MB limit
        raise HTTPException(status_code=400, detail="Image too large (max 10MB)")

    # Send to Gemini Vision
    try:
        image_part = {
            "mime_type": image.content_type,
            "data": base64.b64encode(content).decode("utf-8"),
        }

        response = model.generate_content([
            EXTRACTION_PROMPT,
            {"inline_data": image_part},
        ])

        raw = response.text.strip()

        # Strip markdown fences if Gemini adds them
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
            raw = raw.strip()

        extracted = json.loads(raw)

        return {
            "success": True,
            "extraction": extracted,
        }

    except json.JSONDecodeError as e:
        raise HTTPException(
            status_code=500,
            detail=f"Gemini returned invalid JSON: {str(e)}"
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Extraction failed: {str(e)}"
        )