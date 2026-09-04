from app.gemini_extractor import ProductFields


def evaluate_compliance(
    product: ProductFields
) -> dict:

    rules = []

    # -----------------------------------------
    # Rule 1: Product name
    # -----------------------------------------

    if product.product_name:
        rules.append({
            "rule_id": "LM-001",
            "requirement": "Common/generic name of commodity",
            "status": "PASS",
            "field": "product_name",
            "value": product.product_name,
            "explanation": "Product name is present.",
            "legal_reference": "Rule 6, Legal Metrology (Packaged Commodities) Rules, 2011"
        })
    else:
        rules.append({
            "rule_id": "LM-001",
            "requirement": "Common/generic name of commodity",
            "status": "FAIL",
            "field": "product_name",
            "value": None,
            "explanation": "Product name was not detected.",
            "legal_reference": "Rule 6, Legal Metrology (Packaged Commodities) Rules, 2011"
        })

    # -----------------------------------------
    # Rule 2: Manufacturer / Packer / Importer
    # -----------------------------------------

    responsible_party = (
        product.manufacturer
        or product.packer
        or product.importer
    )

    if responsible_party:
        rules.append({
            "rule_id": "LM-002",
            "requirement": "Manufacturer/packer/importer information",
            "status": "PASS",
            "field": "manufacturer",
            "value": responsible_party,
            "explanation": "Responsible party information was detected.",
            "legal_reference": "Rule 6, Legal Metrology (Packaged Commodities) Rules, 2011"
        })
    else:
        rules.append({
            "rule_id": "LM-002",
            "requirement": "Manufacturer/packer/importer information",
            "status": "FAIL",
            "field": "manufacturer",
            "value": None,
            "explanation": "No manufacturer, packer, or importer information was detected.",
            "legal_reference": "Rule 6, Legal Metrology (Packaged Commodities) Rules, 2011"
        })

    # -----------------------------------------
    # Rule 3: Net quantity
    # -----------------------------------------

    if product.net_quantity:
        rules.append({
            "rule_id": "LM-003",
            "requirement": "Net quantity",
            "status": "PASS",
            "field": "net_quantity",
            "value": product.net_quantity,
            "explanation": "Net quantity declaration was detected.",
            "legal_reference": "Rule 6, Legal Metrology (Packaged Commodities) Rules, 2011"
        })
    else:
        rules.append({
            "rule_id": "LM-003",
            "requirement": "Net quantity",
            "status": "FAIL",
            "field": "net_quantity",
            "value": None,
            "explanation": "Net quantity declaration was not detected.",
            "legal_reference": "Rule 6, Legal Metrology (Packaged Commodities) Rules, 2011"
        })

    # -----------------------------------------
    # Rule 4: MRP
    # -----------------------------------------

    if product.mrp:
        rules.append({
            "rule_id": "LM-004",
            "requirement": "Maximum Retail Price (MRP)",
            "status": "PASS",
            "field": "mrp",
            "value": product.mrp,
            "explanation": "MRP declaration was detected.",
            "legal_reference": "Rule 6, Legal Metrology (Packaged Commodities) Rules, 2011"
        })
    else:
        rules.append({
            "rule_id": "LM-004",
            "requirement": "Maximum Retail Price (MRP)",
            "status": "FAIL",
            "field": "mrp",
            "value": None,
            "explanation": "MRP declaration was not detected.",
            "legal_reference": "Rule 6, Legal Metrology (Packaged Commodities) Rules, 2011"
        })

    # -----------------------------------------
    # Rule 5: Manufacturing date
    # -----------------------------------------

    if product.manufacturing_date:
        rules.append({
            "rule_id": "LM-005",
            "requirement": "Month/year of manufacture or packing",
            "status": "PASS",
            "field": "manufacturing_date",
            "value": product.manufacturing_date,
            "explanation": "Manufacturing/packing date information was detected.",
            "legal_reference": "Rule 6, Legal Metrology (Packaged Commodities) Rules, 2011"
        })
    else:
        rules.append({
            "rule_id": "LM-005",
            "requirement": "Month/year of manufacture or packing",
            "status": "FAIL",
            "field": "manufacturing_date",
            "value": None,
            "explanation": "Manufacturing/packing date information was not detected.",
            "legal_reference": "Rule 6, Legal Metrology (Packaged Commodities) Rules, 2011"
        })

    # -----------------------------------------
    # Rule 6: Best before / expiry
    # -----------------------------------------

    if product.expiry_date:
        rules.append({
            "rule_id": "LM-006",
            "requirement": "Best-before/use-by information",
            "status": "PASS",
            "field": "expiry_date",
            "value": product.expiry_date,
            "explanation": "Best-before/use-by/expiry information was detected.",
            "legal_reference": "Rule 6, Legal Metrology (Packaged Commodities) Rules, 2011"
        })
    else:
        rules.append({
            "rule_id": "LM-006",
            "requirement": "Best-before/use-by information",
            "status": "REVIEW",
            "field": "expiry_date",
            "value": None,
            "explanation": "No expiry information was detected; applicability should be reviewed.",
            "legal_reference": "Rule 6, Legal Metrology (Packaged Commodities) Rules, 2011"
        })

    # -----------------------------------------
    # Rule 7: Consumer care
    # -----------------------------------------

    # We don't currently have a dedicated consumer-care
    # field in ProductFields.
    #
    # Therefore we cannot reliably determine this yet.

    rules.append({
        "rule_id": "LM-007",
        "requirement": "Consumer care contact details",
        "status": "REVIEW",
        "field": None,
        "value": None,
        "explanation": "Consumer-care information is not yet extracted as a dedicated field.",
        "legal_reference": "Rule 6, Legal Metrology (Packaged Commodities) Rules, 2011"
    })

    # -----------------------------------------
    # Overall status
    # -----------------------------------------

    statuses = [rule["status"] for rule in rules]

    if "FAIL" in statuses:
        overall_status = "FAIL"
    elif "REVIEW" in statuses:
        overall_status = "REVIEW"
    else:
        overall_status = "PASS"

    return {
        "overall_status": overall_status,
        "rules": rules
    }