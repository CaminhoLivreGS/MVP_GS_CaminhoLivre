/**
 * Cliente da API. Um link só (o do Vercel), com reserva em cadeia:
 *   1. /api na mesma origem (função Python no Vercel, ou o próprio container no Render)
 *   2. API reserva no Render (VITE_API_RESERVA), se a 1 cair, der 5xx ou demorar
 *   3. dados de demonstração gravados da API real (mocks.json), se as duas falharem
 * Timeouts curtos e mensagens em linguagem simples. A última rota fica guardada
 * para funcionar com internet fraca (a navegação em si roda toda no aparelho).
 */
import { respostaMock } from './mock.js';

let dispositivo = null;
export const definirDispositivo = (d) => (dispositivo = d);

export class ErroApi extends Error {
  constructor(mensagem, status) {
    super(mensagem);
    this.status = status;
  }
}

// Erro "de infraestrutura" (servidor fora, lento ou quebrado): vale tentar a próxima API.
class ErroServidor extends Error {}

const RESERVA_PADRAO = 'https://caminho-livre-6s2g.onrender.com';
const reserva = (import.meta.env?.VITE_API_RESERVA ?? RESERVA_PADRAO).trim().replace(/\/$/, '');
const mesmaOrigem = typeof location !== 'undefined' && reserva === location.origin;
const BASES = ['/api', ...(reserva && !mesmaOrigem ? [`${reserva}/api`] : [])];

// Uma API que falhou fica de fora por um minuto (não faz a pessoa esperar o timeout de novo a cada pedido).
const PAUSA_MS = 60_000;
const foraAte = new Map();

// O Render grátis "dorme": um toque logo ao abrir o app já o acorda, caso ele seja preciso.
if (BASES.length > 1 && typeof fetch !== 'undefined') {
  fetch(`${reserva}/api/saude`, { mode: 'no-cors' }).catch(() => {});
}

// Avisa a interface quando os dados exibidos são os de demonstração.
let modoDemo = false;
const ouvintes = new Set();
export const emModoDemo = () => modoDemo;
export function aoMudarModoDemo(fn) {
  ouvintes.add(fn);
  return () => ouvintes.delete(fn);
}
function definirModoDemo(v) {
  if (modoDemo === v) return;
  modoDemo = v;
  ouvintes.forEach((fn) => fn(v));
}

async function tentar(base, caminho, { metodo, corpo, form, timeout }) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  const headers = {};
  if (dispositivo) headers['X-Dispositivo'] = dispositivo;
  if (corpo) headers['Content-Type'] = 'application/json';
  try {
    const r = await fetch(`${base}${caminho}`, {
      method: metodo,
      headers,
      body: form ?? (corpo ? JSON.stringify(corpo) : undefined),
      signal: ctrl.signal,
    });
    const json = (r.headers.get('content-type') ?? '').includes('application/json');
    const dados = json ? await r.json().catch(() => null) : null;
    // 5xx, ou uma resposta que não é da API (ex.: página de erro HTML do Vercel): servidor com problema.
    if (r.status >= 500 || dados === null) throw new ErroServidor(`HTTP ${r.status}`);
    if (!r.ok) {
      const msg = typeof dados.detail === 'string' ? dados.detail : 'Não consegui agora. Tente de novo.';
      throw new ErroApi(r.status === 429 ? 'Muitos pedidos seguidos. Espere um minuto.' : msg, r.status);
    }
    return dados;
  } catch (e) {
    if (e instanceof ErroApi) throw e; // resposta válida da API (ex.: 422): não adianta tentar outra
    throw new ErroServidor(e.name === 'AbortError' ? 'lenta' : e.message);
  } finally {
    clearTimeout(t);
  }
}

