import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import './index.css';

// Reaching this line means the current JS entry chunk loaded successfully,
// so any past stale-chunk recovery reload (see ErrorBoundary) has done its
// job — clear the guard so a *future* deploy can still trigger one too.
sessionStorage.removeItem('sp_stale_chunk_reload');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
);
