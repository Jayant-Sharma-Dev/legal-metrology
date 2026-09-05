import os
import json
import logging
from contextlib import asynccontextmanager
from typing import Annotated
from fastapi import Depends, FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from google import genai
from google.genai import types
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.database import Base, Inspection, engine, get_db

load_dotenv()

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    try:
        Base.metadata.create_all(bind=engine)
    except SQLAlchemyError:
        logger.exception("Unable to initialize inspection history table")
        raise
    yield

# ── App ───────────────────────────────────────────────────────────────────────

app = FastAPI(title="Legal Metrology API", version="0.2.0", lifespan=lifespan)
from fastapi.openapi.utils import get_openapi

def custom_openapi():
    if app.openapi_schema:
        return app.openapi_schema
    schema = get_openapi(
        title=app.title,
        version=app.version,
        routes=app.routes,
    )
    # Fix /inspect image field to show array<binary> instead of array<string>
    try:
        body = schema["paths"]["/inspect"]["post"]["requestBody"]
        content = body["content"]["multipart/form-data"]["schema"]
        if "$ref" in content:
            reference_name = content["$ref"].rsplit("/", 1)[-1]
            content = schema["components"]["schemas"][reference_name]
        content.setdefault("properties", {})["image"] = {
            "type": "array",
            "items": {"type": "string", "format": "binary"},
        }
    except KeyError:
        pass
    app.openapi_schema = schema
    return schema

app.openapi = custom_openapi  # type: ignore

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Gemini client ─────────────────────────────────────────────────────────────

client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))

# ── Prompt ────────────────────────────────────────────────────────────────────

EXTRACTION_PROMPT = """
You are a Legal Metrology compliance inspector for India.

The uploaded images are different views of the SAME packaged product. Inspect ALL images before extracting the following fields and combine information across them.
Return ONLY valid JSON — no markdown, no code fences, no explanation.

{
  "product_name": "string or null",
  "manufacturer": "string or null",
  "packer": "string or null",
  "importer": "string or null",
  "net_quantity": "string or null",
  "unit": "string or null",
  "mrp": "string or null",
  "batch_number": "string or null",
  "manufacturing_date": "string or null",
  "expiry_date": "string or null",
  "consumer_care": "string or null",
  "fssai_number": "string or null",
  "country_of_origin": "string or null",
  "category": "string or null",
    "raw_text": "all visible text across all images as a single string",
    "conflicts": []
}

Rules:
- Treat all uploaded images as views of one product, not separate products.
- Do not claim a declaration is absent merely because it is not visible in one image.
- If a field appears on any image, use the detected value.
- If images contain conflicting values for a field, do not guess. Return the safest available value or null and add a short description to conflicts.
- Extract exactly what is printed. Do not infer or guess.
- For net_quantity, extract the number only (e.g. "70" not "70g").
- For unit, extract the unit only (e.g. "g", "ml", "pieces").
- For mrp, extract digits only (e.g. "14" not "Rs.14" or "₹14").
- If a field is not visible or not present, return null.
"""

# ── Rule engine ───────────────────────────────────────────────────────────────

RULES = [
    {
        "rule_id": "LM-01",
        "requirement": "Product name or generic name must be declared",
        "field": "product_name",
        "legal_reference": "Rule 6(1) — Name or generic name of the commodity",
    },
    {
        "rule_id": "LM-02",
        "requirement": "Name and address of manufacturer or packer must be present",
        "field": "manufacturer",
        "legal_reference": "Rule 6(2) — Name and address of manufacturer/packer",
    },
    {
        "rule_id": "LM-03",
        "requirement": "Net quantity must be declared",
        "field": "net_quantity",
        "legal_reference": "Rule 6(3) — Net quantity in standard units",
    },
    {
        "rule_id": "LM-04",
        "requirement": "Maximum Retail Price (MRP) must be declared",
        "field": "mrp",
        "legal_reference": "Rule 6(4) — Retail sale price inclusive of all taxes",
    },
    {
        "rule_id": "LM-05",
        "requirement": "Month and year of manufacture or packing must be present",
        "field": "manufacturing_date",
        "legal_reference": "Rule 6(5) — Month and year of manufacture/packing",
    },
    {
        "rule_id": "LM-06",
        "requirement": "Best before or expiry date must be declared",
        "field": "expiry_date",
        "legal_reference": "Rule 6(6) — Best before or expiry date",
    },
    {
        "rule_id": "LM-07",
        "requirement": "Consumer care details (address or helpline) must be present",
        "field": "consumer_care",
        "legal_reference": "Rule 6(7) — Consumer care number or address",
    },
    {
        "rule_id": "LM-08",
        "requirement": "FSSAI licence number required for food products",
        "field": "fssai_number",
        "legal_reference": "FSS Act 2006 — FSSAI registration/licence number",
    },
    {
        "rule_id": "LM-09",
        "requirement": "Country of origin must be declared for imported goods",
        "field": "country_of_origin",
        "legal_reference": "Rule 6(8) — Country of origin for imported commodities",
    },
    {
        "rule_id": "LM-10",
        "requirement": "Batch or lot number must be declared",
        "field": "batch_number",
        "legal_reference": "Rule 6(9) — Batch, lot, or code number",
    },
]


