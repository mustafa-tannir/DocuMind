# DocuMind

Upload a PDF and ask questions about it. Powered by Google Gemini.

## How it works

1. Upload a PDF → text is extracted, chunked, and embedded with Gemini
2. Ask a question → the most relevant chunks are retrieved and sent to Gemini as context
3. Answer streams back in real time
4. Everything lives in memory for the session — nothing is saved

## Local development

```bash
# 1. Install
npm install

# 2. Create a .env file with your Gemini key
echo "GEMINI_API_KEY=your-key-here" > .env

# 3. Start the API server (terminal 1)
npm run dev:api        # http://localhost:3001

# 4. Start the frontend (terminal 2)
npm run dev:ui         # http://localhost:5173
```

Get a free Gemini key at [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey).

## Deploy to Vercel via GitHub

1. Push this repo to GitHub
2. Go to [vercel.com](https://vercel.com) → **New Project** → import the repo
3. Vercel auto-detects `vercel.json` — no framework preset needed
4. Add one environment variable in the Vercel dashboard:
   ```
   GEMINI_API_KEY = your-key-here
   ```
5. Deploy

Frontend and backend are served as one project. API routes (`/api/*`) run as serverless functions; everything else is the static React build.

## Project structure

```
DocuMind/
├── api/
│   └── index.js      ← all backend logic (Express + Gemini + sessions)
├── src/
│   ├── components/
│   │   ├── UploadArea.jsx
│   │   ├── ChatInterface.jsx
│   │   └── Message.jsx
│   ├── App.jsx
│   ├── App.css
│   └── main.jsx
├── index.html
├── package.json
├── vite.config.js    ← dev proxy: /api → localhost:3001
└── vercel.json       ← build + route config
```

## Dependencies

| Package | Purpose |
|---|---|
| `express` | HTTP server |
| `multer` | File upload handling |
| `pdf-parse` | Extract text from PDFs |
| `@google/generative-ai` | Gemini embeddings + chat |
| `cors` | CORS headers in dev |
| `dotenv` | Load `.env` locally |
| `uuid` | Session IDs |
| `react` + `react-dom` | UI |
| `vite` | Frontend build tool |

## Notes

- **File size**: Vercel's free tier limits request bodies to **4.5 MB**. Most PDFs are under this.
- **Session persistence**: Sessions are stored in-memory. On Vercel, a cold start clears all sessions — re-upload your document if you see a "session not found" error.
- **Conversation history**: Follow-up questions work within a session; Gemini receives the full chat history as context.
