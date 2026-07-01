# Birbal's MarkItDown 🪄

**Drag a file. Get Markdown. That's it.**

A tiny local macOS app that turns PDFs, Word docs, PowerPoints, spreadsheets, and more into clean Markdown — right on your machine. Wraps Microsoft's [`markitdown`](https://github.com/microsoft/markitdown) behind a friendly drag-and-drop web UI.

> No installation. No cloud. No account. Your files never leave your Mac.

---

## ✨ Features

- **Drag & drop** files in the browser — instant conversion
- **10+ formats** supported: PDF, DOCX, PPTX, XLSX, CSV, HTML, EPUB, JSON, XML, TXT, MD
- **Batch mode** — drop up to 50 files at once, download all as a ZIP
- **100% local** — server binds to `127.0.0.1` only, nothing goes to the internet
- **Zero setup** — double-click one file and you're done
- **Streaming progress** via server-sent events, so you see each file finish live

---

## 🚀 Quick Start

1. **Double-click `MarkItDown.command`**
   *(First time only: macOS may block it. Right-click → **Open** → **Open**.)*

2. A Terminal window opens, then your browser opens to the app automatically.

3. **Drag files onto the page** (or click "Choose files").

4. Each file converts to Markdown. Click the ⬇️ button per file, or **Download all (ZIP)** if you converted several.

5. **To quit:** just close the Terminal window. The app shuts down cleanly.

---

## 📦 What's in the Box

| File / Folder | What it is |
|---|---|
| `MarkItDown.command` | Double-click launcher (the only thing users need) |
| `server/server.py` | FastAPI backend — handles uploads, conversion, downloads |
| `web/` | Frontend (`index.html`, `app.js`, `style.css`) — vanilla HTML/JS, no build step |
| `build/` | PyInstaller output (for distributing a standalone bundle) |
| `pyproject.toml` | Python dependencies |
| `uv.lock` | Locked dependency versions |

---

## 📄 Supported Formats

| Input | Output |
|---|---|
| PDF, DOCX, PPTX, XLSX, CSV, HTML, EPUB, JSON, XML, TXT, MD | `.md` |

Powered by [Microsoft markitdown](https://github.com/microsoft/markitdown) with the `pdf`, `docx`, `pptx`, `xlsx`, `outlook` extras enabled.

---

## 🔒 Privacy & Limits

- **Local only** — server listens on `127.0.0.1`, never exposed to the network
- **No telemetry, no accounts, no cloud calls**
- **Hard caps:** 50 files per batch, 500 MB per file
- **Temp cleanup:** converted files auto-purged after 1 hour, or when you close the app

---

## 🛠 Developer Setup (optional)

You only need this if you want to hack on the code. End users just double-click the `.command` file.

**Requirements:** Python 3.11 or 3.12, [`uv`](https://github.com/astral-sh/uv).

```bash
# clone
git clone <this-repo>
cd markitdown-desktop

# install deps into a local venv
uv sync

# run the server directly
uv run python server/server.py
```

The launcher script (`MarkItDown.command`) handles the venv, port picking, and browser opening for you.

### Build a standalone bundle

```bash
uv sync --extra build
uv run pyinstaller ...   # see build/ for the config used
```

---

## 🧰 Tech Stack

- **Backend:** FastAPI + Uvicorn + [sse-starlette](https://github.com/sysid/sse-starlette) (streaming progress)
- **Converter:** [markitdown](https://github.com/microsoft/markitdown) by Microsoft
- **Frontend:** Vanilla HTML / CSS / JavaScript — no framework, no build step
- **Packaging:** [PyInstaller](https://pyinstaller.org/) for standalone bundles
- **Dependency management:** [uv](https://github.com/astral-sh/uv)

---

## 🩹 Troubleshooting

**"App can't be opened because it is from an unidentified developer"**
Right-click `MarkItDown.command` → **Open** → **Open**. Only needed the first time.

**"Port already in use" in Terminal**
Close the existing Terminal window running the app, then double-click `MarkItDown.command` again.

**Browser didn't open**
Copy the `http://127.0.0.1:...` URL printed in the Terminal window and paste it into your browser.

**A file failed to convert**
Check the error message next to the file in the UI. Some malformed or password-protected PDFs/DOCX can't be parsed by `markitdown`.

---

## 📜 License

MIT — do whatever you want with it. Attribution appreciated.

---

Made with 🪄 by Birbal.
