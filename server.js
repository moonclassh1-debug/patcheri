const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const multer = require('multer');

const upload = multer({ dest: 'uploads/' });
const app = express();

// 1. CORS კონფიგურაცია
const corsOpts = {
  origin: ['https://moonfull4k.xyz', 'https://www.moonfull4k.xyz'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  credentials: true
};

app.use(cors(corsOpts));
app.options('*', cors(corsOpts)); // ყველა OPTIONS (preflight) მოთხოვნის დაშვება

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 2. მთავარი (Root) მარშრუტი — 404 შეცდომის თავიდან ასაცილებლად
app.get('/', (req, res) => {
  res.status(200).send('Patcher Backend is Running!');
});

// 3. ერთჯერადი ბილეთების მეხსიერება
const usedTickets = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [jid, exp] of usedTickets) {
    if (exp < now) usedTickets.delete(jid);
  }
}, 10 * 60 * 1000);

// 4. ბილეთის შემოწმების ფუნქცია
function verifyTicket(req, res, next) {
  try {
    if (!process.env.TICKET_SECRET) {
      return res.status(500).json({ error: 'server_misconfigured' });
    }

    const ticket = (req.body && req.body.ticket) || req.query.ticket || '';
    const [p, sig] = String(ticket).split('.');
    if (!p || !sig) {
      return res.status(401).json({ error: 'ticket_required' });
    }

    const want = crypto.createHmac('sha256', process.env.TICKET_SECRET).update(p).digest('hex');
    const a = Buffer.from(want);
    const b = Buffer.from(sig);

    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return res.status(401).json({ error: 'bad_ticket' });
    }

    const t = JSON.parse(Buffer.from(p.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());

    if (t.exp < Date.now()) {
      return res.status(401).json({ error: 'ticket_expired' });
    }
    if (usedTickets.has(t.jid)) {
      return res.status(401).json({ error: 'ticket_used' });
    }

    usedTickets.set(t.jid, t.exp);
    req.ticket = t;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'bad_ticket' });
  }
}

// 5. ოპტიმიზაციის მარშრუტი
app.post('/api/optimize', upload.single('file'), verifyTicket, async (req, res) => {
  try {
    const H = req.ticket.maxH;
    const FPS = req.ticket.maxFps;

    // დროებითი უნიკალური jobId ფრონტენდის ინტერფეისისთვის
    const jobId = 'job_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);

    res.json({ 
      success: true, 
      jobId: jobId, 
      height: H, 
      fps: FPS 
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. სერვერის გაშვება
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));}`));
