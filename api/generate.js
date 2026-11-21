// Reelume: server-side proxy to Gemini Omni Flash. The API key lives ONLY in
// Vercel environment variables (GEMINI_API_KEY). The browser never sees it.
const crypto = require('crypto');

const MODEL = 'gemini-omni-1.1-flash';
const URL_ = 'https://generativelanguage.googleapis.com/v1beta/interactions';
const MAX_BYTES = 4.4 * 1024 * 1024; // Vercel function responses are capped near 4.5 MB

function same(a, b) {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const key = process.env.GEMINI_API_KEY, pass = process.env.APP_PASSWORD;
  if (!key) return res.status(500).json({ error: 'เซิร์ฟเวอร์ยังไม่ได้ตั้ง GEMINI_API_KEY' });
  if (!pass) return res.status(500).json({ error: 'เซิร์ฟเวอร์ยังไม่ได้ตั้ง APP_PASSWORD' });
  if (!same(req.headers['x-reelume-pass'], pass)) return res.status(401).json({ error: 'รหัสผ่านไม่ถูกต้อง' });

  const b = req.body || {};
  const prompt = String(b.prompt || '').slice(0, 4000);
  if (!prompt) return res.status(400).json({ error: 'ไม่มี prompt' });

  let input = prompt;
  if (b.image) {
    const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(String(b.image));
    if (!m) return res.status(400).json({ error: 'รูปแบบภาพไม่รองรับ (ใช้ JPEG/PNG/WebP)' });
    input = [{ type: 'image', data: m[2], mime_type: m[1] }, { type: 'text', text: prompt }];
  }

  const fmt = { type: 'video' };
  if (b.aspect === '16:9' || b.aspect === '9:16') fmt.aspect_ratio = b.aspect;
  const resol = ['360p', '720p', '1080p', '4k'].includes(b.resolution) ? b.resolution : (process.env.DEFAULT_RES || '360p');
  fmt.resolution = resol;

  const body = { model: MODEL, input, response_format: fmt, background: false, store: false, stream: false };

  let r, j;
  try {
    r = await fetch(URL_, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(body),
    });
    j = await r.json();
  } catch (e) {
    return res.status(502).json({ error: 'เรียก Gemini ไม่สำเร็จ: ' + e.message });
  }
  if (!r.ok) {
    // Pass Google's own message through so problems are easy to diagnose.
    const msg = (j && j.error && (j.error.message || JSON.stringify(j.error))) || ('HTTP ' + r.status);
    return res.status(r.status === 429 ? 429 : 502).json({ error: 'Gemini: ' + String(msg).slice(0, 600) });
  }

  let data = null;
  for (const s of (j.steps || [])) {
    if (s.type !== 'model_output') continue;
    for (const c of (s.content || [])) if (c.type === 'video' && c.data) data = c.data;
  }
  if (!data) return res.status(502).json({ error: 'Gemini ตอบกลับโดยไม่มีวิดีโอ', status: j.status || null });

  const buf = Buffer.from(data, 'base64');
  if (buf.length > MAX_BYTES) {
    return res.status(413).json({ error: 'วิดีโอใหญ่เกิน 4.4 MB (' + (buf.length / 1048576).toFixed(1) + ' MB) ลดความละเอียดลงเป็น 360p' });
  }
  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).send(buf);
};
