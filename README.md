# Urban Vista Company P.O. Extractor

By: FTLigot · © 2026 FTLigot. All rights reserved.

Upload purchase order PDFs (scanned or digital) and get each line item's
PO number, vendor, description, unit and unit rate, with CSV export.
Everything runs in the browser; PDFs are never uploaded anywhere.

## Files
- `index.html` – the app
- `po-parser.js` – reads PO numbers, vendors and line items from the text
- `lib/` – PDF reader (pdf.js)
- `tessdata/` – English OCR model for scanned PDFs
- `brand/` – Urban Vista logo

The OCR engine itself loads from cdn.jsdelivr.net, so users need internet access.
