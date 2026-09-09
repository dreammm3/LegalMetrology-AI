"""Regex-based field extraction from OCR text."""
import re

PATTERNS = {
    "MRP": r"(?:MRP|M\.?R\.?P\.?)[^0-9₹]{0,15}(?:RS\.?|₹|INR)?\s*([0-9]+(?:\.[0-9]{1,2})?)\b(?!\d)",
    "NET_QUANTITY": r"(?:NET\s*(?:QTY\.?|QUANTITY|WT\.?|WEIGHT|CONTENTS?)|NETW|NETWT|N\.?W\.?)\s*[:\-]?\s*([0-9]+(?:\.[0-9]+)?\s?(?:G|GM|GRAM|GRAMS|KG|MG|ML|L|LTR)\b)",
    "MFG_DATE": r"(?:MFG|MANUFACTURING|PKD|PACKED)\.?\s*(?:DATE|ON)?\s*[:\-]?\s*([0-3]?[0-9](?:[\/\-\.]|\s*)[A-Z]{3}(?:[\/\-\.]|\s*)[0-9]{2,4}|[0-3]?[0-9][\/\-\.][0-1]?[0-9][\/\-\.][0-9]{2,4})",
    "COUNTRY_OF_ORIGIN": r"(?:COUNTRY OF ORIGIN|MADE IN)\s*[:\-]?\s*([A-Z ]{3,20})",
    "MANUFACTURER": r"(?:MANUFACTURED\s*BY|MFD\.?\s*BY|MARKETED\s*BY|PACKED\s*BY)\s*[:\-]?\s*([A-Z][A-Za-z .,&]{3,50}(?:LTD|LIMITED|PVT|LLP|INC)?\.?)",
}

REQUIRED_FIELDS_BY_CATEGORY = {
    "PACKAGED_FOOD": ["MRP", "NET_QUANTITY", "MANUFACTURER", "MFG_DATE", "COUNTRY_OF_ORIGIN"],
}


def extract_declarations(text: str) -> dict:
    result = {}
    for field, pattern in PATTERNS.items():
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            result[field] = {"value": match.group(1).strip(), "state": "FOUND"}
        else:
            result[field] = {"value": None, "state": "MISSING"}
    return result


def required_fields_for_category(category: str) -> list:
    return REQUIRED_FIELDS_BY_CATEGORY.get(category, [])