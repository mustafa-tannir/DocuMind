import { useState, useRef, useEffect } from 'react';
import Message from './Message';

export default function ChatInterface({ session, onReset }) {
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content: `I've read **${session.filename}**. What would you like to know?`,
    },
  ]);
  const [input,   setInput]   = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);
  const inputRef  = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;

    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: text }]);
    setLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ sessionId: session.sessionId, message: text }),
      });

      if (!res.ok) {
        const { error } = await res.json();
        setMessages(prev => [...prev, { role: 'assistant', content: error || 'Something went wrong.' }]);
        setLoading(false);
        return;
      }

      // Stream the SSE response
      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let   buffer  = '';
      let   content = '';

      // Placeholder message that grows as tokens arrive
      setMessages(prev => [...prev, { role: 'assistant', content: '', streaming: true }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (line === 'data: [DONE]') break;
          if (!line.startsWith('data: ')) continue;
          try {
            const parsed = JSON.parse(line.slice(6));
            if (parsed.text) {
              content += parsed.text;
              setMessages(prev => {
                const next = [...prev];
                next[next.length - 1] = { role: 'assistant', content, streaming: true };
                return next;
              });
            }
            if (parsed.error) throw new Error(parsed.error);
          } catch {
            // skip malformed lines
          }
        }
      }

      // Mark streaming done
      setMessages(prev => {
        const next = [...prev];
        next[next.length - 1] = { role: 'assistant', content };
        return next;
      });
    } catch (err) {
      setMessages(prev => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last?.role === 'assistant' && last.streaming) {
          next[next.length - 1] = { role: 'assistant', content: err.message || 'Something went wrong.' };
        } else {
          next.push({ role: 'assistant', content: err.message || 'Something went wrong.' });
        }
        return next;
      });
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }

  function handleKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <div className="chat-page">
      <header className="chat-header">
        <div className="header-left">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <rect width="24" height="24" rx="6" fill="#7c3aed"/>
            <path d="M12 6l1.8 3.6H17l-2.9 2.1 1.1 3.6L12 13.2l-3.2 2.1 1.1-3.6L7 9.6h3.2L12 6z" fill="white"/>
          </svg>
          <span className="header-title">DocuMind</span>
          <span className="doc-chip" title={session.filename}>{session.filename}</span>
        </div>
        <button className="btn-ghost" onClick={onReset}>New document</button>
      </header>

      <div className="messages">
        {messages.map((msg, i) => (
          <Message key={i} role={msg.role} content={msg.content} streaming={msg.streaming} />
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="input-row">
        <input
          ref={inputRef}
          className="chat-input"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Ask anything about the document…"
          disabled={loading}
          autoFocus
        />
        <button
          className="send-btn"
          onClick={send}
          disabled={!input.trim() || loading}
          aria-label="Send"
        >
          {loading
            ? <span className="btn-spinner" />
            : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="22" y1="2" x2="11" y2="13"/>
                <polygon points="22 2 15 22 11 13 2 9 22 2"/>
              </svg>
          }
        </button>
      </div>
    </div>
  );
}
