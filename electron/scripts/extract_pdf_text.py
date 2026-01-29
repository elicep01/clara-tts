#!/usr/bin/env python3
"""
Extract text from specific PDF page using PyMuPDF
"""
import sys
import json
import fitz  # PyMuPDF

def extract_text(pdf_path, page_num):
    """Extract text from specific PDF page"""
    try:
        doc = fitz.open(pdf_path)

        if page_num >= doc.page_count:
            return {"error": f"Page {page_num} not found (total pages: {doc.page_count})"}

        page = doc.load_page(page_num)

        # Extract text from this specific page
        text = page.get_text()

        doc.close()

        return {"text": text}

    except Exception as e:
        return {"error": str(e)}

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(json.dumps({"error": "Usage: extract_pdf_text.py <pdf_path> <page_num>"}))
        sys.exit(1)

    pdf_path = sys.argv[1]
    page_num = int(sys.argv[2])

    result = extract_text(pdf_path, page_num)
    print(json.dumps(result))
