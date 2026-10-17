const $ = (id) => document.getElementById(id);

const state = {
  templates: [],
  selected: null,
  images: [],
  dirHandle: null,
  rendering: false,
};

function setStatus(text, kind = '') {
  const el = $('status');
  el.textContent = text;
  el.className = 'status' + (kind ? ' ' + kind : '');
}

function fail(message) {
  console.error('[FastVideo] ' + message);
  setStatus(message, 'err');
}

// ---------- settings (persist) ----------

const LS_KEY = 'fastvideo.settings';

function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY)) || {};
  } catch {
    return {};
  }
}

function saveSetting(key, value) {
  const s = loadSettings();
  s[key] = value;
  localStorage.setItem(LS_KEY, JSON.stringify(s));
}

// ---------- output folder (persist) ----------

const IDB_NAME = 'fastvideo';
const IDB_STORE = 'handles';

function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key, value) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGet(key) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const req = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ---------- templates ----------

async function loadTemplates() {
  const res = await fetch('/api/templates');
  const data = await res.json();
  state.templates = data.templates;
  if (state.selected && !state.templates.some((t) => t.name === state.selected)) {
    state.selected = null;
  }
  renderTemplates();
}

function renderTemplates() {
  const box = $('templateList');
  box.innerHTML = '';

  if (!state.templates.length) {
    box.innerHTML = '<p style="color:#8b93a1;grid-column:1/-1">Chưa có video mẫu nào. Bấm “+ Thêm video mẫu”.</p>';
    return;
  }

  for (const t of state.templates) {
    const card = document.createElement('div');
    card.className = 'card' + (t.name === state.selected ? ' active' : '');
    card.innerHTML = `
      <video src="${t.url}" muted loop playsinline preload="metadata"></video>
      <div class="name">${escapeHtml(t.name)}</div>
      <button class="del" title="Xoá">&times;</button>
    `;
    const vid = card.querySelector('video');
    vid.addEventListener('mouseenter', () => vid.play().catch(() => {}));
    vid.addEventListener('mouseleave', () => { vid.pause(); vid.currentTime = 0; });

    card.addEventListener('click', (e) => {
      if (e.target.classList.contains('del')) return;
      state.selected = t.name;
      renderTemplates();
      setStatus(`Đã chọn: ${t.name}`);
    });

    card.querySelector('.del').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm(`Xoá video mẫu "${t.name}"?`)) return;
      await fetch('/api/templates/' + encodeURIComponent(t.name), { method: 'DELETE' });
      loadTemplates();
    });

    box.appendChild(card);
  }
}

$('uploadBtn').addEventListener('click', () => $('uploadInput').click());

$('uploadInput').addEventListener('change', async (e) => {
  const files = Array.from(e.target.files);
  if (!files.length) return;
  setStatus(`Đang thêm ${files.length} video...`);
  for (const f of files) {
    const fd = new FormData();
    fd.append('file', f);
    const res = await fetch('/api/templates', { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok) fail(data.error || `Lỗi upload: ${f.name}`);
  }
  e.target.value = '';
  setStatus('Đã thêm video mẫu', 'ok');
  loadTemplates();
});

// ---------- images ----------

const dropzone = $('dropzone');
const imageInput = $('imageInput');

dropzone.addEventListener('click', (e) => {
  if (e.target.closest('.thumb-remove')) return;
  imageInput.click();
});

['dragenter', 'dragover'].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropzone.classList.add('over');
  })
);
['dragleave', 'drop'].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropzone.classList.remove('over');
  })
);
dropzone.addEventListener('drop', (e) => {
  const files = Array.from(e.dataTransfer.files || []);
  if (files.length) addImages(files);
});

imageInput.addEventListener('change', (e) => {
  const files = Array.from(e.target.files);
  if (files.length) addImages(files);
  e.target.value = '';
});

