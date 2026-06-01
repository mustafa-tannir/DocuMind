require('dotenv').config();

const express = require('express');
const multer  = require('multer');
const cors    = require('cors');
const { GoogleGenAI } = require('@google/genai');
const { v4: uuidv4 } = require('uuid');

const app    = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 4.5 * 1024 * 1024 } });
const ai     = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// ── In-memory session store ────────────────────────────────────────────────────
// Each session holds the PDF as base64 (stored once) and a text-only history.
// The PDF is injected back into the first turn when rebuilding the Gemini request.
const sessions = new Map();

setInterval(() => {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  for (const [id, s] of sessions) {
    if (s.createdAt < cutoff) sessions.delete(id);
  }
}, 30 * 60 * 1000);

app.use(cors());
app.use(express.json());

// ── POST /api/upload ──────────────────────────────────────────────────────────
// Stores the PDF in memory — no parsing, no embeddings.
app.post('/api/upload', upload.single('pdf'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file received. Send a PDF as form-data field "pdf".' });
  }

  const sessionId = uuidv4();
  sessions.set(sessionId, {
    pdfBase64: req.file.buffer.toString('base64'),
    filename:  req.file.originalname,
    history:   [], // [{ role: 'user'|'model', text: string }] — text only, no base64
    createdAt: Date.now(),
  });

  res.json({ sessionId, filename: req.file.originalname });
});

// ── POST /api/chat ─────────────────────────────────────────────────────────────
// Rebuilds the full Gemini contents array on every request so the model always
// has the PDF context. The PDF base64 goes into the first user turn.
app.post('/api/chat', async (req, res) => {
  const { sessionId, message } = req.body;

  if (!sessionId || !message) {
    return res.status(400).json({ error: 'sessionId and message are required.' });
  }

  const session = sessions.get(sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session expired. Please re-upload your document.' });
  }

  try {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.flushHeaders();

    const pdfPart = {
      inlineData: { mimeType: 'application/pdf', data: session.pdfBase64 },
    };

    // Build the contents array Gemini expects:
    //   First user turn  → [PDF, question]
    //   All other turns  → [text only]
    let contents;

    if (session.history.length === 0) {
      contents = [
        { role: 'user', parts: [pdfPart, { text: message }] },
      ];
    } else {
      contents = session.history.map((turn, i) => ({
        role:  turn.role,
        parts: (i === 0) ? [pdfPart, { text: turn.text }] : [{ text: turn.text }],
      }));
      contents.push({ role: 'user', parts: [{ text: message }] });
    }

    const stream = await ai.models.generateContentStream({
      model: 'gemini-2.5-flash',
      contents,
      config: {
        systemInstruction:
          `You are a helpful assistant answering questions about "${session.filename}".
Answer based on the document content only. If the answer isn't in the document, say so.
Use markdown formatting when it improves readability.`,
      },
    });

    let fullReply = '';
    for await (const chunk of stream) {
      const text = chunk.text;
      if (text) {
        fullReply += text;
        res.write(`data: ${JSON.stringify({ text })}\n\n`);
      }
    }

    // Save text-only history (base64 stays in session.pdfBase64, not repeated here)
    session.history.push(
      { role: 'user',  text: message },
      { role: 'model', text: fullReply },
    );

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    console.error('Chat error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to generate a response.' });
    } else {
      res.write(`data: ${JSON.stringify({ error: 'Generation failed.' })}\n\n`);
      res.end();
    }
  }
});

// ── Local dev entry point ──────────────────────────────────────────────────────
if (require.main === module) {
  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => console.log(`API running at http://localhost:${PORT}`));
}

module.exports = app;
