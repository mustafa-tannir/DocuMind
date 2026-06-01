import { useState } from 'react';
import UploadArea from './components/UploadArea';
import ChatInterface from './components/ChatInterface';

export default function App() {
  const [session, setSession] = useState(null);

  return session
    ? <ChatInterface session={session} onReset={() => setSession(null)} />
    : <UploadArea onUpload={setSession} />;
}
