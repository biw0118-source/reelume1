module.exports = (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ ok: true, app: 'reelume', ready: !!(process.env.GEMINI_API_KEY && process.env.APP_PASSWORD) });
};
