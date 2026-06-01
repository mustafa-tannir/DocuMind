require('dotenv').config();

const express = require('express');
const multer  = require('multer');
const cors    = require('cors');
const pdf     = require('pdf-parse');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { v4: uuidv4 } = require('uuid');

const app    = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 4.5 * 1024 * 1024 } });
const genai  = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ── In-memory session store ────────────────────────────────────────────────────
// Map<sessionId, { chunks: [{content, embedding}], history: [], createdAt }>
const sessions = new Map();

// Purge sessions older than 2 hours every 30 minutes
setInterval(() => {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  for (const [id, s] of sessions) {
    if (s.createdAt < cutoff) sessions.delete(id);
  }
}, 30 * 60 * 1000);

// ── Utilities ─────────────────────────────────────────────────────────────────

function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot   += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function chunkText(text, size = 800, overlap = 150) {
  const cleaned    = text.replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();
  const paragraphs = cleaned.split(/\n\n+/);
  const chunks     = [];
  let   buffer     = '';

  for (const para of paragraphs) {
    const p = para.trim();
    if (!p) continue;
    if (buffer.length + p.length > size && buffer.length > 0) {
      chunks.push(buffer.trim());
      buffer = buffer.slice(-overlap) + '\n\n' + p;
    } else {
      buffer = buffer ? buffer + '\n\n' + p : p;
    }
  }
  if (buffer.trim()) chunks.push(buffer.trim());

  // Fallback: force-split if no paragraph breaks found
  if (chunks.length === 0) {
    for (let i = 0; i < cleaned.length; i += size - overlap) {
      chunks.push(cleaned.slice(i, i + size));
    }
  }
  return chunks;
}

async function embedTexts(texts) {
  const model   = genai.getGenerativeModel({ model: 'text-embedding-004' });
  const results = [];
  // Batch in 5s to stay within free-tier rate limits
  for (let i = 0; i < texts.length; i += 5) {
    const batch = await Promise.all(
      texts.slice(i, i + 5).map(t => model.embedContent(t).then(r => r.embedding.values))
    );
    results.push(...batch);
    if (i + 5 < texts.length) await new Promise(r => setTimeout(r, 200));
  }
  return results;
}

// ── Routes ────────────────────────────────────────────────────────────────────

app.use(cors());
app.use(express.json());

// POST /api/upload
app.post('/api/upload', upload.single('pdf'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file received. Send a PDF as form-data field "pdf".' });
  }

  try {
    const { text, numpages } = await pdf(req.file.buffer);

    if (!text.trim()) {
      return res.status(400).json({ error: 'Could not extract text. The PDF may be scanned or image-only.' });
    }

    const chunks     = chunkText(text);
    const embeddings = await embedTexts(chunks);

    const sessionId = uuidv4();
    sessions.set(sessionId, {
      chunks:    chunks.map((content, i) => ({ content, embedding: embeddings[i] })),
      history:   [],
      filename:  req.file.originalname,
      createdAt: Date.now(),
    });

    res.json({ sessionId, filename: req.file.originalname, pageCount: numpages, chunkCount: chunks.length });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: 'Failed to process PDF. Check your GEMINI_API_KEY and try again.' });
  }
});

// POST /api/chat  — streams SSE
app.post('/api/chat', async (req, res) => {
  const { sessionId, message } = req.body;

  if (!sessionId || !message) {
    return res.status(400).json({ error: 'sessionId and message are required.' });
  }

  const session = sessions.get(sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session expired or not found. Please re-upload your document.' });
  }

  try {
    // Embed the query and find the most relevant chunks
    const embModel    = genai.getGenerativeModel({ model: 'text-embedding-004' });
    const queryEmb    = (await embModel.embedContent(message)).embedding.values;

    const topChunks   = session.chunks
      .map(c => ({ ...c, score: cosineSimilarity(queryEmb, c.embedding) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    const context = topChunks
      .map((c, i) => `[${i + 1}] ${c.content}`)
      .join('\n\n---\n\n');

    // Stream response
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.flushHeaders();

    const chatModel = genai.getGenerativeModel({
      model: 'gemini-1.5-flash',
      systemInstruction:
        `You are a helpful assistant that answers questions about a document.
Answer ONLY from the context provided. If the context doesn't contain the answer, say so clearly.
Be concise and accurate. Use markdown for formatting when helpful.

Document context:
${context}`,
    });

    const chat   = chatModel.startChat({ history: session.history });
    const result = await chat.sendMessageStream(message);

    let fullReply = '';
    for await (const chunk of result.stream) {
      const text = chunk.text();
      if (text) {
        fullReply += text;
        res.write(`data: ${JSON.stringify({ text })}\n\n`);
      }
    }

    // Persist to conversation history so follow-up questions work
    session.history.push(
      { role: 'user',  parts: [{ text: message }] },
      { role: 'model', parts: [{ text: fullReply }] },
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

// ── Start (local dev only) ────────────────────────────────────────────────────
if (require.main === module) {
  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => console.log(`API running at http://localhost:${PORT}`));
}

module.exports = app;