function addImages(files) {
  const rejected = [];
  for (const f of files) {
    if (!f.type.startsWith('image/')) {
      rejected.push(`${f.name} (${f.type || 'không rõ type'})`);
      continue;
    }
    state.images.push(f);
  }
  renderImages();
  if (rejected.length) fail('Bỏ qua file không phải ảnh: ' + rejected.join(', '));
}

function removeImage(index) {
  state.images.splice(index, 1);
  renderImages();
}

function renderImages() {
  const box = $('imagePreview');
  const n = state.images.length;
  $('imageCount').textContent = n ? `${n} ảnh` : '';

  if (!n) {
    box.classList.add('hidden');
    box.innerHTML = '';
    return;
  }

  box.classList.remove('hidden');
  box.innerHTML = state.images
    .map((f, i) => `
      <div class="thumb">
        <img src="${URL.createObjectURL(f)}" alt="${escapeHtml(f.name)}" />
        <span class="thumb-name">${escapeHtml(f.name)}</span>
        <button class="thumb-remove" data-i="${i}" title="Bỏ ảnh này">&times;</button>
      </div>
    `)
    .join('');

  box.querySelectorAll('.thumb-remove').forEach((b) => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      removeImage(Number(b.dataset.i));
    });
  });
}

// ---------- output folder ----------

$('pickFolder').addEventListener('click', async () => {
  if (!('showDirectoryPicker' in window)) {
    return fail('Trình duyệt này không hỗ trợ chọn thư mục tự động. Hãy dùng Chrome hoặc Edge.');
  }
  try {
    state.dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
    await idbSet('outDir', state.dirHandle);
    $('folderName').value = state.dirHandle.name;
    setStatus(`Sẽ lưu video vào thư mục "${state.dirHandle.name}"`);
  } catch (err) {
    if (err.name !== 'AbortError') fail('Không chọn được thư mục: ' + err.message);
  }
});

async function restoreFolder() {
  let handle;
  try {
    handle = await idbGet('outDir');
  } catch {
    return;
  }
  if (!handle) return;

  const opts = { mode: 'readwrite' };
  if (typeof handle.queryPermission === 'function') {
    if ((await handle.queryPermission(opts)) !== 'granted' &&
        typeof handle.requestPermission === 'function') {
      if ((await handle.requestPermission(opts)) !== 'granted') {
        $('folderName').value = handle.name + ' (cần bấm lại để cấp quyền)';
        return;
      }
    }
  }

  state.dirHandle = handle;
  $('folderName').value = handle.name;
}

['fit', 'size'].forEach((id) => {
  $(id).addEventListener('change', () => saveSetting(id, $(id).value));
});

// ---------- render ----------

