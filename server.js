const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const multer = require('multer');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(os.tmpdir(), 'patcher');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const MAX_FILE_MB = Number(process.env.MAX_FILE_MB || 500);
const MAX_CONCURRENT = Number(process.env.MAX_CONCURRENT || 1);
const RESULT_TTL_MS = 30 * 60 * 1000;

const upload = multer({ dest: UPLOAD_DIR, limits: { fileSize: MAX_FILE_MB * 1024 * 1024 } });
const app = express();

// 1. CORS (OPTIONS preflight-საც cors ამუშავებს, app.options('*') აღარ არის საჭირო)
const corsOpts = {
  origin: ['https://moonfull4k.xyz', 'https://www.moonfull4k.xyz'],
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
};
app.use(cors(corsOpts));
app.use(express.json());

app.get('/', (req, res) => res.status(200).send('Patcher Backend is Running!'));

// 2. ბილეთები (ერთჯერადი)
const usedTickets = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [jid, exp] of usedTickets) if (exp < now) usedTickets.delete(jid);
}, 10 * 60 * 1000).unref();

function rmFile(f) { if (f) fs.unlink(f, () => {}); }

function verifyTicket(req, res, next) {
  const fail = (status, error) => { if (req.file) rmFile(req.file.path); return res.status(status).json({ error }); };
  try {
    if (!process.env.TICKET_SECRET) return fail(500, 'server_misconfigured');
    const ticket = (req.body && req.body.ticket) || '';
    const [p, sig] = String(ticket).split('.');
    if (!p || !sig) return fail(401, 'ticket_required');
    const want = crypto.createHmac('sha256', process.env.TICKET_SECRET).update(p).digest('hex');
    const a = Buffer.from(want), b = Buffer.from(sig);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return fail(401, 'bad_ticket');
    const t = JSON.parse(Buffer.from(p.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
    if (!t.jid || t.exp < Date.now()) return fail(401, 'ticket_expired');
    if (usedTickets.has(t.jid)) return fail(401, 'ticket_used');
    req.ticket = t;
    next();
  } catch (e) {
    return fail(401, 'bad_ticket');
  }
}

// 3. დავალებები
const jobs = new Map();   // jid -> {status, progress, error, input, output, name, expires}
const queue = [];
let running = 0;

function pump() {
  while (running < MAX_CONCURRENT && queue.length) {
    const job = queue.shift();
    running++;
    processJob(job).catch(e => { job.status = 'failed'; job.error = String(e && e.message || e); })
      .finally(() => { rmFile(job.input); running--; job.expires = Date.now() + RESULT_TTL_MS; pump(); });
  }
}

function toSec(h, m, s) { return (+h) * 3600 + (+m) * 60 + parseFloat(s); }

function processJob(job) {
  return new Promise((resolve, reject) => {
    job.status = 'processing';
    const H = job.maxH, FPS = job.maxFps;
    // "1080p/4K" = მოკლე გვერდი (ვერტიკალურ ვიდეოზეც სწორია)
    const vf = `scale='if(gt(iw,ih),-2,${H})':'if(gt(iw,ih),${H},-2)':flags=lanczos,fps=${FPS}`;
    const args = ['-y', '-i', job.input, '-vf', vf,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '17', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', job.output];
    const ff = spawn(ffmpegPath, args);
    let total = 0, tail = '';
    ff.stderr.on('data', d => {
      const s = d.toString(); tail = (tail + s).slice(-2000);
      const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(s); if (m && !total) total = toSec(m[1], m[2], m[3]);
      const t = [...s.matchAll(/time=(\d+):(\d+):([\d.]+)/g)].pop();
      if (t && total) job.progress = Math.min(99, Math.round(toSec(t[1], t[2], t[3]) / total * 100));
    });
    ff.on('error', reject);
    ff.on('close', code => {
      if (code === 0) { job.progress = 100; job.status = 'completed'; resolve(); }
      else { rmFile(job.output); reject(new Error('ffmpeg exit ' + code + ': ' + tail.split('\n').slice(-3).join(' ').trim())); }
    });
  });
}

setInterval(() => {
  const now = Date.now();
  for (const [id, j] of jobs) if (j.expires && j.expires < now) { rmFile(j.output); jobs.delete(id); }
}, 5 * 60 * 1000).unref();

// 4. ატვირთვა
app.post('/api/optimize', (req, res, next) => {
  upload.single('file')(req, res, err => {
    if (err) return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: err.code || 'upload_error' });
    next();
  });
}, verifyTicket, (req, res) => {
  const t = req.ticket;
  if (!req.file) return res.status(400).json({ error: 'no_file' });
  usedTickets.set(t.jid, t.exp);                       // ბილეთი ერთჯერადია
  const job = {
    status: 'queued', progress: 0, error: null,
    input: req.file.path, output: path.join(UPLOAD_DIR, 'out_' + t.jid + '.mp4'),
    name: (path.parse(req.file.originalname || 'video').name || 'video').replace(/[^\w.-]+/g, '_') + '_' + t.preset + '.mp4',
    maxH: Number(t.maxH) || 1080, maxFps: Number(t.maxFps) || 30, expires: null,
  };
  jobs.set(t.jid, job);
  queue.push(job); pump();
  res.json({ success: true, jobId: t.jid, height: job.maxH, fps: job.maxFps });
});

// 5. სტატუსი (jobId = ბილეთის UUID, ამიტომ ცალკე ბილეთი არ სჭირდება)
app.get('/api/jobs/:id', (req, res) => {
  const j = jobs.get(req.params.id);
  if (!j) return res.status(404).json({ status: 'failed', error: 'job_not_found' });
  const out = { status: j.status, progress: j.progress, jobId: req.params.id };
  if (j.status === 'completed') out.downloadUrl = '/api/download/' + req.params.id;
  if (j.status === 'failed') out.error = j.error || 'failed';
  res.json(out);
});

// 6. გადმოწერა
app.get('/api/download/:id', (req, res) => {
  const j = jobs.get(req.params.id);
  if (!j || j.status !== 'completed' || !fs.existsSync(j.output)) return res.status(404).json({ error: 'not_found' });
  res.download(j.output, j.name);
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