async function chamar(caminho, { metodo = 'GET', corpo, form, timeout = 15000 } = {}) {
  const opcoes = { metodo, corpo, form, timeout };
  let lenta = false;
  for (const base of BASES) {
    if ((foraAte.get(base) ?? 0) > Date.now()) continue;
    try {
      const dados = await tentar(base, caminho, opcoes);
      foraAte.delete(base);
      definirModoDemo(false);
      return dados;
    } catch (e) {
      if (!(e instanceof ErroServidor)) throw e;
      lenta ||= e.message === 'lenta';
      foraAte.set(base, Date.now() + PAUSA_MS);
    }
  }
  // Nenhuma API respondeu: usa os dados de demonstração, se houver para este pedido.
  const mock = await respostaMock(caminho, { metodo, corpo, form });
  if (mock !== undefined) {
    definirModoDemo(true);
    return mock;
  }
  throw new ErroApi(lenta ? 'A internet está lenta. Tente de novo.' : 'Sem internet agora. Tente de novo.', 0);
}

export const api = {
  territorio: () => chamar('/territorio'),
  ondeEstou: (lat, lon) => chamar(`/onde-estou?lat=${lat}&lon=${lon}`, { timeout: 8000 }),
  clima: (lat, lon, simular = false) => chamar(`/clima?lat=${lat}&lon=${lon}${simular ? '&simular=true' : ''}`, { timeout: 8000 }),
  lugares: (q, ref, categoria) => {
    const p = new URLSearchParams({ q });
    if (ref) p.set('lat', ref.lat), p.set('lon', ref.lon);
    if (categoria) p.set('categoria', categoria);
    return chamar(`/lugares?${p}`);
  },
  destino: (fala, ref) => chamar('/assistente/destino', { metodo: 'POST', corpo: { fala, lat: ref?.lat, lon: ref?.lon }, timeout: 25000 }),
  rota: (pedido) => chamar('/rotas', { metodo: 'POST', corpo: pedido, timeout: 25000 }),
  relatos: () => chamar('/relatos'),
  criarRelato: (form) => chamar('/relatos', { metodo: 'POST', form, timeout: 30000 }),
  classificarRelatoVoz: (texto) => chamar('/relatos/voz/classificar', { metodo: 'POST', corpo: { texto }, timeout: 15000 }),
  instituicoes: () => chamar('/instituicoes'),
  responder: (id, resposta) => chamar(`/relatos/${encodeURIComponent(id)}/respostas`, { metodo: 'POST', corpo: { resposta } }),
  meus: () => chamar('/relatos/meus'),
  novidades: (marcar = false) => chamar(`/novidades${marcar ? '?marcar=true' : ''}`),
  ajuda: (pergunta) => chamar('/assistente/ajuda', { metodo: 'POST', corpo: { pergunta }, timeout: 20000 }),
  avaliar: (rotaId, nota, extra = {}) => chamar('/avaliacoes', { metodo: 'POST', corpo: { rota_id: rotaId, nota, ...extra } }),
  // Melhor entrada (chegando) e melhor saída (saindo) de um lugar.
  entradas: (lugar, origem, perfis, hora) => {
    const p = new URLSearchParams({ lat: lugar.lat, lon: lugar.lon, origem_lat: origem.lat, origem_lon: origem.lon,
      perfis: perfis.join(','), nome: lugar.nome ?? '' });
    if (hora) p.set('hora', hora);
    return chamar(`/locais/entradas?${p}`, { timeout: 15000 });
  },
  saida: ({ localId, ponto, texto, destino, perfis, hora }) => {
    const p = new URLSearchParams({ local_id: localId, destino_lat: destino.lat, destino_lon: destino.lon, perfis: perfis.join(',') });
    if (ponto) p.set('ponto', ponto);
    if (texto) p.set('texto', texto);
    if (hora) p.set('hora', hora);
    return chamar(`/locais/saida?${p}`, { timeout: 15000 });
  },
  locaisPerto: (lat, lon) => chamar(`/locais?lat=${lat}&lon=${lon}`),
  local: (id) => chamar(`/locais/${encodeURIComponent(id)}`),
};

const CHAVE_ROTA = 'caminhoLivre.ultimaRota';
export function guardarRota(r) {
  try {
    localStorage.setItem(CHAVE_ROTA, JSON.stringify(r));
  } catch {
    /* sem armazenamento */
  }
}
export function ultimaRota() {
  try {
    return JSON.parse(localStorage.getItem(CHAVE_ROTA) ?? 'null');
  } catch {
    return null;
  }
}