$('renderBtn').addEventListener('click', async () => {
  if (state.rendering) return fail('Đang render, đợi xong đã hãy bấm lại');

  const missing = [];
  if (!state.selected) missing.push('chưa chọn video mẫu');
  if (!state.images.length) missing.push('chưa chọn ảnh');
  if (missing.length) return fail('Không render được: ' + missing.join(' · '));

  const total = state.images.length;
  state.rendering = true;
  $('renderBtn').textContent = 'Đang render...';
  setStatus(`Đang render ${total} video...`);
  $('result').className = 'result';
  $('result').innerHTML = renderProgress(total, 0, []);

  const size = $('size').value;
  const [width, height] = size === 'auto' ? [null, null] : size.split('x').map(Number);

  const fd = new FormData();
  state.images.forEach((f, i) => fd.append('image' + i, f));
  fd.append('settings', JSON.stringify({
    template: state.selected,
    fit: $('fit').value,
    width,
    height,
  }));

  try {
    const res = await fetch('/api/render', { method: 'POST', body: fd });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status} ${res.statusText}`);
    if (!data.batchId) throw new Error('Server không trả về batch id');

    const items = await pollBatch(data.batchId, total);
    await saveAll(items);
  } catch (err) {
    fail(err.message);
    $('result').className = 'result empty';
    $('result').textContent = 'Lỗi: ' + err.message;
  } finally {
    state.rendering = false;
    $('renderBtn').textContent = 'Render video';
  }
});

async function pollBatch(batchId, total) {
  for (;;) {
    const res = await fetch('/api/batch/' + batchId);
    if (!res.ok) throw new Error(`Không đọc được trạng thái batch (HTTP ${res.status})`);
    const batch = await res.json();
    const finished = batch.done + batch.failed;

    $('result').innerHTML = renderProgress(
      total,
      finished,
      batch.items.map((it) => ({ name: it.source, status: it.status, error: it.error }))
    );

    if (finished === total) return batch.items;
    await new Promise((r) => setTimeout(r, 600));
  }
}

function renderProgress(total, finished, items) {
  const pct = total ? Math.round((finished / total) * 100) : 0;
  const rows = items
    .map((it) => {
      const icon = it.status === 'done' ? '&#10003;' : it.status === 'failed' ? '&#10007;' : '&#8230;';
      const cls = it.status === 'done' ? 'ok' : it.status === 'failed' ? 'err' : 'wait';
      return `<li class="${cls}"><span class="mark">${icon}</span><span class="nm">${escapeHtml(it.name)}</span></li>`;
    })
    .join('');

  return `
    <div class="prog">
      <div class="prog-head"><strong>${finished}/${total}</strong> video</div>
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
    </div>
    <ul class="list">${rows}</ul>
    <div id="saveBar"></div>
  `;
}

async function saveAll(items) {
  const ok = items.filter((i) => i.status === 'done');
  const bad = items.filter((i) => i.status === 'failed');

  const rows = items
    .map((i) => {
      const err = i.error ? `<span class="err-text">${escapeHtml(i.error.split('\n')[0])}</span>` : '';
      return `<li class="${i.status === 'done' ? 'ok' : 'err'}"><span class="nm">${escapeHtml(i.outName)}</span>${err}</li>`;
    })
    .join('');

  let saved = 0;
  let saveNote = '';

  if (!state.dirHandle) {
    saveNote = `<p class="hint">Chưa chọn thư mục lưu — video vẫn nằm trong <code>output/</code>. Bấm “Chọn thư mục” rồi render lại để lưu tự động.</p>`;
  } else {
    $('saveBar').innerHTML = `<p class="hint">Đang lưu vào "${state.dirHandle.name}"... 0/${ok.length}</p>`;
    for (let i = 0; i < ok.length; i++) {
      const it = ok[i];
      try {
        await writeToFolder(it.url, it.outName);
        saved++;
      } catch (err) {
        saveNote = `<p class="hint err">Không lưu được ${escapeHtml(it.outName)}: ${escapeHtml(err.message)}</p>`;
      }
      const bar = $('saveBar').firstElementChild;
      if (bar) bar.textContent = `Đang lưu vào "${state.dirHandle.name}"... ${saved}/${ok.length}`;
    }
    saveNote = `<p class="hint">&#10003; Đã lưu ${saved}/${ok.length} video vào thư mục "${state.dirHandle.name}"</p>`;
  }

  $('result').innerHTML = `
    <div class="prog">
      <div class="prog-head"><strong>${ok.length}/${items.length}</strong> video thành công${bad.length ? ` · ${bad.length} lỗi` : ''}</div>
      <div class="bar-track"><div class="bar-fill ${bad.length ? 'partial' : ''}" style="width:${items.length ? Math.round((ok.length / items.length) * 100) : 0}%"></div></div>
    </div>
    <ul class="list">${rows}</ul>
    ${saveNote}
  `;

  if (bad.length) {
    fail(`${bad.length}/${items.length} video lỗi — xem chi tiết bên dưới`);
  } else {
    setStatus(`Xong ${ok.length} video!`, 'ok');
  }
}

async function writeToFolder(url, name) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  const fileHandle = await state.dirHandle.getFileHandle(name, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

const saved = loadSettings();
if (saved.fit) $('fit').value = saved.fit;
if (saved.size) $('size').value = saved.size;

loadTemplates();
restoreFolder();