// proxy.js
import https from 'https';
import http from 'http';
import express from 'express';
import multer from 'multer';

const app = express();
const BOT_TOKEN = process.env.BOT_TOKEN;
const SECRET = process.env.WORKER_SECRET;

// ── Middleware ────────────────────────────────────────────────
app.use(express.json()); // для JSON везде

const upload = multer({ storage: multer.memoryStorage() });

function auth(req, res, next) {
  if (req.headers['x-secret'] !== SECRET)
    return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// ── Безопасный Markdown и UTF-8 ─────────────────────────────
function escapeMarkdown(text) {
  if (!text) return text;
  return text
    .replace(/_/g, '\\_')
    .replace(/\*/g, '\\*')
    .replace(/\[/g, '\\[')
    .replace(/`/g, '\\`');
}

// ── Ядро: отправка multipart напрямую в Telegram API ─────────
function sendToTelegram(method, fields, file = null) {
  return new Promise((resolve, reject) => {
    const boundary = `Boundary${Date.now()}${Math.random().toString(16).slice(2)}`;
    const CRLF = '\r\n';
    const parts = [];

    for (const [key, val] of Object.entries(fields)) {
      if (val === undefined || val === null) continue;

      // Заголовок части
      parts.push(Buffer.from(
        `--${boundary}${CRLF}` +
        `Content-Disposition: form-data; name="${key}"${CRLF}` +
        `Content-Type: text/plain; charset=utf-8${CRLF}${CRLF}`,
        'utf8'
      ));
      // Значение отдельно — явно utf8
      parts.push(Buffer.from(`${val}`, 'utf8'));
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

    const body = Buffer.concat(parts);

    const options = {
      hostname: 'api.telegram.org',
      port: 443,
      path: `/bot${BOT_TOKEN}/${method}`,
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
      },
    };

    const req = https.request(options, (tgRes) => {
      let data = '';
      tgRes.setEncoding('utf8'); // ← явно utf8 для ответа
      tgRes.on('data', chunk => data += chunk);
      tgRes.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.ok) resolve(parsed.result);
          else reject(new Error(`TG Error: ${parsed.description}`));
        } catch (e) {
          reject(new Error(`Parse error: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Эндпоинты ────────────────────────────────────────────────

app.post('/send/audio', auth, upload.single('file'), async (req, res) => {
  try {
    const { chat_id, reply_to_message_id, caption, performer, title, reply_markup } = req.body;

    await sendToTelegram('sendAudio', {
      chat_id,
      caption: escapeMarkdown(caption),
      performer: escapeMarkdown(performer),
      title: escapeMarkdown(title),
      parse_mode: 'Markdown',
      reply_to_message_id,
      allow_sending_without_reply: 'true',
      ...(reply_markup && { reply_markup })
    }, {
      fieldName: 'audio',
      name: req.file.originalname,
      mimetype: 'audio/mpeg',
      buffer: req.file.buffer
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('sendAudio error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/send/video', auth, upload.single('file'), async (req, res) => {
  try {
    const { chat_id, reply_to_message_id, caption, reply_markup } = req.body;

    await sendToTelegram('sendVideo', {
      chat_id,
      caption: escapeMarkdown(caption),
      parse_mode: 'Markdown',
      reply_to_message_id,
      allow_sending_without_reply: 'true',
      ...(reply_markup && { reply_markup })
    }, {
      fieldName: 'video',
      name: req.file.originalname,
      mimetype: 'video/mp4',
      buffer: req.file.buffer
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('sendVideo error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/send/video_note', auth, upload.single('file'), async (req, res) => {
  try {
    const { chat_id, reply_to_message_id } = req.body;

    await sendToTelegram('sendVideoNote', {
      chat_id,
      reply_to_message_id,
      allow_sending_without_reply: 'true',
    }, {
      fieldName: 'video_note',
      name: req.file.originalname,
      mimetype: 'video/mp4',
      buffer: req.file.buffer
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('sendVideoNote error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/send/message', auth, async (req, res) => {
  try {
    const { chat_id, reply_to_message_id, text } = req.body;

    await sendToTelegram('sendMessage', {
      chat_id,
      text: escapeMarkdown(text),
      parse_mode: 'Markdown',
      reply_to_message_id,
      allow_sending_without_reply: 'true',
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('sendMessage error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Запуск сервера ───────────────────────────────────────────
http.createServer(app).listen(3001, '0.0.0.0', () => {
  console.log('✅ TG Proxy запущен на :3001');
});