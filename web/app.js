// MarkItDown Desktop — playful UI controller.
// No framework. Vanilla JS. Reads from same-origin server.

(() => {
  'use strict';

  const MAX_FILES = 50;
  const MAX_BYTES = 500 * 1024 * 1024;

  // DOM
  const dropzone     = document.getElementById('dropzone');
  const fileInput    = document.getElementById('file-input');
  const filelistEl   = document.getElementById('filelist');
  const listSection  = document.getElementById('filelist-section');
  const downloadAll  = document.getElementById('download-all-btn');
  const clearBtn     = document.getElementById('clear-btn');
  const confettiCv   = document.getElementById('confetti-canvas');

  let activeJob = null;       // { jobId, files: Map<fileId, {filename, status, error}>, eventSource }
  let confettiRunner = null;  // animation handle

  // ---------------- drag/drop wiring ----------------
  ['dragenter', 'dragover'].forEach(evt => {
    dropzone.addEventListener(evt, e => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.add('is-dragover');
    });
    document.body.addEventListener(evt, e => {
      e.preventDefault();
    });
  });
  ['dragleave', 'drop'].forEach(evt => {
    dropzone.addEventListener(evt, e => {
      e.preventDefault();
      e.stopPropagation();
      if (evt === 'dragleave' && e.target !== dropzone) return;
      dropzone.classList.remove('is-dragover');
    });
  });
  dropzone.addEventListener('drop', e => {
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length) startJob(files);
  });
  dropzone.addEventListener('click', e => {
    // Avoid double-trigger when clicking the actual <label>
    if (e.target.closest('label')) return;
    fileInput.click();
  });
  dropzone.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInput.click();
    }
  });
  fileInput.addEventListener('change', () => {
    const files = Array.from(fileInput.files || []);
    if (files.length) startJob(files);
    fileInput.value = '';
  });

  clearBtn.addEventListener('click', () => {
    cleanupActiveJob({ deleteServer: true });
    renderEmpty();
  });

  downloadAll.addEventListener('click', () => {
    if (!activeJob) return;
    const a = document.createElement('a');
    a.href = `/download/${activeJob.jobId}/all.zip`;
    a.download = 'markdown.zip';
    document.body.appendChild(a);
    a.click();
    a.remove();
  });

  // ---------------- job lifecycle ----------------
  async function startJob(files) {
    if (activeJob) {
      cleanupActiveJob({ deleteServer: true });
    }
    if (files.length > MAX_FILES) {
      toast(`Max ${MAX_FILES} files per batch (you dropped ${files.length}).`, true);
      return;
    }
    const oversize = files.find(f => f.size > MAX_BYTES);
    if (oversize) {
      toast(`"${oversize.name}" is too big (max 500 MB).`, true);
      return;
    }

    // Optimistic UI: render queued state immediately.
    activeJob = {
      jobId: null,
      files: new Map(),
      eventSource: null,
    };
    const tempFiles = files.map((f, i) => ({
      file_id: `tmp-${i}`,
      filename: f.name,
      status: 'uploading',
      error: null,
    }));
    tempFiles.forEach(f => activeJob.files.set(f.file_id, f));
    renderList();
    showListLayout();

    const fd = new FormData();
    files.forEach(f => fd.append('files', f, f.name));

    let resp;
    try {
      resp = await fetch('/convert', { method: 'POST', body: fd });
    } catch (err) {
      toast('Could not reach the converter. Is the app still running?', true);
      cleanupActiveJob();
      renderEmpty();
      return;
    }
    if (!resp.ok) {
      const detail = await resp.json().catch(() => ({ detail: 'Unknown error' }));
      toast(`Upload rejected: ${detail.detail || resp.status}`, true);
      cleanupActiveJob();
      renderEmpty();
      return;
    }
    const data = await resp.json();
    activeJob.jobId = data.job_id;
    activeJob.files = new Map();
    data.files.forEach(f => {
      activeJob.files.set(f.file_id, { ...f, error: null });
    });
    renderList();
    openStatusStream();
  }

  function openStatusStream() {
    if (!activeJob || !activeJob.jobId) return;
    const es = new EventSource(`/status/${activeJob.jobId}`);
    activeJob.eventSource = es;

    es.addEventListener('snapshot', e => {
      try {
        const snap = JSON.parse(e.data);
        snap.forEach(f => activeJob.files.set(f.file_id, { ...f, error: f.error || null }));
        renderList();
      } catch {}
    });
    es.addEventListener('update', e => {
      try {
        const item = JSON.parse(e.data);
        activeJob.files.set(item.file_id, { ...item, error: item.error || null });
        renderList();
      } catch {}
    });
    es.addEventListener('done', () => {
      es.close();
      activeJob.eventSource = null;
      onJobComplete();
    });
    es.addEventListener('ping', () => { /* keep-alive */ });
    es.onerror = () => {
      // If finished, fine. Otherwise show warning.
      const allTerminal = [...activeJob.files.values()].every(f => f.status === 'done' || f.status === 'error');
      if (!allTerminal) {
        toast('Lost connection to converter. Try restarting the app.', true);
      }
      try { es.close(); } catch {}
      activeJob.eventSource = null;
    };
  }

  function onJobComplete() {
    if (!activeJob) return;
    const files = [...activeJob.files.values()];
    const doneCount = files.filter(f => f.status === 'done').length;
    const errCount = files.filter(f => f.status === 'error').length;
    if (doneCount >= 2) {
      downloadAll.classList.remove('hidden');
    } else {
      downloadAll.classList.add('hidden');
    }
    renderList();
    if (doneCount > 0) burstConfetti();
    if (doneCount === 0 && errCount > 0) {
      toast('No files converted successfully.', true);
    } else if (errCount > 0) {
      toast(`${doneCount} converted, ${errCount} failed.`);
    }
  }

  function cleanupActiveJob({ deleteServer = false } = {}) {
    if (!activeJob) return;
    try { activeJob.eventSource && activeJob.eventSource.close(); } catch {}
    if (deleteServer && activeJob.jobId) {
      fetch(`/job/${activeJob.jobId}`, { method: 'DELETE' }).catch(() => {});
    }
    activeJob = null;
    downloadAll.classList.add('hidden');
  }

  // ---------------- render ----------------
  function showListLayout() {
    listSection.classList.remove('hidden');
    clearBtn.classList.remove('hidden');
  }
  function renderEmpty() {
    listSection.classList.add('hidden');
    clearBtn.classList.add('hidden');
    downloadAll.classList.add('hidden');
    filelistEl.innerHTML = '';
  }
  function renderList() {
    if (!activeJob) return;
    const files = [...activeJob.files.values()];
    filelistEl.innerHTML = '';
    files.forEach(f => filelistEl.appendChild(renderRow(f)));
  }
  function renderRow(file) {
    const li = document.createElement('li');
    li.className = 'fileitem';
    li.dataset.fileId = file.file_id;

    const icon = document.createElement('div');
    icon.className = 'fileitem-icon';
    icon.textContent = iconFor(file.filename);

    const name = document.createElement('div');
    name.className = 'fileitem-name';
    name.textContent = file.filename;
    name.title = file.filename;

    const pill = document.createElement('span');
    pill.className = 'pill ' + pillClass(file.status);
    pill.appendChild(pillContent(file.status));

    li.appendChild(icon);
    li.appendChild(name);
    li.appendChild(pill);

    if (file.status === 'done') {
      const btn = document.createElement('button');
      btn.className = 'btn btn-row';
      btn.type = 'button';
      btn.textContent = '⬇️ .md';
      btn.addEventListener('click', () => {
        const a = document.createElement('a');
        a.href = `/download/${activeJob.jobId}/${file.file_id}`;
        a.download = file.filename.replace(/\.[^/.]+$/, '') + '.md';
        document.body.appendChild(a);
        a.click();
        a.remove();
        btn.classList.add('is-downloaded');
        btn.textContent = '✓ saved';
      });
      li.appendChild(btn);
    } else {
      const slot = document.createElement('span');
      li.appendChild(slot);
    }

    if (file.status === 'error' && file.error) {
      const err = document.createElement('span');
      err.className = 'error-detail';
      err.textContent = file.error;
      err.title = file.error;
      li.appendChild(err);
    }
    return li;
  }
  function pillContent(status) {
    if (status === 'converting') {
      const wrap = document.createDocumentFragment();
      const planeTrack = document.createElement('span');
      planeTrack.className = 'plane-track';
      planeTrack.innerHTML = '<span class="plane">✈️</span>';
      wrap.appendChild(planeTrack);
      const txt = document.createElement('span');
      txt.textContent = 'converting…';
      wrap.appendChild(txt);
      return wrap;
    }
    if (status === 'uploading') return document.createTextNode('uploading…');
    if (status === 'queued')    return document.createTextNode('queued');
    if (status === 'done')      return document.createTextNode('✓ done');
    if (status === 'error')     return document.createTextNode('✗ error');
    return document.createTextNode(status);
  }
  function pillClass(status) {
    return {
      queued: 'pill-queued',
      uploading: 'pill-queued',
      converting: 'pill-converting',
      done: 'pill-done',
      error: 'pill-error',
    }[status] || 'pill-queued';
  }
  function iconFor(name) {
    const ext = (name.split('.').pop() || '').toLowerCase();
    return {
      pdf:  '📕',
      docx: '📘', doc: '📘',
      pptx: '📙', ppt: '📙',
      xlsx: '📗', xls: '📗', csv: '📗',
      html: '🌐', htm: '🌐',
      epub: '📚',
      json: '🗂️', xml: '🗂️',
      txt: '📄', md: '📄',
    }[ext] || '📄';
  }

  // ---------------- toast ----------------
  let toastTimer = null;
  function toast(message, isError = false) {
    let el = document.querySelector('.toast');
    if (!el) {
      el = document.createElement('div');
      el.className = 'toast';
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.classList.toggle('is-error', !!isError);
    el.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('is-visible'), 3500);
  }

  // ---------------- confetti (hand-rolled, ~30 lines) ----------------
  function burstConfetti() {
    if (confettiRunner) cancelAnimationFrame(confettiRunner);
    const ctx = confettiCv.getContext('2d');
    confettiCv.width = window.innerWidth;
    confettiCv.height = window.innerHeight;
    const colors = ['#ff6ec7', '#6ee7ff', '#ffd56e', '#6effb4', '#b46eff'];
    const N = 140;
    const pieces = Array.from({ length: N }, () => ({
      x: confettiCv.width / 2 + (Math.random() - 0.5) * 80,
      y: confettiCv.height * 0.4,
      vx: (Math.random() - 0.5) * 12,
      vy: -Math.random() * 14 - 4,
      g: 0.35 + Math.random() * 0.15,
      size: 6 + Math.random() * 6,
      rot: Math.random() * Math.PI * 2,
      vr: (Math.random() - 0.5) * 0.3,
      color: colors[Math.floor(Math.random() * colors.length)],
      life: 0,
    }));
    const maxLife = 130;
    function frame() {
      ctx.clearRect(0, 0, confettiCv.width, confettiCv.height);
      let alive = false;
      pieces.forEach(p => {
        p.life++;
        if (p.life > maxLife) return;
        alive = true;
        p.vy += p.g;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = Math.max(0, 1 - p.life / maxLife);
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.5);
        ctx.restore();
      });
      if (alive) {
        confettiRunner = requestAnimationFrame(frame);
      } else {
        ctx.clearRect(0, 0, confettiCv.width, confettiCv.height);
        confettiRunner = null;
      }
    }
    confettiRunner = requestAnimationFrame(frame);
  }

  // Initial state
  renderEmpty();
})();
