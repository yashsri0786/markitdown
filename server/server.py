"""MarkItDown Desktop — local FastAPI server.

Binds 127.0.0.1 only. Wraps Microsoft markitdown. Sequential per-job processing.
Cleans up temp files on shutdown and via 1-hour TTL sweep.
"""
from __future__ import annotations

import argparse
import socket
import sys


def _find_free_port() -> int:
    for _ in range(8):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.bind(("127.0.0.1", 0))
            return s.getsockname()[1]
    raise RuntimeError("Could not find a free port.")


# Fast path: --print-port should not import heavy deps.
# Lets the launcher pick a port even before `uv sync` succeeds.
if __name__ == "__main__" and "--print-port" in sys.argv:
    print(_find_free_port())
    sys.exit(0)


import asyncio
import io
import json
import logging
import os
import shutil
import tempfile
import time
import uuid
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from fastapi import BackgroundTasks, FastAPI, HTTPException, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response
from sse_starlette.sse import EventSourceResponse
from starlette.staticfiles import StaticFiles

from markitdown import MarkItDown

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
MAX_FILES_PER_JOB = 50
MAX_FILE_BYTES = 500 * 1024 * 1024  # 500 MB
JOB_TTL_SECONDS = 60 * 60  # 1 hour

# Resolve web/ dir whether running from source or from PyInstaller bundle.
def _resolve_web_dir() -> Path:
    # PyInstaller stores _MEIPASS for onefile; for onedir, files sit next to exe.
    if hasattr(sys, "_MEIPASS"):
        candidate = Path(sys._MEIPASS) / "web"
        if candidate.exists():
            return candidate
    # When packaged onedir, server binary lives in runtime/, web/ is sibling of runtime/.
    exe_dir = Path(getattr(sys, "executable", __file__)).resolve().parent
    sibling = exe_dir.parent / "web"
    if sibling.exists():
        return sibling
    # Dev: server/ is sibling of web/
    dev = Path(__file__).resolve().parent.parent / "web"
    return dev


WEB_DIR = _resolve_web_dir()
TEMP_ROOT = Path(tempfile.gettempdir()) / "markitdown-desktop"
TEMP_ROOT.mkdir(parents=True, exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] %(levelname)s %(message)s",
)
log = logging.getLogger("markitdown-desktop")


# ---------------------------------------------------------------------------
# Job model
# ---------------------------------------------------------------------------
@dataclass
class JobFile:
    file_id: str
    filename: str
    status: str = "queued"  # queued | converting | done | error
    md_path: Path | None = None
    error: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "file_id": self.file_id,
            "filename": self.filename,
            "status": self.status,
            "error": self.error,
        }


@dataclass
class Job:
    job_id: str
    temp_dir: Path
    created_at: float = field(default_factory=time.time)
    files: list[JobFile] = field(default_factory=list)
    queue: asyncio.Queue = field(default_factory=asyncio.Queue)
    finished: bool = False

    def all_terminal(self) -> bool:
        return all(f.status in ("done", "error") for f in self.files)


JOBS: dict[str, Job] = {}
JOBS_LOCK = asyncio.Lock()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _sweep_stale_jobs() -> None:
    """Delete temp dirs for jobs older than TTL."""
    now = time.time()
    stale_ids: list[str] = []
    for jid, job in JOBS.items():
        if now - job.created_at > JOB_TTL_SECONDS:
            stale_ids.append(jid)
    for jid in stale_ids:
        job = JOBS.pop(jid, None)
        if job is not None:
            shutil.rmtree(job.temp_dir, ignore_errors=True)
            log.info("swept stale job %s", jid)


def _safe_md_filename(original: str) -> str:
    stem = Path(original).stem.strip() or "converted"
    # strip path separators just in case
    stem = stem.replace("/", "_").replace("\\", "_")
    return f"{stem}.md"


def _convert_file_sync(input_path: Path, md_out_path: Path) -> None:
    """Synchronous markitdown call. Raises on error."""
    md = MarkItDown(enable_plugins=False)
    result = md.convert(str(input_path))
    text = result.text_content or ""
    md_out_path.write_text(text, encoding="utf-8")


async def _process_job(job: Job) -> None:
    """Process every file in a job sequentially, emitting SSE events."""
    loop = asyncio.get_running_loop()
    for jf in job.files:
        jf.status = "converting"
        await job.queue.put(jf.to_dict())
        try:
            input_path = job.temp_dir / f"{jf.file_id}__{jf.filename}"
            md_path = job.temp_dir / f"{jf.file_id}.md"
            await loop.run_in_executor(None, _convert_file_sync, input_path, md_path)
            jf.md_path = md_path
            jf.status = "done"
        except Exception as exc:  # noqa: BLE001 — bubble all converter errors as user-visible
            log.exception("conversion failed for %s", jf.filename)
            jf.status = "error"
            jf.error = f"{type(exc).__name__}: {exc}"
        await job.queue.put(jf.to_dict())
    job.finished = True
    await job.queue.put({"event": "__done__"})


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------
app = FastAPI(title="Birbal's MarkItDown Desktop", docs_url=None, redoc_url=None)

if (WEB_DIR / "static").exists():
    # not used currently — kept in case of future split
    app.mount("/static", StaticFiles(directory=WEB_DIR / "static"), name="static")


