const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');

const UPLOAD_DIR = path.join(__dirname, 'uploads');
const OUT_DIR = path.join(__dirname, 'outputs');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(OUT_DIR, { recursive: true });

const upload = multer({ dest: UPLOAD_DIR, limits: { fileSize: 500 * 1024 * 1024 } });
const app = express();

// 1. CORS
const corsOpts = {
  origin: ['https://moonfull4k.xyz', 'https://www.moonfull4k.xyz'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  credentials: true
};
app.use(cors(corsOpts));
app.options('*', cors(corsOpts));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 2. მთავარი მარშრუტი
app.get('/', (req, res) => res.status(200).send('Patcher Backend is Running!'));

// 3. ერთჯერადი ბილეთები
const usedTickets = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [jid, exp] of usedTickets) if (exp < now) usedTickets.delete(jid);
}, 10 * 60 * 1000);

function verifyTicket(req, res, next) {
  try {
    if (!process.env.TICKET_SECRET) return res.status(500).json({ error: 'server_misconfigured' });
    const ticket = (req.body && req.body.ticket) || req.query.ticket || '';
    const [p, sig] = String(ticket).split('.');
    if (!p || !sig) return res.status(401).json({ error: 'ticket_required' });

    const want = crypto.createHmac('sha256', process.env.TICKET_SECRET).update(p).digest('hex');
    const a = Buffer.from(want);
    const b = Buffer.from(sig);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: 'bad_ticket' });

    const t = JSON.parse(Buffer.from(p.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
    if (t.exp < Date.now()) return res.status(401).json({ error: 'ticket_expired' });
    if (usedTickets.has(t.jid)) return res.status(401).json({ error: 'ticket_used' });

    usedTickets.set(t.jid, t.exp);
    req.ticket = t;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'bad_ticket' });
  }
}

// 4. Presets (იგივეა, რაც index.html-ში)
const PRESETS = {
  '1080p30':  { h: 1080, fps: 30 },
  '1080p60':  { h: 1080, fps: 60 },
  '1080p120': { h: 1080, fps: 120 },
  '4k60':     { h: 2160, fps: 60 },
  '4k120':    { h: 2160, fps: 120 }
};

// 5. Jobs (მეხსიერებაში; სერვერის გადატვირთვაზე იკარგება)
const jobs = new Map();

function cleanupFile(f) { if (f) fs.unlink(f, () => {}); }

// ძველი ფაილების გასუფთავება (30 წთ)
setInterval(() => {
  const now = Date.now();
  for (const [id, j] of jobs) {
    if (now - j.created > 30 * 60 * 1000 && j.status !== 'processing') {
      cleanupFile(j.outPath);
      jobs.delete(id);
    }
  }
}, 5 * 60 * 1000);

function parseTime(s) {
  const m = /(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(s);
  return m ? (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]) : 0;
}

function runFfmpeg(job, inPath, H, FPS) {
  job.status = 'processing';
  const outPath = path.join(OUT_DIR, job.id + '.mp4');
  job.outPath = outPath;

  const args = [
    '-y', '-i', inPath,
    '-vf', `scale=-2:${H}:flags=lanczos,fps=${FPS}`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k',
    '-movflags', '+faststart',
    outPath
  ];
  console.log(`[${job.id}] ffmpeg start: ${H}p ${FPS}fps, input ${job.inSize} bytes`);

  const ff = spawn(ffmpegPath, args);
  let duration = 0, errTail = '';

  ff.stderr.on('data', (d) => {
    const s = d.toString();
    errTail = (errTail + s).slice(-2000);
    if (!duration) {
      const m = /Duration:\s*(\d+:\d+:\d+(?:\.\d+)?)/.exec(s);
      if (m) duration = parseTime(m[1]);
    }
    const t = /time=(\d+:\d+:\d+(?:\.\d+)?)/.exec(s);
    if (t && duration) job.progress = Math.min(99, (parseTime(t[1]) / duration) * 100);
  });

  ff.on('error', (e) => {
    console.error(`[${job.id}] spawn error:`, e.message);
    job.status = 'error'; job.error = 'ffmpeg_spawn_failed: ' + e.message;
    cleanupFile(inPath);
  });

  ff.on('close', (code) => {
    cleanupFile(inPath);
    let size = 0;
    try { size = fs.statSync(outPath).size; } catch (e) {}
    if (code === 0 && size > 0) {
      job.status = 'done'; job.progress = 100; job.outSize = size;
      console.log(`[${job.id}] done, output ${size} bytes`);
    } else {
      job.status = 'error';
      job.error = `ffmpeg_failed (code ${code}, output ${size} bytes)`;
      console.error(`[${job.id}] FAILED code=${code} size=${size}\n${errTail}`);
      cleanupFile(outPath);
    }
  });
}

// 6. ოპტიმიზაცია
app.post('/api/optimize', upload.single('file'), verifyTicket, (req, res) => {
  const file = req.file;
  try {
    const maxH = Number(req.ticket.maxH) || 1080;
    const maxFps = Number(req.ticket.maxFps) || 30;
    const preset = PRESETS[req.body.preset];
    // პრესეტი არ უნდა აღემატებოდეს ბილეთის ლიმიტს
    const H = Math.min(preset ? preset.h : maxH, maxH);
    const FPS = Math.min(preset ? preset.fps : maxFps, maxFps);

    // ფაილის გარეშე (ახალი რეჟიმი): ბილეთი უკვე შემოწმდა და დახარჯულია,
    // ვიდეოს დაპატჩვას ბრაუზერი თვითონ აკეთებს (core.js) -> ვაბრუნებთ მხოლოდ ლიმიტებს.
    if (!file || !file.size) {
      cleanupFile(file && file.path);
      return res.json({ success: true, mode: 'client', height: H, fps: FPS });
    }

    const id = 'job_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    const job = { id, status: 'queued', progress: 0, created: Date.now(), inSize: file.size, h: H, fps: FPS };
    jobs.set(id, job);

    res.json({ success: true, jobId: id, height: H, fps: FPS });
    runFfmpeg(job, file.path, H, FPS);
  } catch (err) {
    cleanupFile(file && file.path);
    res.status(500).json({ error: err.message });
  }
});

// 7. სტატუსი
app.get('/api/jobs/:id', (req, res) => {
  const j = jobs.get(req.params.id);
  if (!j) return res.status(404).json({ status: 'error', error: 'job_not_found (სერვერი გადაიტვირთა?)' });
  res.json({
    success: true,
    status: j.status,
    progress: Math.round(j.progress),
    error: j.error,
    downloadUrl: j.status === 'done' ? '/api/download/' + j.id : undefined
  });
});

// 8. ჩამოტვირთვა (ცარიელს აღარასდროს აგზავნის)
app.get('/api/download/:id', (req, res) => {
  const j = jobs.get(req.params.id);
  if (!j || j.status !== 'done' || !j.outPath) return res.status(404).json({ error: 'not_ready_or_expired' });

  let size = 0;
  try { size = fs.statSync(j.outPath).size; } catch (e) {}
  if (!size) return res.status(410).json({ error: 'file_gone (სერვერი გადაიტვირთა?)' });

  console.log(`[${j.id}] download, ${size} bytes`);
  res.download(j.outPath, 'patched_video.mp4');
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
