const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const multer = require('multer');

const upload = multer({ dest: 'uploads/' });
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS კონფიგურაცია
const corsOpts = {
  origin: ['https://moonfull4k.xyz', 'https://www.moonfull4k.xyz'],
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};
app.use(cors(corsOpts));
app.options('*', cors(corsOpts));

// ერთჯერადი ბილეთების მეხსიერება
const usedTickets = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [jid, exp] of usedTickets) {
    if (exp < now) usedTickets.delete(jid);
  }
}, 10 * 60 * 1000);

// ბილეთის შემოწმება
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

// მარშრუტი /api/optimize
app.post('/api/optimize', upload.single('file'), verifyTicket, async (req, res) => {
  try {
    const H = req.ticket.maxH;
    const FPS = req.ticket.maxFps;

    // აქ ეშვება შენი დამუშავების ლოგიკა
    res.json({ success: true, height: H, fps: FPS });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
