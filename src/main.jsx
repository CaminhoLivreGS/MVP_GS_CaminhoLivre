import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/atkinson-hyperlegible/400.css';
import '@fontsource/atkinson-hyperlegible/700.css';

// Três entradas no mesmo build (mesma origem da API):
//   /adm            Painel Administrativo da prefeitura (computador)
//   /embed/<lugar>  widget "Como chegar com acessibilidade" para o site de instituições
//   /               o app do cidadão
// Cada uma carrega só o próprio código e CSS (import dinâmico).
// TODO: integrar service worker (PWA offline): guardar a última rota e as ruas do mapa para internet fraca.
// ?inicio: começa do zero (boas-vindas e configuração), como na primeira vez. Útil para gravar a demonstração.
{
  const q = new URLSearchParams(location.search);
  if (q.has('inicio')) {
    try { localStorage.clear(); sessionStorage.clear(); } catch { /* sem armazenamento */ }
    q.delete('inicio');
    history.replaceState(null, '', location.pathname + (q.size ? `?${q}` : '') + location.hash);
  }
}
const caminho = location.pathname;
const raiz = createRoot(document.getElementById('raiz'));
const montar = (no) => raiz.render(<StrictMode>{no}</StrictMode>);

if (caminho === '/adm' || caminho.startsWith('/adm/')) {
  import('./adm/Painel.jsx').then(({ Painel }) => montar(<Painel />));
} else if (caminho.startsWith('/embed/')) {
  const id = decodeURIComponent(caminho.slice('/embed/'.length)).replace(/\/$/, '');
  import('./embed/Embed.jsx').then(({ Embed }) => montar(<Embed id={id} />));
} else {
  Promise.all([import('./app/App.jsx'), import('./app/estilos.css')]).then(([{ App }]) => montar(<App />));
}
