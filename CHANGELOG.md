# Clara Changelog

## Latest Update - TOC Extraction Overhaul

### What Changed

Fixed critical bug where all chapters were being tagged to the Table of Contents page instead of their actual locations.

**Example of the bug:**
- PDF has TOC on page 5 listing "Chapter 1 ... 15", "Chapter 2 ... 28"
- Before: All chapters tagged to page 5
- After: Chapter 1 correctly tagged to page 15, Chapter 2 to page 28

### How It Works Now

Clara tries 3 different methods to extract the table of contents, using whichever works best:

1. **Native PDF TOC** (best) - Reads built-in navigation from PDF metadata
2. **TOC Page Parsing** (second best) - Finds the TOC page and extracts real page numbers
3. **Font Analysis** (fallback) - Analyzes text size and formatting to find headings

### What PDFs Does It Support?

Works with virtually any PDF:
- Textbooks (e.g., "Machine Learning for Dummies")
- Academic papers
- Novels
- Technical manuals
- Corporate reports
- O'Reilly books
- Short or long documents

### New Features

- Supports 13+ different TOC format patterns
- Automatically adapts to each document's font sizes
- Combines results from multiple sources for best accuracy
- Fast: Shows initial TOC in under 0.5 seconds
- Caches results for instant loading next time

### Testing

Test the TOC extraction on any PDF:

```bash
python test_toc_extraction.py "path/to/your.pdf"
```

This will show you what Clara finds using each method.

### Technical Details

- Added ~800 lines of code
- 5 new extraction functions
- Multi-layer validation and deduplication
- Comprehensive error handling
- Detailed debug logging

### Files Changed

- `app.py` - Core TOC extraction logic
- `README.md` - Updated documentation
- `test_toc_extraction.py` - New testing script
- `install.sh` / `install.bat` - Installation scripts
- `requirements.txt` - Organized dependencies
- `static/js/app.js` - First-launch setup
- `static/js/modules/toc.js` - Progressive loading

### Previous Features (Already Working)

- Text-to-speech with word highlighting
- AI-powered Q&A
- PDF, TXT, and Markdown support
- Local LLM processing
- Dictionary lookup
- All data stored locally

---

For more details, see the comprehensive documentation in README.md.