def run_compliance(product: dict) -> dict:
    """
    Run deterministic compliance checks against extracted product fields.
    Returns overall_status and per-rule results matching frontend shape.
    """
    rules_result = []

    for rule in RULES:
        field = rule["field"]
        value = product.get(field)
        has_value = value is not None and str(value).strip() != ""

        # country_of_origin: REVIEW if null (may be domestic, not imported)
        if field == "country_of_origin" and not has_value:
            status = "REVIEW"
            explanation = "Not detected. Required only for imported goods — verify if applicable."
        elif has_value:
            status = "PASS"
            explanation = f"Declared on label: {value}"
        else:
            status = "FAIL"
            explanation = f"Not found on label. This is a mandatory declaration under {rule['legal_reference']}."

        rules_result.append({
            "rule_id": rule["rule_id"],
            "requirement": rule["requirement"],
            "status": status,
            "field": field,
            "value": value,
            "explanation": explanation,
            "legal_reference": rule["legal_reference"],
        })

    # Overall: FAIL if any FAIL, REVIEW if any REVIEW, else PASS
    statuses = [r["status"] for r in rules_result]
    if "FAIL" in statuses:
        overall = "FAIL"
    elif "REVIEW" in statuses:
        overall = "REVIEW"
    else:
        overall = "PASS"

    return {"overall_status": overall, "rules": rules_result}


# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/")
async def root():
    return {"status": "ok", "service": "Legal Metrology API"}


@app.get("/health")
async def health():
    return {"status": "healthy"}


@app.get("/models")
async def list_models():
    models = client.models.list()
    return {"models": [m.name for m in models]}


