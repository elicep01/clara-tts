#!/usr/bin/env python3
"""
Standalone PDF word extraction script for Clara Electron app
Extracts exact word positions from PDF using PyMuPDF
"""
import sys
import json
import fitz  # PyMuPDF

def extract_words(pdf_path, page_num):
    """Extract words with exact bounding boxes from PDF page"""
    try:
        doc = fitz.open(pdf_path)

        if page_num >= doc.page_count:
            return {"error": f"Page {page_num} not found (total pages: {doc.page_count})"}

        page = doc.load_page(page_num)
        rotation = page.rotation

        # CRITICAL: page.rect gives UNROTATED dimensions
        # But get_text returns coords in ROTATED (displayed) space
        # We must use displayed dimensions for correct percentage calculation
        rect = page.rect
        page_width = rect.width
        page_height = rect.height

        # Swap dimensions for 90/270 rotation to match displayed size
        if rotation in (90, 270):
            page_width, page_height = page_height, page_width

        # Get CropBox - if different from MediaBox, coordinates need adjustment
        # For most PDFs, CropBox == MediaBox so no adjustment needed
        cropbox = page.cropbox
        mediabox = page.mediabox

        # Only adjust if CropBox differs from MediaBox (rare but important)
        crop_x0 = 0
        crop_y0 = 0
        if cropbox and mediabox and (cropbox.x0 != mediabox.x0 or cropbox.y0 != mediabox.y0):
            crop_x0 = cropbox.x0
            crop_y0 = cropbox.y0

        # Debug: Log page info to stderr (won't affect JSON output)
        import sys
        print(f"[PyMuPDF] Page {page_num}: rect={rect}, rotation={rotation}", file=sys.stderr)
        print(f"[PyMuPDF] Displayed dims: {page_width:.1f} x {page_height:.1f}, cropbox offset=({crop_x0:.1f}, {crop_y0:.1f})", file=sys.stderr)

        # Filtering constants (matching Python app exactly)
        TOP_MARGIN = 0.04
        BOTTOM_MARGIN = 0.94
        LEFT_MARGIN = 0.05
        RIGHT_MARGIN = 0.95
        MIN_FONT_HEIGHT = 5.5

        # Extract words with EXACT bounding boxes
        words_data = page.get_text("words")

        words = []
        import re
        word_regex = re.compile(r'^\d{1,4}$|^\[\d+[\d,\-e\s]*\]$|^\(\d{1,3}\)$')

        for w in words_data:
            x0, y0, x1, y1, text, *rest = w
            block_no = int(rest[0]) if len(rest) > 0 else -1
            line_no = int(rest[1]) if len(rest) > 1 else -1
            word_no = int(rest[2]) if len(rest) > 2 else -1

            # Adjust coordinates for CropBox offset if needed
            # PyMuPDF returns coordinates in MediaBox space, we need CropBox space
            if crop_x0 != 0 or crop_y0 != 0:
                x0 -= crop_x0
                y0 -= crop_y0
                x1 -= crop_x0
                y1 -= crop_y0

            rel_y = y0 / page_height if page_height > 0 else 0
            rel_x = x0 / page_width if page_width > 0 else 0
            rel_x_end = x1 / page_width if page_width > 0 else 0
            font_height = y1 - y0

            # Apply same filtering as main app
            if rel_y < TOP_MARGIN or rel_y > BOTTOM_MARGIN:
                continue
            if rel_x < LEFT_MARGIN or rel_x_end > RIGHT_MARGIN:
                continue
            if font_height < MIN_FONT_HEIGHT:
                continue
            if not text or not text.strip():
                continue

            # Skip page numbers and citations at edges
            if word_regex.match(text):
                if rel_y < 0.08 or rel_y > 0.92 or rel_x < 0.08 or rel_x > 0.92:
                    continue

            # Calculate percentages
            x_pct = (x0 / page_width) * 100
            y_pct = (y0 / page_height) * 100
            w_pct = ((x1 - x0) / page_width) * 100
            h_pct = ((y1 - y0) / page_height) * 100

            # Clamp values to valid range (0-100)
            x_pct = max(0, min(100 - w_pct, x_pct))
            y_pct = max(0, min(100 - h_pct, y_pct))

            words.append({
                'text': text,
                'x': x_pct,
                'y': y_pct,
                'w': w_pct,
                'h': h_pct,
                'block': block_no,
                'line': line_no,
                'word': word_no,
                'line_id': f"{block_no}:{line_no}" if block_no >= 0 and line_no >= 0 else None
            })

        # Sort words by explicit text layout order when available.
        # Fallback keeps previous behavior.
        words.sort(key=lambda w: (
            0 if w.get('block', -1) >= 0 and w.get('line', -1) >= 0 and w.get('word', -1) >= 0 else 1,
            w.get('block', 10**9),
            w.get('line', 10**9),
            w.get('word', 10**9),
            w['y'],
            w['x']
        ))

        # JOIN HYPHENATED WORDS (e.g., "busi-" + "ness" = "business")
        joined_words = []
        i = 0

        while i < len(words):
            word = words[i]

            # Check if word ends with hyphen
            if word['text'].endswith('-') and i + 1 < len(words):
                next_word = words[i + 1]

                # Check if next word is on a different line (y position changed significantly)
                is_different_line = abs(next_word['y'] - word['y']) > word['h'] * 0.5

                if is_different_line:
                    # Join the words: remove hyphen and combine
                    joined_words.append({
                        'text': word['text'][:-1] + next_word['text'],  # Remove hyphen
                        'x': word['x'],
                        'y': word['y'],
                        'w': word['w'],
                        'h': word['h'],
                        'block': word.get('block'),
                        'line': word.get('line'),
                        'word': word.get('word'),
                        'line_id': word.get('line_id')
                    })
                    i += 2  # Skip both words
                    continue

            # Not hyphenated or no continuation - keep as is
            joined_words.append(word)
            i += 1

        doc.close()

        return {"words": joined_words}

    except Exception as e:
        return {"error": str(e)}

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(json.dumps({"error": "Usage: extract_pdf_words.py <pdf_path> <page_num>"}))
        sys.exit(1)

    pdf_path = sys.argv[1]
    page_num = int(sys.argv[2])

    result = extract_words(pdf_path, page_num)
    print(json.dumps(result))
