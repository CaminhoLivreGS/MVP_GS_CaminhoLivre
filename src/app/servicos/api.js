/**
 * Cliente da API (mesma origem: /api). Timeouts curtos e mensagens em
 * linguagem simples. A última rota fica guardada para funcionar com
 * internet fraca (a navegação em si roda toda no aparelho).
 */
let dispositivo = null;
export const definirDispositivo = (d) => (dispositivo = d);

export class ErroApi extends Error {
  constructor(mensagem, status) {
    super(mensagem);
    this.status = status;
  }
}

async function chamar(caminho, { metodo = 'GET', corpo, form, timeout = 15000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  const headers = {};
  if (dispositivo) headers['X-Dispositivo'] = dispositivo;
  if (corpo) headers['Content-Type'] = 'application/json';
  try {
    const r = await fetch(`/api${caminho}`, {
      method: metodo,
      headers,
      body: form ?? (corpo ? JSON.stringify(corpo) : undefined),
      signal: ctrl.signal,
    });
    const dados = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = typeof dados.detail === 'string' ? dados.detail : 'Não consegui agora. Tente de novo.';
      throw new ErroApi(r.status === 429 ? 'Muitos pedidos seguidos. Espere um minuto.' : msg, r.status);
    }
    return dados;
  } catch (e) {
    if (e instanceof ErroApi) throw e;
    throw new ErroApi(e.name === 'AbortError' ? 'A internet está lenta. Tente de novo.' : 'Sem internet agora. Tente de novo.', 0);
  } finally {
    clearTimeout(t);
  }
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
  destino: (fala, ref) => chamar('/assistente/destino', { metodo: 'POST', corpo: { fala, lat: ref?.lat, lon: ref?.lon }, timeout: 20000 }),
  rota: (pedido) => chamar('/rotas', { metodo: 'POST', corpo: pedido, timeout: 25000 }),
  relatos: () => chamar('/relatos'),
  criarRelato: (form) => chamar('/relatos', { metodo: 'POST', form, timeout: 30000 }),
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