@app.post("/inspect")
async def inspect_product(
       image: Annotated[list[UploadFile], File(description="Product label images (up to 3)")],
    db: Session = Depends(get_db),
):
    # ── validate ──────────────────────────────────────────────────────────────
    if not image or len(image) > 3:
        raise HTTPException(status_code=400, detail="Upload between 1 and 3 product images")

    image_parts = []
    for uploaded_image in image:
        if not uploaded_image.content_type or not uploaded_image.content_type.startswith("image/"):
            raise HTTPException(status_code=400, detail="Every uploaded file must be an image")

        content = await uploaded_image.read()
        if len(content) > 10 * 1024 * 1024:
            raise HTTPException(status_code=400, detail="Each image must be 10 MB or smaller")

        image_parts.append(types.Part.from_bytes(data=content, mime_type=uploaded_image.content_type))

    # ── Gemini Vision extraction ───────────────────────────────────────────────
    raw = ""
    try:
        response = client.models.generate_content(
            model="gemini-3.6-flash",
            contents=[*image_parts, EXTRACTION_PROMPT],
        )

        raw = response.text.strip()

        # Strip markdown fences Gemini sometimes adds
        if raw.startswith("```"):
            lines = raw.splitlines()
            raw = "\n".join(lines[1:-1]).strip()

        extracted = json.loads(raw)

    except json.JSONDecodeError as e:
        raise HTTPException(
            status_code=500,
            detail=f"Gemini returned invalid JSON: {e}. Raw response: {raw[:300]}",
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Extraction failed: {type(e).__name__}: {e}",
        )

    # ── Build product fields (matches frontend productFields list) ─────────────
    product = {
        "product_name":      extracted.get("product_name"),
        "manufacturer":      extracted.get("manufacturer"),
        "packer":            extracted.get("packer"),
        "importer":          extracted.get("importer"),
        "net_quantity":      (
            f"{extracted.get('net_quantity')} {extracted.get('unit') or ''}".strip()
            if extracted.get("net_quantity") else None
        ),
        "mrp":               extracted.get("mrp"),
        "batch_number":      extracted.get("batch_number"),
        "manufacturing_date": extracted.get("manufacturing_date"),
        "expiry_date":       extracted.get("expiry_date"),
        "category":          extracted.get("category"),
    }

    # ── Run rule engine ───────────────────────────────────────────────────────
    # Pass raw extracted fields (not formatted product) so rules check each field
    compliance = run_compliance(extracted)

    # ── Build OCR evidence from raw_text ──────────────────────────────────────
    raw_text = extracted.get("raw_text", "") or ""
    ocr_lines = [
        {"text": line.strip(), "confidence": 1.0, "box": []}
        for line in raw_text.split("\n")
        if line.strip()
    ] if raw_text else []

    response_payload = {
        "success":    True,
        "ocr":        {"success": True, "text": ocr_lines},
        "product":    product,
        "compliance": compliance,
        "extraction_review": extracted.get("conflicts", []),
    }

    try:
        statuses = [rule["status"] for rule in compliance["rules"]]
        inspection = Inspection(
            overall_status=compliance["overall_status"],
            product_name=product.get("product_name"),
            manufacturer=product.get("manufacturer"),
            packer=product.get("packer"),
            importer=product.get("importer"),
            net_quantity=product.get("net_quantity"),
            mrp=product.get("mrp"),
            batch_number=product.get("batch_number"),
            manufacturing_date=product.get("manufacturing_date"),
            expiry_date=product.get("expiry_date"),
            category=product.get("category"),
            violation_count=statuses.count("FAIL"),
            review_count=statuses.count("REVIEW"),
            product_data=product,
            compliance_data=compliance,
        )
        db.add(inspection)
        db.flush()
        logger.info("Prepared inspection history record id=%s", inspection.id)
        db.commit()
        db.refresh(inspection)
        logger.info("Saved inspection history record id=%s", inspection.id)
    except Exception:
        db.rollback()
        logger.exception(
            "Unable to save inspection history: status=%s product_name=%r",
            compliance.get("overall_status"),
            product.get("product_name"),
        )

    return response_payload


def inspection_to_dict(inspection: Inspection) -> dict:
    return {
        "id": inspection.id,
        "created_at": inspection.created_at.isoformat() if inspection.created_at else None,
        "overall_status": inspection.overall_status,
        "product_name": inspection.product_name,
        "manufacturer": inspection.manufacturer,
        "packer": inspection.packer,
        "importer": inspection.importer,
        "net_quantity": inspection.net_quantity,
        "mrp": inspection.mrp,
        "batch_number": inspection.batch_number,
        "manufacturing_date": inspection.manufacturing_date,
        "expiry_date": inspection.expiry_date,
        "category": inspection.category,
        "violation_count": inspection.violation_count,
        "review_count": inspection.review_count,
        "product_data": inspection.product_data,
        "compliance_data": inspection.compliance_data,
    }


def inspection_summary_to_dict(inspection: Inspection) -> dict:
    return {
        "id": inspection.id,
        "created_at": inspection.created_at.isoformat() if inspection.created_at else None,
        "product_name": inspection.product_name,
        "manufacturer": inspection.manufacturer,
        "overall_status": inspection.overall_status,
        "violation_count": inspection.violation_count,
        "review_count": inspection.review_count,
    }


@app.get("/inspections")
async def list_inspections(db: Session = Depends(get_db)):
    inspections = db.scalars(
        select(Inspection).order_by(Inspection.created_at.desc(), Inspection.id.desc())
    ).all()
    return [inspection_summary_to_dict(inspection) for inspection in inspections]


@app.get("/inspections/{inspection_id}")
async def get_inspection(inspection_id: int, db: Session = Depends(get_db)):
    inspection = db.get(Inspection, inspection_id)
    if inspection is None:
        raise HTTPException(status_code=404, detail="Inspection not found")
    return inspection_to_dict(inspection)