const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const ROOT = __dirname;
const LIB_DIR = path.join(ROOT, 'templates');
const WORK_DIR = path.join(ROOT, 'output');
const PORT = Number(process.env.PORT || 3000);

for (const d of [LIB_DIR, WORK_DIR]) fs.mkdirSync(d, { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.svg': 'image/svg+xml',
};

const VIDEO_EXT = new Set(['.mp4', '.webm', '.mov', '.mkv', '.m4v']);
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp']);

function send(res, code, body, headers = {}) {
  res.writeHead(code, { 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}

function json(res, code, obj) {
  send(res, code, JSON.stringify(obj), { 'Content-Type': MIME['.json'] });
}

function sendFile(res, filePath, req) {
  const ext = path.extname(filePath).toLowerCase();
  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain' });
    const type = MIME[ext] || 'application/octet-stream';
    const range = req.headers.range;
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      if (m) {
        const start = m[1] ? Number(m[1]) : 0;
        const end = m[2] ? Number(m[2]) : st.size - 1;
        if (start >= st.size) {
          return send(res, 416, '', { 'Content-Range': `bytes */${st.size}` });
        }
        res.writeHead(206, {
          'Content-Type': type,
          'Content-Range': `bytes ${start}-${end}/${st.size}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': end - start + 1,
        });
        return fs.createReadStream(filePath, { start, end }).pipe(res);
      }
    }
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': st.size,
      'Accept-Ranges': 'bytes',
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

function ffprobe(file) {
  return new Promise((resolve, reject) => {
    const p = spawn('ffprobe', [
      '-v', 'error',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      file,
    ]);
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(JSON.parse(out)) : reject(new Error(err || 'ffprobe failed'))));
  });
}

function probeSummary(file) {
  return ffprobe(file).then((info) => {
    const v = (info.streams || []).find((s) => s.codec_type === 'video');
    const a = (info.streams || []).find((s) => s.codec_type === 'audio');
    const num = (s) => {
      if (s === undefined || s === null || s === '' || s === 'N/A') return null;
      const [n, d] = String(s).split('/').map(Number);
      if (Number.isNaN(n)) return null;
      return d ? Math.round((n / d) * 100) / 100 : Math.round(n * 100) / 100;
    };
    return {
      width: v ? v.width : null,
      height: v ? v.height : null,
      fps: num(v && v.avg_frame_rate) || num(v && v.r_frame_rate),
      duration: num(info.format && info.format.duration),
      hasAudio: Boolean(a),
      hasVideo: Boolean(v),
    };
  });
}

function render(job) {
  const { id, template, image, crop } = job;
  const inputVideo = path.join(LIB_DIR, template);
  const inputImage = path.join(WORK_DIR, image);
  const outputVideo = path.join(WORK_DIR, `${id}.mp4`);
  const { w, h, fps, fit } = crop;

  let graph;
  if (fit === 'blur') {
    graph =
      '[0:v]split=2[bg][fg];' +
      `[bg]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},boxblur=luma_radius=24:luma_power=2[bgb];` +
      `[fg]scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2[fgc];` +
      '[bgb][fgc]overlay=shortest=1,setsar=1,format=yuv420p[outv]';
  } else if (fit === 'contain') {
    graph =
      `[0:v]scale=${w}:${h}:force_original_aspect_ratio=decrease,` +
      `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,format=yuv420p[outv]`;
  } else {
    graph =
      `[0:v]scale=${w}:${h}:force_original_aspect_ratio=increase,` +
      `crop=${w}:${h},setsar=1,format=yuv420p[outv]`;
  }

  const args = [
    '-y',
    '-loop', '1',
    '-i', inputImage,
    '-i', inputVideo,
    '-filter_complex', graph,
    '-map', '[outv]',
    '-map', '1:a?',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '20',
    '-r', String(fps || 30),
    '-c:a', 'copy',
    '-t', String(crop.duration),
    '-movflags', '+faststart',
    outputVideo,
  ];

  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', args, { windowsHide: true });
    let log = '';
    ff.stderr.on('data', (d) => {
      log += d.toString();
      if (log.length > 4000) log = log.slice(-4000);
    });
    ff.on('error', reject);
    ff.on('close', (code) => {
      if (code === 0 && fs.existsSync(outputVideo)) {
        resolve({ output: `${id}.mp4` });
      } else {
        const tail = log
          .split('\n')
          .filter((l) => l.trim() && !/^\s*(frame=|Press |\[\?\]|configuration:|built with|lib(av|sw|postproc)\s)/.test(l))
          .slice(-12)
          .join('\n');
        reject(new Error(`ffmpeg exit ${code}\n${tail || '(không có log)'}`));
      }
    });
  });
}

const jobs = new Map();
const queue = [];
let draining = false;

function sanitizeBase(name) {
  const ext = path.extname(name);
  return path
    .basename(name, ext)
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[ .]+$/, '')
    .slice(0, 60) || 'image';
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function dropTempImage(job) {
  if (job.image) fs.unlink(path.join(WORK_DIR, job.image), () => {});
}

function pumpQueue() {
  if (draining) return;
  draining = true;

  const next = () => {
    const job = queue.shift();
    if (!job) {
      draining = false;
      return;
    }
    job.status = 'running';
    job.startedAt = Date.now();
    render(job)
      .then(() => {
        const out = path.join(WORK_DIR, `${job.id}.mp4`);
        if (!fs.existsSync(out) || fs.statSync(out).size === 0) {
          throw new Error('ffmpeg không tạo ra file video');
        }
        job.status = 'done';
        job.file = `${job.id}.mp4`;
        dropTempImage(job);
        next();
      })
      .catch((e) => {
        job.status = 'failed';
        job.error = e.message;
        fs.unlink(path.join(WORK_DIR, `${job.id}.mp4`), () => {});
        dropTempImage(job);
        next();
      });
  };

  next();
}

setInterval(() => {
  const stale = Date.now() - 30 * 60 * 1000;
  for (const [id, job] of jobs) {
    if (job.status === 'running' && job.startedAt && job.startedAt < stale) {
      job.status = 'failed';
      job.error = 'Render quá 30 phút — có thể đã bị dừng giữa chừng';
      jobs.delete(id);
    }
  }
}, 60 * 1000).unref();

function readBody(req, limit = 20 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('Payload too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function parseMultipart(buffer, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  if (!m) throw new Error('Missing multipart boundary');
  const boundary = Buffer.from('--' + (m[1] || m[2]).trim());
  const parts = [];
  let idx = buffer.indexOf(boundary);
  while (idx !== -1) {
    const start = idx + boundary.length;
    if (buffer.slice(start, start + 2).toString() === '--') break;
    const headerEnd = buffer.indexOf('\r\n\r\n', start);
    if (headerEnd === -1) break;
    const rawHeaders = buffer.slice(start, headerEnd).toString('utf8');
    const next = buffer.indexOf(boundary, headerEnd);
    if (next === -1) break;
    const body = buffer.slice(headerEnd + 4, next - 2);
    const nameM = /name="([^"]*)"/i.exec(rawHeaders);
    const fileM = /filename="([^"]*)"/i.exec(rawHeaders);
    parts.push({
      name: nameM ? nameM[1] : '',
      filename: fileM ? fileM[1] : null,
      data: body,
    });
    idx = next;
  }
  return parts;
}

function listTemplates() {
  return fs
    .readdirSync(LIB_DIR)
    .filter((f) => VIDEO_EXT.has(path.extname(f).toLowerCase()))
    .map((f) => ({
      name: f,
      size: fs.statSync(path.join(LIB_DIR, f)).size,
      url: `/media/template/${encodeURIComponent(f)}`,
    }));
}

function parseJsonField(parts, name, fallback) {
  const p = parts.find((x) => x.name === name && !x.filename);
  if (!p) return fallback;
  try {
    return JSON.parse(p.data.toString('utf8'));
  } catch {
    return fallback;
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const route = url.pathname;

  try {
    if (route === '/' || route === '/index.html') {
      return sendFile(res, path.join(ROOT, 'public', 'index.html'), req);
    }
    if (route === '/app.js') return sendFile(res, path.join(ROOT, 'public', 'app.js'), req);
    if (route === '/style.css') return sendFile(res, path.join(ROOT, 'public', 'style.css'), req);

    if (route === '/api/templates' && req.method === 'GET') {
      return json(res, 200, { templates: listTemplates() });
    }

    if (route === '/api/probe' && req.method === 'GET') {
      const name = url.searchParams.get('name') || '';
      const file = path.join(LIB_DIR, path.basename(name));
      if (!fs.existsSync(file)) return json(res, 404, { error: 'Template not found' });
      return json(res, 200, await probeSummary(file));
    }

    if (route === '/api/templates' && req.method === 'POST') {
      const parts = await parseMultipart(await readBody(req, 800 * 1024 * 1024), req.headers['content-type']);
      const file = parts.find((p) => p.filename);
      if (!file) return json(res, 400, { error: 'No file uploaded' });
      const ext = path.extname(file.filename).toLowerCase();
      if (!VIDEO_EXT.has(ext)) return json(res, 400, { error: `Unsupported video type: ${ext}` });
      const base = path.basename(file.filename, ext).replace(/[^\w\-. ]+/g, '_').slice(0, 60) || 'template';
      const dest = path.join(LIB_DIR, base + ext);
      fs.writeFileSync(dest, file.data);
      return json(res, 200, { ok: true, name: base + ext });
    }

    if (route.startsWith('/api/templates/') && req.method === 'DELETE') {
      const name = path.basename(decodeURIComponent(route.slice('/api/templates/'.length)));
      const file = path.join(LIB_DIR, name);
      if (!fs.existsSync(file)) return json(res, 404, { error: 'Not found' });
      fs.unlinkSync(file);
      return json(res, 200, { ok: true });
    }

    if (route === '/api/render' && req.method === 'POST') {
      const parts = await parseMultipart(await readBody(req, 500 * 1024 * 1024), req.headers['content-type']);
      const settings = parseJsonField(parts, 'settings', null);
      if (!settings || !settings.template) return json(res, 400, { error: 'Thiếu video mẫu' });

      const template = path.basename(settings.template);
      const templatePath = path.join(LIB_DIR, template);
      if (!fs.existsSync(templatePath)) {
        return json(res, 400, { error: `Không tìm thấy video mẫu "${template}"` });
      }

      const probe = await probeSummary(templatePath);
      if (!probe.hasVideo) {
        return json(res, 400, { error: `Video mẫu "${template}" không có luồng hình` });
      }
      if (!probe.duration) {
        return json(res, 400, { error: `Không đọc được thời lượng của "${template}"` });
      }

      const imageParts = parts.filter((p) => p.name.startsWith('image') && p.filename);
      if (!imageParts.length) return json(res, 400, { error: 'Thiếu ảnh' });

      for (const p of imageParts) {
        const ext = path.extname(p.filename).toLowerCase();
        if (!IMAGE_EXT.has(ext)) {
          return json(res, 400, { error: `Ảnh không hỗ trợ: ${p.filename} (${ext || 'không rõ đuôi'})` });
        }
      }

      const w = settings.width || probe.width || 1080;
      const h = settings.height || probe.height || 1920;
      const crop = {
        w: Math.round(w / 2) * 2,
        h: Math.round(h / 2) * 2,
        fps: probe.fps || 30,
        duration: probe.duration,
        fit: settings.fit || 'cover',
      };

      const batchId = crypto.randomUUID();
      const items = [];

      for (const p of imageParts) {
        const ext = path.extname(p.filename).toLowerCase();
        const id = crypto.randomUUID();
        const imageName = `${id}${ext}`;
        fs.writeFileSync(path.join(WORK_DIR, imageName), p.data);

        const job = {
          id,
          batchId,
          status: 'queued',
          source: p.filename,
          outName: `${stamp()}_${sanitizeBase(p.filename)}.mp4`,
          template,
          image: imageName,
          crop,
        };
        jobs.set(id, job);
        items.push({ id, source: p.filename, outName: job.outName });
      }

      queue.push(...items.map((it) => jobs.get(it.id)));
      pumpQueue();

      return json(res, 200, {
        batchId,
        template,
        items: items.map((it) => ({ ...it, status: 'queued' })),
      });
    }

    if (route.startsWith('/api/job/') && req.method === 'GET') {
      const id = path.basename(route.slice('/api/job/'.length));
      const job = jobs.get(id);
      if (!job) return json(res, 404, { error: 'Không tìm thấy job' });
      return json(res, 200, {
        id: job.id,
        status: job.status,
        error: job.error,
        source: job.source,
        outName: job.outName,
        url: job.file ? `/media/output/${job.file}` : null,
      });
    }

    if (route.startsWith('/api/batch/') && req.method === 'GET') {
      const batchId = path.basename(route.slice('/api/batch/'.length));
      const items = [...jobs.values()].filter((j) => j.batchId === batchId);
      if (!items.length) return json(res, 404, { error: 'Không tìm thấy batch' });
      const done = items.filter((j) => j.status === 'done');
      return json(res, 200, {
        batchId,
        total: items.length,
        done: done.length,
        failed: items.filter((j) => j.status === 'failed').length,
        items: items.map((j) => ({
          id: j.id,
          source: j.source,
          outName: j.outName,
          status: j.status,
          error: j.error,
          url: j.file ? `/media/output/${j.file}` : null,
        })),
      });
    }

    if (route.startsWith('/media/template/')) {
      const name = path.basename(decodeURIComponent(route.slice('/media/template/'.length)));
      return sendFile(res, path.join(LIB_DIR, name), req);
    }

    if (route.startsWith('/media/output/')) {
      const name = path.basename(decodeURIComponent(route.slice('/media/output/'.length)));
      return sendFile(res, path.join(WORK_DIR, name), req);
    }

    return send(res, 404, 'Not found', { 'Content-Type': 'text/plain' });
  } catch (err) {
    return json(res, 500, { error: err.message });
  }
});

const HOUR = 3600 * 1000;
setInterval(() => {
  const cutoff = Date.now() - 24 * HOUR;
  for (const f of fs.readdirSync(WORK_DIR)) {
    const p = path.join(WORK_DIR, f);
    try {
      if (fs.statSync(p).mtimeMs < cutoff) fs.unlinkSync(p);
    } catch {}
  }
}, HOUR);

server.listen(PORT, () => {
  console.log(`Fast_Video running at http://localhost:${PORT}`);
  console.log(`Template library: ${LIB_DIR}`);
});
