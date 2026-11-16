import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/atkinson-hyperlegible/400.css';
import '@fontsource/atkinson-hyperlegible/700.css';
import './app/estilos.css';
import { App } from './app/App.jsx';

// TODO: integrar service worker (PWA offline): guardar a última rota e as ruas do mapa para internet fraca.
createRoot(document.getElementById('raiz')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
