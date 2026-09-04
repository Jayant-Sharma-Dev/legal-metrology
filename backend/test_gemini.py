from app.gemini_extractor import extract_product_fields


SAMPLE_OCR_TEXT = """Rabo Fresh
Cookies
BHOLA FOOD PRODUCTS
NET WEIGHT
SEE YOU ON THE SLIP"""


if __name__ == "__main__":
    result = extract_product_fields(SAMPLE_OCR_TEXT)
    print(result.model_dump_json(indent=2))