@app.get("/", response_class=HTMLResponse)
async def index() -> HTMLResponse:
    html = (WEB_DIR / "index.html").read_text(encoding="utf-8")
    return HTMLResponse(html)


@app.get("/app.js")
async def app_js() -> FileResponse:
    return FileResponse(WEB_DIR / "app.js", media_type="application/javascript")


@app.get("/style.css")
async def style_css() -> FileResponse:
    return FileResponse(WEB_DIR / "style.css", media_type="text/css")


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/convert")
async def convert(
    files: list[UploadFile],
    background: BackgroundTasks,
) -> JSONResponse:
    if not files:
        raise HTTPException(status_code=400, detail="No files uploaded.")
    if len(files) > MAX_FILES_PER_JOB:
        raise HTTPException(
            status_code=400,
            detail=f"Max {MAX_FILES_PER_JOB} files per batch (got {len(files)}).",
        )

    _sweep_stale_jobs()

    job_id = uuid.uuid4().hex
    temp_dir = TEMP_ROOT / job_id
    temp_dir.mkdir(parents=True, exist_ok=True)
    job = Job(job_id=job_id, temp_dir=temp_dir)

    for upload in files:
        file_id = uuid.uuid4().hex[:12]
        # Read with size guard.
        contents = await upload.read()
        if len(contents) > MAX_FILE_BYTES:
            raise HTTPException(
                status_code=400,
                detail=f"File too large: {upload.filename} (max {MAX_FILE_BYTES // (1024*1024)} MB).",
            )
        safe_name = (upload.filename or "untitled").replace("/", "_").replace("\\", "_")
        dest = temp_dir / f"{file_id}__{safe_name}"
        dest.write_bytes(contents)
        job.files.append(JobFile(file_id=file_id, filename=safe_name))

    async with JOBS_LOCK:
        JOBS[job_id] = job

    background.add_task(_run_job_task, job_id)

    return JSONResponse(
        {
            "job_id": job_id,
            "files": [
                {"file_id": f.file_id, "filename": f.filename, "status": f.status}
                for f in job.files
            ],
        }
    )


async def _run_job_task(job_id: str) -> None:
    job = JOBS.get(job_id)
    if job is None:
        return
    try:
        await _process_job(job)
    except Exception:  # noqa: BLE001
        log.exception("job %s crashed", job_id)


@app.get("/status/{job_id}")
async def status(job_id: str) -> EventSourceResponse:
    job = JOBS.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Unknown job.")

    async def event_gen():
        # Emit initial snapshot so reconnecting clients aren't blank.
        yield {"event": "snapshot", "data": json.dumps([f.to_dict() for f in job.files])}
        while True:
            try:
                item = await asyncio.wait_for(job.queue.get(), timeout=30.0)
            except asyncio.TimeoutError:
                # Keep-alive ping
                yield {"event": "ping", "data": "{}"}
                if job.finished:
                    break
                continue
            if isinstance(item, dict) and item.get("event") == "__done__":
                yield {"event": "done", "data": "{}"}
                break
            yield {"event": "update", "data": json.dumps(item)}

    return EventSourceResponse(event_gen())


@app.get("/download/{job_id}/all.zip")
async def download_all(job_id: str) -> Response:
    job = JOBS.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Unknown job.")
    done_files = [f for f in job.files if f.status == "done" and f.md_path is not None]
    if len(done_files) < 2:
        raise HTTPException(
            status_code=400,
            detail="ZIP download requires at least 2 successful conversions.",
        )
    # Avoid duplicate names by suffixing collisions.
    used: dict[str, int] = {}
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for jf in done_files:
            name = _safe_md_filename(jf.filename)
            if name in used:
                used[name] += 1
                stem, ext = os.path.splitext(name)
                name = f"{stem}__{used[name]}{ext}"
            else:
                used[name] = 0
            zf.writestr(name, jf.md_path.read_text(encoding="utf-8"))
    buf.seek(0)
    return Response(
        content=buf.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="markdown.zip"'},
    )


@app.get("/download/{job_id}/{file_id}")
async def download_one(job_id: str, file_id: str) -> FileResponse:
    job = JOBS.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Unknown job.")
    jf = next((f for f in job.files if f.file_id == file_id), None)
    if jf is None or jf.status != "done" or jf.md_path is None:
        raise HTTPException(status_code=404, detail="File not ready.")
    return FileResponse(
        jf.md_path,
        media_type="text/markdown",
        filename=_safe_md_filename(jf.filename),
    )


@app.delete("/job/{job_id}")
async def delete_job(job_id: str) -> dict[str, str]:
    job = JOBS.pop(job_id, None)
    if job is not None:
        shutil.rmtree(job.temp_dir, ignore_errors=True)
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=0, help="Port (0 = auto)")
    args = parser.parse_args()

    port = args.port or _find_free_port()

    log.info("Birbal's MarkItDown Desktop starting on http://127.0.0.1:%d", port)
    log.info("Web dir: %s", WEB_DIR)
    import uvicorn

    uvicorn.run(
        app,
        host="127.0.0.1",
        port=port,
        log_level="info",
        access_log=False,
    )


if __name__ == "__main__":
    try:
        main()
    finally:
        # Best-effort cleanup of all temp dirs on exit.
        for jid, job in list(JOBS.items()):
            shutil.rmtree(job.temp_dir, ignore_errors=True)
