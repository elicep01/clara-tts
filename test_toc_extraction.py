#!/usr/bin/env python3
"""
Test script for Clara's TOC extraction functionality.

This script demonstrates the multi-source TOC extraction system
that works with any PDF document.

Usage:
    python test_toc_extraction.py <path_to_pdf>

Example:
    python test_toc_extraction.py "Machine Learning for Dummies.pdf"
"""

import sys
import os
from pathlib import Path

# Add current directory to path so we can import from app.py
sys.path.insert(0, str(Path(__file__).parent))

def test_toc_extraction(pdf_path):
    """Test TOC extraction on a PDF file."""

    print("=" * 80)
    print("Clara TOC Extraction Test")
    print("=" * 80)
    print()

    # Check if file exists
    if not os.path.exists(pdf_path):
        print(f"[ERROR] File not found: {pdf_path}")
        return False

    print(f"[INFO] Testing with file: {pdf_path}")
    print()

    # Import the extraction functions
    try:
        from app import (
            extract_native_pdf_toc,
            detect_and_parse_toc_page,
            extract_heuristic_toc_fast,
            extract_toc_multi_source,
            PYMUPDF_AVAILABLE
        )
    except ImportError as e:
        print(f"[ERROR] Failed to import from app.py: {e}")
        print("[INFO] Make sure you're running this from the clara_2 directory")
        return False

    if not PYMUPDF_AVAILABLE:
        print("[ERROR] PyMuPDF not available. Install with: pip install pymupdf")
        return False

    print("-" * 80)
    print("METHOD 1: Native PDF TOC Extraction")
    print("-" * 80)

    try:
        native_toc = extract_native_pdf_toc(pdf_path)
        if native_toc:
            print(f"[SUCCESS] Found {len(native_toc)} entries from native PDF TOC")
            for i, entry in enumerate(native_toc[:5], 1):
                print(f"  {i}. {entry['title']} → Page {entry['page'] + 1}")
            if len(native_toc) > 5:
                print(f"  ... and {len(native_toc) - 5} more entries")
        else:
            print("[INFO] No native TOC found (this is normal for many PDFs)")
    except Exception as e:
        print(f"[ERROR] Native extraction failed: {e}")

    print()
    print("-" * 80)
    print("METHOD 2: TOC Page Detection & Parsing")
    print("-" * 80)

    try:
        toc_page_entries = detect_and_parse_toc_page(pdf_path)
        if toc_page_entries:
            print(f"[SUCCESS] Found {len(toc_page_entries)} entries from TOC page")
            for i, entry in enumerate(toc_page_entries[:5], 1):
                print(f"  {i}. {entry['title']} → Page {entry['page'] + 1}")
            if len(toc_page_entries) > 5:
                print(f"  ... and {len(toc_page_entries) - 5} more entries")
        else:
            print("[INFO] No TOC page detected (trying other methods)")
    except Exception as e:
        print(f"[ERROR] TOC page parsing failed: {e}")

    print()
    print("-" * 80)
    print("METHOD 3: Font-Based Heuristic Analysis")
    print("-" * 80)

    try:
        heuristic_toc = extract_heuristic_toc_fast(pdf_path)
        if heuristic_toc:
            print(f"[SUCCESS] Found {len(heuristic_toc)} entries from heuristic analysis")
            for i, entry in enumerate(heuristic_toc[:5], 1):
                print(f"  {i}. {entry['title']} → Page {entry['page'] + 1}")
            if len(heuristic_toc) > 5:
                print(f"  ... and {len(heuristic_toc) - 5} more entries")
        else:
            print("[INFO] Heuristic analysis found no headings")
    except Exception as e:
        print(f"[ERROR] Heuristic extraction failed: {e}")

    print()
    print("=" * 80)
    print("FINAL RESULT: Multi-Source Intelligent Merging")
    print("=" * 80)

    try:
        final_toc = extract_toc_multi_source(pdf_path)
        if final_toc:
            print(f"[SUCCESS] Final TOC has {len(final_toc)} entries")
            print()
            print("Table of Contents:")
            print("-" * 80)

            for i, entry in enumerate(final_toc, 1):
                level = entry.get('level', 1)
                indent = "  " * (level - 1)
                source = entry.get('source', 'unknown')
                print(f"{i:3d}. {indent}{entry['title']}")
                print(f"      {indent}→ Page {entry['page'] + 1} (source: {source})")

            print()
            print("[SUCCESS] TOC extraction completed successfully!")
            return True
        else:
            print("[WARNING] No TOC found with any method")
            print("[INFO] This PDF may not have a structured TOC")
            return False

    except Exception as e:
        print(f"[ERROR] Multi-source extraction failed: {e}")
        import traceback
        traceback.print_exc()
        return False


def main():
    """Main entry point."""

    if len(sys.argv) != 2:
        print("Usage: python test_toc_extraction.py <path_to_pdf>")
        print()
        print("Example:")
        print('  python test_toc_extraction.py "Machine Learning for Dummies.pdf"')
        print()
        sys.exit(1)

    pdf_path = sys.argv[1]
    success = test_toc_extraction(pdf_path)

    print()
    print("=" * 80)
    if success:
        print("[✓] Test completed successfully")
    else:
        print("[✗] Test completed with warnings")
    print("=" * 80)

    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
