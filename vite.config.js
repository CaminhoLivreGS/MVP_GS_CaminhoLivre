import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Servidor só no loopback: câmera, microfone e GPS exigem contexto seguro, e
// 127.0.0.1 já é considerado seguro pelo navegador. Para testar no celular,
// use túnel (ex.: `adb reverse tcp:8000 tcp:8000`), não exponha na rede.
// /api vai para a API FastAPI local (uvicorn na porta 8090).
const proxy = { '/api': { target: 'http://127.0.0.1:8090', changeOrigin: false } };

export default defineConfig({
  plugins: [react()],
  server: { host: '127.0.0.1', port: 8000, strictPort: true, proxy },
  preview: { host: '127.0.0.1', port: 8001, strictPort: true, proxy },
  worker: { format: 'es' }, // worker em módulo: o OpenCV entra pelo bundle
  build: {
    chunkSizeWarningLimit: 12000, // o OpenCV (WASM embutido) tem ~10 MB, carregado sob demanda
  },
});
