import json

from app.gemini_extractor import ProductFields
from app.rule_engine import evaluate_compliance


# -----------------------------------------
# Test 1: Good product
# -----------------------------------------

good_product = ProductFields(
    product_name="Chocolate Cookies",
    manufacturer="ABC Foods Pvt Ltd",
    packer=None,
    importer=None,
    net_quantity="100 g",
    mrp="₹20",
    batch_number="B123",
    manufacturing_date="08/2026",
    expiry_date="08/2027",
    category="packaged_food"
)


result = evaluate_compliance(good_product)

print("\n==============================")
print("TEST 1: GOOD PRODUCT")
print("==============================")

print(json.dumps(result, indent=2))


# -----------------------------------------
# Test 2: Missing important declarations
# -----------------------------------------

bad_product = ProductFields(
    product_name="Chocolate Cookies",
    manufacturer="ABC Foods Pvt Ltd",
    packer=None,
    importer=None,
    net_quantity=None,
    mrp=None,
    batch_number=None,
    manufacturing_date="08/2026",
    expiry_date="08/2027",
    category="packaged_food"
)


result = evaluate_compliance(bad_product)

print("\n==============================")
print("TEST 2: MISSING DECLARATIONS")
print("==============================")

print(json.dumps(result, indent=2))


# -----------------------------------------
# Test 3: Limited information
# -----------------------------------------

unknown_product = ProductFields(
    product_name="Cookies",
    manufacturer="ABC Foods",
    packer=None,
    importer=None,
    net_quantity=None,
    mrp=None,
    batch_number=None,
    manufacturing_date=None,
    expiry_date=None,
    category=None
)


result = evaluate_compliance(unknown_product)

print("\n==============================")
print("TEST 3: LIMITED INFORMATION")
print("==============================")

print(json.dumps(result, indent=2))