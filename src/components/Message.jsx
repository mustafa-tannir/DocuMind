// Renders a chat bubble. AI messages support a small subset of markdown.
export default function Message({ role, content, streaming }) {
  const isAI = role === 'assistant';

  return (
    <div className={`message ${isAI ? 'message-ai' : 'message-user'}`}>
      {isAI && (
        <div className="avatar">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <rect width="24" height="24" rx="6" fill="#7c3aed"/>
            <path d="M12 6l1.8 3.6H17l-2.9 2.1 1.1 3.6L12 13.2l-3.2 2.1 1.1-3.6L7 9.6h3.2L12 6z" fill="white"/>
          </svg>
        </div>
      )}
      <div className="bubble">
        {isAI
          ? <span dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }} />
          : content
        }
        {streaming && <span className="cursor" />}
      </div>
    </div>
  );
}

// Minimal markdown → HTML. Only runs on AI-generated content, never user input.
function renderMarkdown(text) {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')  // escape first
    .replace(/```[\s\S]*?```/g, m => `<pre><code>${m.slice(3, -3).replace(/^[a-z]+\n/, '')}</code></pre>`)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^#{1,3} (.+)$/gm, '<strong>$1</strong>')
    .replace(/^[-*] (.+)$/gm, '• $1')
    .replace(/\n/g, '<br>');
}
