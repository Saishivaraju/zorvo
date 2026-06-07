require('dotenv').config();
const express = require('express');
const nodemailer = require('nodemailer');
const cors = require('cors');
const path = require('path');
const mongoose = require('mongoose');

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static(__dirname));

// ── MongoDB connection ──────────────────────────────────────────────────────
let dbConnected = false;

async function connectDB() {
  if (dbConnected || !process.env.MONGODB_URI) return;
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    dbConnected = true;
    console.log('MongoDB connected');
  } catch (err) {
    console.error('MongoDB connection error:', err.message);
  }
}
connectDB();

// ── Schemas ─────────────────────────────────────────────────────────────────
const bookingSchema = new mongoose.Schema({
  name:      { type: String, required: true },
  email:     { type: String, required: true },
  phone:     { type: String, default: '' },
  brokerage: { type: String, default: '' },
  volume:    { type: String, default: '' },
  challenge: { type: String, default: '' },
  status:    { type: String, default: 'New' },
  review:    { type: String, default: '' },
  stars:     { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});

const settingSchema = new mongoose.Schema({
  key:   { type: String, unique: true },
  value: { type: String }
});

const Booking = mongoose.models.Booking || mongoose.model('Booking', bookingSchema);
const Setting = mongoose.models.Setting || mongoose.model('Setting', settingSchema);

// ── Helper: get owner email from DB (falls back to env) ─────────────────────
async function getOwnerEmail() {
  try {
    const s = await Setting.findOne({ key: 'ownerEmail' });
    return (s && s.value) ? s.value : process.env.SENDER_EMAIL;
  } catch {
    return process.env.SENDER_EMAIL;
  }
}

// ── SMTP transporter ────────────────────────────────────────────────────────
const SENDER_EMAIL = process.env.SENDER_EMAIL;

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false,
  auth: {
    user: SENDER_EMAIL,
    pass: process.env.EMAIL_PASS
  }
});

async function sendMail({ to, subject, html, replyTo }) {
  return transporter.sendMail({
    from: `"Zorvo AI" <${SENDER_EMAIL}>`,
    to,
    subject,
    html,
    replyTo: replyTo || SENDER_EMAIL
  });
}

// ── POST /api/lead-notify ───────────────────────────────────────────────────
app.post('/api/lead-notify', async (req, res) => {
  const { firstName, lastName, email, phone, agentCount, message } = req.body;
  if (!firstName || !email) {
    return res.status(400).json({ error: 'firstName and email are required' });
  }
  await connectDB();

  const leadName = `${firstName} ${lastName || ''}`.trim();

  // Save to MongoDB
  try {
    await Booking.create({
      name: leadName, email, phone: phone || '',
      brokerage: '', volume: agentCount || '', challenge: message || ''
    });
  } catch (err) {
    console.error('DB save error:', err.message);
  }

  const ownerEmail = await getOwnerEmail();

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#f5f3ef;padding:32px;border-radius:12px;">
      <div style="background:#2d5be3;color:#fff;padding:20px 28px;border-radius:8px 8px 0 0;">
        <h2 style="margin:0;font-size:1.3rem;">🔥 New Lead — Zorvo AI</h2>
        <p style="margin:6px 0 0;opacity:.85;font-size:.9rem;">A new lead just submitted a request</p>
      </div>
      <div style="background:#fff;padding:28px;border-radius:0 0 8px 8px;border:1px solid #e0dbd4;border-top:none;">
        <table style="width:100%;border-collapse:collapse;font-size:.93rem;">
          <tr><td style="padding:10px 0;color:#5c5347;width:140px;font-weight:600;">Name</td><td style="padding:10px 0;color:#1c1814;">${leadName}</td></tr>
          <tr style="border-top:1px solid #f0ede8;"><td style="padding:10px 0;color:#5c5347;font-weight:600;">Email</td><td style="padding:10px 0;"><a href="mailto:${email}" style="color:#2d5be3;">${email}</a></td></tr>
          ${phone ? `<tr style="border-top:1px solid #f0ede8;"><td style="padding:10px 0;color:#5c5347;font-weight:600;">Phone</td><td style="padding:10px 0;color:#1c1814;">${phone}</td></tr>` : ''}
          ${agentCount ? `<tr style="border-top:1px solid #f0ede8;"><td style="padding:10px 0;color:#5c5347;font-weight:600;">Reason</td><td style="padding:10px 0;color:#1c1814;">${agentCount}</td></tr>` : ''}
          ${message ? `<tr style="border-top:1px solid #f0ede8;"><td style="padding:10px 0;color:#5c5347;font-weight:600;vertical-align:top;">Message</td><td style="padding:10px 0;color:#1c1814;">${message}</td></tr>` : ''}
        </table>
        <div style="margin-top:24px;padding-top:20px;border-top:1px solid #f0ede8;">
          <a href="mailto:${email}" style="background:#2d5be3;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:.9rem;">Reply to ${leadName}</a>
        </div>
        <p style="margin-top:24px;font-size:.8rem;color:#9c9080;">Zorvo AI · Real Estate Lead Management</p>
      </div>
    </div>
  `;

  try {
    await sendMail({ to: ownerEmail, subject: `🔥 New Lead: ${leadName} — Zorvo AI`, html });
    res.json({ success: true });
  } catch (err) {
    console.error('Email error:', err.message);
    res.status(500).json({ error: 'Failed to send notification', detail: err.message });
  }
});

// ── POST /api/send-email ────────────────────────────────────────────────────
app.post('/api/send-email', async (req, res) => {
  const { to, toName, subject, message } = req.body;
  if (!to || !subject || !message) {
    return res.status(400).json({ error: 'to, subject, and message are required' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    return res.status(400).json({ error: 'Invalid recipient email' });
  }

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#f5f3ef;padding:32px;border-radius:12px;">
      <div style="background:#2d5be3;color:#fff;padding:20px 28px;border-radius:8px 8px 0 0;">
        <h2 style="margin:0;font-size:1.2rem;">Message from Your Agent — Zorvo AI</h2>
      </div>
      <div style="background:#fff;padding:28px;border-radius:0 0 8px 8px;border:1px solid #e0dbd4;border-top:none;">
        ${toName ? `<p style="margin:0 0 16px;color:#5c5347;font-size:.9rem;">Hi ${toName},</p>` : ''}
        <div style="color:#1c1814;font-size:.95rem;line-height:1.7;white-space:pre-wrap;">${message}</div>
        <p style="margin-top:24px;font-size:.8rem;color:#9c9080;">Zorvo AI · Real Estate Lead Management</p>
      </div>
    </div>
  `;

  try {
    await sendMail({ to: toName ? `${toName} <${to}>` : to, subject, html, replyTo: SENDER_EMAIL });
    res.json({ success: true, message: `Email sent to ${to}` });
  } catch (err) {
    console.error('Send email error:', err.message);
    res.status(500).json({ error: 'Failed to send email', detail: err.message });
  }
});

