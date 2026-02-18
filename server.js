// proxy.js
import https from 'https';
import http  from 'http';
import express from 'express';
import multer  from 'multer';

const app       = express();
const BOT_TOKEN = process.env.BOT_TOKEN;
const SECRET    = process.env.WORKER_SECRET;

// ── Middleware ────────────────────────────────────────────────────────────────

// upload.any() — принимает файл с любым именем поля (audio / video / video_note / ...)
const upload = multer({ storage: multer.memoryStorage() });

app.use((req, res, next) => {
  if (req.headers['x-secret'] !== SECRET)
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  next();
});

// ── Telegram API core ────────────────────────────────────────────────────────

function sendToTelegram(method, fields, file = null) {
  return new Promise((resolve, reject) => {
    const boundary = `Boundary${Date.now()}${Math.random().toString(16).slice(2)}`;
    const CRLF     = '\r\n';
    const parts    = [];

    for (const [key, val] of Object.entries(fields)) {
      if (val === undefined || val === null) continue;
      parts.push(Buffer.from(
        `--${boundary}${CRLF}` +
        `Content-Disposition: form-data; name="${key}"${CRLF}` +
        `Content-Type: text/plain; charset=utf-8${CRLF}${CRLF}`,
        'utf8'
      ));
      parts.push(Buffer.from(String(val), 'utf8'));
      parts.push(Buffer.from(CRLF, 'utf8'));
    }

    if (file) {
      parts.push(Buffer.from(
        `--${boundary}${CRLF}` +
        `Content-Disposition: form-data; name="${file.fieldName}"; filename="${file.name}"${CRLF}` +
        `Content-Type: ${file.mimetype}${CRLF}${CRLF}`,
        'utf8'
      ));
      parts.push(file.buffer);
      parts.push(Buffer.from(CRLF, 'utf8'));
    }

    parts.push(Buffer.from(`--${boundary}--${CRLF}`, 'utf8'));

    const body    = Buffer.concat(parts);
    const options = {
      hostname: 'api.telegram.org',
      port:     443,
      path:     `/bot${BOT_TOKEN}/${method}`,
      method:   'POST',
      headers:  {
        'Content-Type':   `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
      },
    };

    const req = https.request(options, (tgRes) => {
      let data = '';
      tgRes.setEncoding('utf8');
      tgRes.on('data', chunk => data += chunk);
      tgRes.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.ok) resolve(parsed.result);
          else           reject(new Error(parsed.description ?? JSON.stringify(parsed)));
        } catch (e) {
          reject(new Error(`TG parse error: ${data.slice(0, 200)}`));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Хелперы ───────────────────────────────────────────────────────────────────

/** Берёт первый файл из req.files (upload.any()) */
function getFile(req) {
  return req.files?.[0] ?? null;
}

/**
 * Универсальный обработчик ответа.
 * Telegram может вернуть и результат, и ошибку — оборачиваем в { ok }.
 */
function ok(res, result) {
  res.json({ ok: true, result });
}
function fail(res, err) {
  console.error(err.message);
  res.status(500).json({ ok: false, error: err.message });
}

// ── Эндпоинты ────────────────────────────────────────────────────────────────

/**
 * POST /send/message
 * Body (multipart или json): chat_id, text, parse_mode?, reply_to_message_id?,
 *                            allow_sending_without_reply?, reply_markup?
 */
app.post('/send/message', upload.none(), async (req, res) => {
  try {
    const { chat_id, text, parse_mode, reply_to_message_id,
            allow_sending_without_reply, reply_markup } = req.body;

    const result = await sendToTelegram('sendMessage', {
      chat_id,
      text,
      parse_mode,
      reply_to_message_id,
      allow_sending_without_reply: allow_sending_without_reply ?? 'true',
      reply_markup,
    });

    ok(res, result);
  } catch (err) { fail(res, err); }
});

/**
 * POST /send/audio
 * Multipart: поля выше + performer?, title?, caption? + файл в поле 'audio'
 */
app.post('/send/audio', upload.any(), async (req, res) => {
  try {
    const { chat_id, caption, performer, title, parse_mode,
            reply_to_message_id, allow_sending_without_reply, reply_markup } = req.body;

    const file = getFile(req);
    if (!file) return res.status(400).json({ ok: false, error: 'No audio file uploaded' });

    const result = await sendToTelegram('sendAudio', {
      chat_id,
      caption,
      performer,
      title,
      parse_mode,
      reply_to_message_id,
      allow_sending_without_reply: allow_sending_without_reply ?? 'true',
      reply_markup,
    }, {
      fieldName: 'audio',
      name:      file.originalname || 'audio.mp3',
      mimetype:  file.mimetype     || 'audio/mpeg',
      buffer:    file.buffer,
    });

    ok(res, result);
  } catch (err) { fail(res, err); }
});

/**
 * POST /send/voice
 * Multipart: chat_id, caption?, parse_mode?, reply_to_message_id? + файл в поле 'voice'
 */
app.post('/send/voice', upload.any(), async (req, res) => {
  try {
    const { chat_id, caption, parse_mode,
            reply_to_message_id, allow_sending_without_reply, reply_markup } = req.body;

    const file = getFile(req);
    if (!file) return res.status(400).json({ ok: false, error: 'No voice file uploaded' });

    const result = await sendToTelegram('sendVoice', {
      chat_id,
      caption,
      parse_mode,
      reply_to_message_id,
      allow_sending_without_reply: allow_sending_without_reply ?? 'true',
      reply_markup,
    }, {
      fieldName: 'voice',
      name:      file.originalname || 'voice.ogg',
      mimetype:  file.mimetype     || 'audio/ogg',
      buffer:    file.buffer,
    });

    ok(res, result);
  } catch (err) { fail(res, err); }
});

/**
 * POST /send/video
 * Multipart: chat_id, caption?, parse_mode?, reply_to_message_id? + файл в поле 'video'
 */
app.post('/send/video', upload.any(), async (req, res) => {
  try {
    const { chat_id, caption, parse_mode,
            reply_to_message_id, allow_sending_without_reply, reply_markup } = req.body;

    const file = getFile(req);
    if (!file) return res.status(400).json({ ok: false, error: 'No video file uploaded' });

    const result = await sendToTelegram('sendVideo', {
      chat_id,
      caption,
      parse_mode,
      reply_to_message_id,
      allow_sending_without_reply: allow_sending_without_reply ?? 'true',
      reply_markup,
    }, {
      fieldName: 'video',
      name:      file.originalname || 'video.mp4',
      mimetype:  file.mimetype     || 'video/mp4',
      buffer:    file.buffer,
    });

    ok(res, result);
  } catch (err) { fail(res, err); }
});

/**
 * POST /send/video_note
 * Multipart: chat_id, reply_to_message_id? + файл в поле 'video_note'
 */
app.post('/send/video_note', upload.any(), async (req, res) => {
  try {
    const { chat_id, reply_to_message_id, allow_sending_without_reply } = req.body;

    const file = getFile(req);
    if (!file) return res.status(400).json({ ok: false, error: 'No video_note file uploaded' });

    const result = await sendToTelegram('sendVideoNote', {
      chat_id,
      reply_to_message_id,
      allow_sending_without_reply: allow_sending_without_reply ?? 'true',
    }, {
      fieldName: 'video_note',
      name:      file.originalname || 'video_note.mp4',
      mimetype:  file.mimetype     || 'video/mp4',
      buffer:    file.buffer,
    });

    ok(res, result);
  } catch (err) { fail(res, err); }
});

/**
 * POST /send/document
 * Multipart: chat_id, caption?, parse_mode?, reply_to_message_id? + файл в поле 'document'
 */
app.post('/send/document', upload.any(), async (req, res) => {
  try {
    const { chat_id, caption, parse_mode,
            reply_to_message_id, allow_sending_without_reply, reply_markup } = req.body;

    const file = getFile(req);
    if (!file) return res.status(400).json({ ok: false, error: 'No document file uploaded' });

    const result = await sendToTelegram('sendDocument', {
      chat_id,
      caption,
      parse_mode,
      reply_to_message_id,
      allow_sending_without_reply: allow_sending_without_reply ?? 'true',
      reply_markup,
    }, {
      fieldName: 'document',
      name:      file.originalname || 'document',
      mimetype:  file.mimetype     || 'application/octet-stream',
      buffer:    file.buffer,
    });

    ok(res, result);
  } catch (err) { fail(res, err); }
});

/**
 * POST /send/photo
 * Multipart: chat_id, caption?, parse_mode?, reply_to_message_id? + файл в поле 'photo'
 */
app.post('/send/photo', upload.any(), async (req, res) => {
  try {
    const { chat_id, caption, parse_mode,
            reply_to_message_id, allow_sending_without_reply, reply_markup } = req.body;

    const file = getFile(req);
    if (!file) return res.status(400).json({ ok: false, error: 'No photo file uploaded' });

    const result = await sendToTelegram('sendPhoto', {
      chat_id,
      caption,
      parse_mode,
      reply_to_message_id,
      allow_sending_without_reply: allow_sending_without_reply ?? 'true',
      reply_markup,
    }, {
      fieldName: 'photo',
      name:      file.originalname || 'photo.jpg',
      mimetype:  file.mimetype     || 'image/jpeg',
      buffer:    file.buffer,
    });

    ok(res, result);
  } catch (err) { fail(res, err); }
});

/**
 * POST /send/chat_action
 * Body: chat_id, action
 */
app.post('/send/chat_action', upload.none(), async (req, res) => {
  try {
    const { chat_id, action } = req.body;

    const result = await sendToTelegram('sendChatAction', { chat_id, action });
    ok(res, result);
  } catch (err) { fail(res, err); }
});

// ── Запуск ────────────────────────────────────────────────────────────────────

http.createServer(app).listen(3001, '0.0.0.0', () => {
  console.log('✅ TG Proxy запущен на :3001');
});