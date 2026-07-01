Birbal's MarkItDown Desktop (macOS)
===================================

QUICK START
-----------

1. Double-click "MarkItDown.command"
   (First time: macOS may block it. Right-click → Open → Open.)

2. A Terminal window opens AND your browser opens to the app.

3. Drag files onto the page (or click "Choose files"). Supported:
   PDF, DOCX, PPTX, XLSX, CSV, HTML, EPUB, JSON, XML, TXT, MD.

4. Each file converts to Markdown. Click the download button per file.
   If you converted multiple files, you also get a "Download all (ZIP)" button.

5. To quit: close the Terminal window. The app shuts down cleanly.

NOTES
-----

* No installation needed — everything runs from this folder.
* The app only listens on 127.0.0.1 (your machine only). Not exposed to the network.
* Conversion happens locally. Your files never leave this machine.
* Hard caps: 50 files per batch, 500 MB per file.

TROUBLESHOOTING
---------------

"App can't be opened because it is from an unidentified developer"
  → Right-click MarkItDown.command → Open → Open (one time only).

"Port already in use" in Terminal
  → Close the existing Terminal window, then double-click again.

Browser didn't open
  → Manually visit the URL printed in the Terminal window.
