# New clean TOC extraction - to be integrated into app.py

def extract_clean_toc(doc):
    """Extract clean, hierarchical TOC by detecting document structure.

    Strategy:
    1. Find consistent headings at page tops
    2. Filter out body text, quotes, sentences
    3. Build hierarchy based on Parts and Chapters
    """
    import re

    total_pages = len(doc)
    candidates = []

    # Scan pages for headings
    for page_num in range(min(100, total_pages)):
        page = doc[page_num]
        blocks = page.get_text("dict", flags=fitz.TEXT_PRESERVE_WHITESPACE)["blocks"]

        page_height = page.rect.height

        for block in blocks:
            if "lines" not in block:
                continue

            for line in block["lines"]:
                y_pos = line["bbox"][1] / page_height

                # Must be in top 20% of page (where chapter titles appear)
                if y_pos < 0.07 or y_pos > 0.20:
                    continue

                text = ""
                max_size = 0
                for span in line["spans"]:
                    text += span["text"]
                    if span["size"] > max_size:
                        max_size = span["size"]

                text = text.strip()

                # Basic filters
                if len(text) < 5 or len(text) > 70:
                    continue
                if not text[0].isupper():
                    continue

                # Skip quotes, dialogue, and sentences
                if '"' in text or "'" in text or """ in text or """ in text:
                    continue
                if text.endswith(('.', '!', '?', ',', ';', ':')):
                    continue

                # Skip common non-heading patterns
                if re.match(r'^(page|figure|fig|table|the|a|and|but|in|on|at)\s', text, re.IGNORECASE):
                    continue

                # Parts - highest level
                if re.match(r'^Part\s+(\d+|[IVX]+)', text, re.IGNORECASE):
                    candidates.append(('part', page_num, text, max_size, y_pos))
                    break

                # Chapters (explicit "Chapter X")
                if re.match(r'^Chapter\s+(\d+|[IVX]+)', text, re.IGNORECASE):
                    candidates.append(('chapter', page_num, text, max_size, y_pos))
                    break

                # Numbered sections (1. Introduction, 1.1 Background)
                if re.match(r'^\d+\.(\d+\.)*\s+[A-Z]', text):
                    candidates.append(('numbered', page_num, text, max_size, y_pos))
                    break

                # Research paper sections
                research_keywords = ['abstract', 'introduction', 'background', 'methodology',
                                    'methods', 'results', 'discussion', 'conclusion', 'references']
                if text.lower() in research_keywords:
                    candidates.append(('research', page_num, text.title(), max_size, y_pos))
                    break

                # Potential chapter titles (medium-large font, at page tops)
                if max_size >= 11.5:
                    words = text.split()
                    # Must be reasonably short (not a paragraph)
                    if len(words) <= 10:
                        candidates.append(('heading', page_num, text, max_size, y_pos))
                        break  # Only first heading per page

    # Filter headings by consistent size
    headings = [(p, t, s) for typ, p, t, s, y in candidates if typ == 'heading']
    if headings:
        sizes = [s for _, _, s in headings]
        avg_size = sum(sizes) / len(sizes)
        threshold = avg_size - 0.5
        filtered_headings = [(p, t) for p, t, s in headings if s >= threshold]
    else:
        filtered_headings = []

    # Build final TOC with proper levels
    toc = []

    # Add Parts (level 1)
    for typ, page, text, size, y in candidates:
        if typ == 'part':
            toc.append({'level': 1, 'title': text, 'page': page, 'y_position': y})

    # Add Chapters (level 2)
    for typ, page, text, size, y in candidates:
        if typ == 'chapter':
            toc.append({'level': 2, 'title': text, 'page': page, 'y_position': y})

    # Add numbered sections (level based on depth)
    for typ, page, text, size, y in candidates:
        if typ == 'numbered':
            # Count dots to determine level
            dots = text.split()[0].count('.')
            level = min(dots + 1, 4)
            toc.append({'level': level, 'title': text, 'page': page, 'y_position': y})

    # Add research sections (level 1)
    for typ, page, text, size, y in candidates:
        if typ == 'research':
            toc.append({'level': 1, 'title': text, 'page': page, 'y_position': y})

    # Add filtered headings (level 2 if Parts exist, level 1 otherwise)
    has_parts = any(item['level'] == 1 and 'Part' in item['title'] for item in toc)
    heading_level = 2 if has_parts else 1

    for page, text in filtered_headings:
        toc.append({'level': heading_level, 'title': text, 'page': page, 'y_position': 0.15})

    # Sort by page number
    toc.sort(key=lambda x: (x['page'], x['y_position']))

    # Remove duplicates
    seen = set()
    unique_toc = []
    for item in toc:
        key = (item['title'].lower(), item['page'])
        if key not in seen:
            seen.add(key)
            unique_toc.append(item)

    return unique_toc
