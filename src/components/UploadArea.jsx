import { useState, useRef } from 'react';

export default function UploadArea({ onUpload }) {
  const [dragging,  setDragging]  = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error,     setError]     = useState('');
  const inputRef = useRef(null);

  async function processFile(file) {
    if (!file) return;
    if (file.type !== 'application/pdf') {
      setError('Only PDF files are supported.');
      return;
    }
    setError('');
    setUploading(true);

    const body = new FormData();
    body.append('pdf', file);

    try {
      const res  = await fetch('/api/upload', { method: 'POST', body });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      onUpload(data);
    } catch (err) {
      setError(err.message);
      setUploading(false);
    }
  }

  function onDrop(e) {
    e.preventDefault();
    setDragging(false);
    processFile(e.dataTransfer.files[0]);
  }

  return (
    <div className="upload-page">
      <div className="brand">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
          <rect width="24" height="24" rx="6" fill="#7c3aed"/>
          <path d="M12 6l1.8 3.6H17l-2.9 2.1 1.1 3.6L12 13.2l-3.2 2.1 1.1-3.6L7 9.6h3.2L12 6z" fill="white"/>
        </svg>
        <span>DocuMind</span>
      </div>

      <div className="upload-hero">
        <h1>Chat with any PDF</h1>
        <p>Upload a document and ask questions. Answers come straight from the text.</p>
      </div>

      <div
        className={`upload-zone${dragging ? ' dragging' : ''}`}
        onClick={() => !uploading && inputRef.current.click()}
        onDragEnter={e => { e.preventDefault(); setDragging(true); }}
        onDragOver={e => e.preventDefault()}
        onDragLeave={e => { e.preventDefault(); setDragging(false); }}
        onDrop={onDrop}
      >
        {uploading ? (
          <>
            <div className="spinner" />
            <p className="zone-title">Processing your document…</p>
            <p className="zone-hint">Reading text and building embeddings</p>
          </>
        ) : (
          <>
            <div className="zone-icon">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="12" y1="18" x2="12" y2="12"/>
                <polyline points="9 15 12 12 15 15"/>
              </svg>
            </div>
            <p className="zone-title">Drop your PDF here</p>
            <p className="zone-hint">or click to browse &nbsp;·&nbsp; PDF only &nbsp;·&nbsp; max 4.5 MB</p>
            {error && <p className="zone-error">{error}</p>}
          </>
        )}
        <input ref={inputRef} type="file" accept=".pdf" hidden onChange={e => processFile(e.target.files[0])} />
      </div>
    </div>
  );
}
