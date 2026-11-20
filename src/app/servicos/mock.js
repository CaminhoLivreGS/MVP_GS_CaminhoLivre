/**
 * Dados de demonstração para quando nenhuma API responde.
 *
 * As respostas em mocks.json foram gravadas da API real no ponto de
 * demonstração (Vila Yara) por scripts/gravar-mocks.js. O arquivo só é
 * baixado na primeira falha (import dinâmico), então não pesa no app normal.
 * Devolve `undefined` quando não há mock para o pedido: quem chamou recebe o
 * erro de sempre (ex.: melhor entrada, saída, classificação por voz).
 */
import { distancia } from '../../localizacao/geo.js';

let carregados = null;
const carregar = () => (carregados ??= import('./mocks.json').then((m) => m.default ?? m));

// Avisos enviados durante o modo demonstração: ficam só nesta aba.
const criados = [];

const semAcento = (s) => (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function relatoDoForm(form) {
  const agora = new Date().toISOString();
  return {
    id: `demo-${Date.now().toString(36)}`,
    categoria: form.get('categoria'),
    status: 'em_verificacao',
    confirmacoes: 1,
    negacoes: 0,
    lat: Number(form.get('lat')),
    lon: Number(form.get('lon')),
    rua: null,
    descricao: form.get('descricao') || null,
    canal: form.get('canal') || (form.get('foto') ? 'foto' : 'texto'),
    criado_em: agora,
    atualizado_em: agora,
    origem: 'demonstracao_offline',
    tem_foto: false,
    foto_ilustrativa: false,
  };
}

export async function respostaMock(caminho, { metodo, corpo, form }) {
  let m;
  try {
    m = await carregar();
  } catch {
    return undefined;
  }
  const url = new URL(caminho, 'http://x');
  const p = url.pathname;
  const q = (k) => url.searchParams.get(k);

  if (metodo === 'GET') {
    if (p === '/territorio') return m.territorio;
    if (p === '/clima') return m.clima;
    if (p === '/onde-estou') return m.ondeEstou;
    if (p === '/novidades') return m.novidades;
    if (p === '/instituicoes') return m.instituicoes;
    if (p === '/locais') return m.locais;
    if (p.startsWith('/locais/') && !['/locais/entradas', '/locais/saida'].includes(p)) {
      return m.local[decodeURIComponent(p.slice('/locais/'.length))];
    }
    if (p === '/relatos') return { ...m.relatos, relatos: [...criados, ...m.relatos.relatos] };
    if (p === '/relatos/meus') return { relatos: criados, total: criados.length, consertados: 0 };
    if (p === '/lugares') {
      const base = m.lugares[q('categoria') ?? ''] ?? m.lugares[''];
      const termo = semAcento(q('q'));
      if (!termo) return base;
      const todos = Object.values(m.lugares).flatMap((x) => x.lugares);
      const unicos = [...new Map(todos.map((l) => [l.id, l])).values()];
      return { ...base, lugares: unicos.filter((l) => semAcento(`${l.nome} ${l.endereco}`).includes(termo)) };
    }
    return undefined;
  }

  if (p === '/assistente/destino') {
    const fala = semAcento(corpo?.fala);
    const chave = Object.keys(m.destino).find((k) => fala.includes(k)
      || (k === 'ubs' && /saude|posto|medic/.test(fala))
      || (k === 'estacao' && /trem|metro|cptm/.test(fala))
      || (k === 'farmacia' && /remedio|drogaria/.test(fala)));
    return m.destino[chave ?? 'ubs'];
  }
  if (p === '/rotas') {
    // A rota gravada cujo destino fica mais perto do pedido.
    const alvo = corpo?.destino;
    if (!alvo || !m.rotas.length) return undefined;
    const r = m.rotas.reduce((a, b) => (distancia(alvo, b.destino) < distancia(alvo, a.destino) ? b : a));
    return structuredClone(r);
  }
  if (p === '/assistente/ajuda') return m.ajuda;
  if (p === '/relatos' && form) {
    const r = relatoDoForm(form);
    criados.unshift(r);
    return r;
  }
  if (/^\/relatos\/[^/]+\/respostas$/.test(p)) {
    const id = decodeURIComponent(p.split('/')[2]);
    const r = criados.find((x) => x.id === id) ?? m.relatos.relatos.find((x) => x.id === id);
    return r ? { relato: r, contou: true } : undefined;
  }
  if (p === '/avaliacoes') return { ok: true };
  return undefined;
}
