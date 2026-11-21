import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { prewarm, setWorkerUrl } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './index.css';
import App from './App.tsx';

// Point MapLibre GL v6 to the untouched static worker bundle and prewarm the WorkerPool
// so React 19 StrictMode mount/unmount cycles never terminate the worker mid-handshake.
setWorkerUrl('/maplibre-gl-worker.js');
prewarm();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