// ── POST /api/settings ──────────────────────────────────────────────────────
app.post('/api/settings', async (req, res) => {
  const { ownerEmail: newEmail } = req.body;
  if (newEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
    return res.status(400).json({ error: 'Invalid email address' });
  }
  await connectDB();
  try {
    await Setting.findOneAndUpdate(
      { key: 'ownerEmail' },
      { value: newEmail || SENDER_EMAIL },
      { upsert: true }
    );
    console.log(`Owner email updated: ${newEmail || SENDER_EMAIL}`);
    res.json({ success: true, ownerEmail: newEmail || SENDER_EMAIL });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save setting' });
  }
});

// ── GET /api/bookings ───────────────────────────────────────────────────────
// Owner dashboard fetches all bookings from DB
app.get('/api/bookings', async (req, res) => {
  await connectDB();
  try {
    const bookings = await Booking.find().sort({ createdAt: -1 }).lean();
    res.json(bookings.map(b => ({
      id:        b._id.toString(),
      name:      b.name,
      email:     b.email,
      phone:     b.phone,
      brokerage: b.brokerage,
      volume:    b.volume,
      challenge: b.challenge,
      status:    b.status,
      review:    b.review,
      stars:     b.stars,
      date:      new Date(b.createdAt).toLocaleString()
    })));
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch bookings' });
  }
});

// ── PATCH /api/bookings/:id ─────────────────────────────────────────────────
app.patch('/api/bookings/:id', async (req, res) => {
  await connectDB();
  try {
    const updated = await Booking.findByIdAndUpdate(
      req.params.id,
      { $set: req.body },
      { new: true }
    );
    res.json({ success: true, booking: updated });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update booking' });
  }
});

// ── DELETE /api/bookings/:id ────────────────────────────────────────────────
app.delete('/api/bookings/:id', async (req, res) => {
  await connectDB();
  try {
    await Booking.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete booking' });
  }
});

// ── Serve pages ─────────────────────────────────────────────────────────────
const pages = ['index', 'features', 'pricing', 'screenshots', 'demo', 'contact'];
pages.forEach(page => {
  app.get(`/${page}.html`, (req, res) =>
    res.sendFile(path.join(__dirname, `${page}.html`))
  );
});
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// Catch-all — serve index for any unmatched route
app.use((req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Zorvo AI running at http://localhost:${PORT}`));
