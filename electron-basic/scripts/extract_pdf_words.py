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
        page_width = page.rect.width
        page_height = page.rect.height

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
            x0, y0, x1, y1, text, block_n, line_n, word_n = w

            rel_y = y0 / page_height
            rel_x = x0 / page_width
            rel_x_end = x1 / page_width
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

            words.append({
                'text': text,
                'x': (x0 / page_width) * 100,
                'y': (y0 / page_height) * 100,
                'w': ((x1 - x0) / page_width) * 100,
                'h': ((y1 - y0) / page_height) * 100
            })

        # Sort words by reading order
        words.sort(key=lambda w: (w['y'], w['x']))

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
                        'h': word['h']
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
