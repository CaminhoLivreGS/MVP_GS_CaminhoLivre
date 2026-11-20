#!/usr/bin/env node
/**
 * Grava respostas REAIS da API no ponto de demonstração (Vila Yara) em
 * src/app/servicos/mocks.json. O front usa esse arquivo quando nenhuma API
 * responde (nem a do Vercel nem a do Render).
 *
 * Uso: API rodando localmente e depois
 *   node scripts/gravar-mocks.js [http://localhost:8090]
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BASE = (process.argv[2] ?? 'http://localhost:8090').replace(/\/$/, '') + '/api';
const SAIDA = fileURLToPath(new URL('../src/app/servicos/mocks.json', import.meta.url));

async function get(caminho) {
  const r = await fetch(BASE + caminho);
  if (!r.ok) throw new Error(`${caminho}: HTTP ${r.status}`);
  return r.json();
}
async function post(caminho, corpo) {
  const r = await fetch(BASE + caminho, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
  if (!r.ok) throw new Error(`${caminho}: HTTP ${r.status}`);
  return r.json();
}

const territorio = await get('/territorio');
const casa = territorio.demo.casa;
const ref = `lat=${casa.lat}&lon=${casa.lon}`;

const lugares = {};
for (const c of ['ubs', 'estacao', 'farmacia']) lugares[c] = await get(`/lugares?q=&${ref}&categoria=${c}`);
lugares[''] = await get(`/lugares?q=&${ref}`);

const locais = await get(`/locais?${ref}`);
const local = {};
for (const l of locais.locais) local[l.id] = await get(`/locais/${encodeURIComponent(l.id)}`);

// Frases de exemplo para o assistente (o mock escolhe pela palavra-chave).
const destino = {};
for (const [chave, fala] of [['ubs', 'quero ir na UBS'], ['estacao', 'quero ir na estação de trem'],
  ['farmacia', 'preciso de uma farmácia'], ['shopping', 'quero ir no shopping']]) {
  destino[chave] = await post('/assistente/destino', { fala, lat: casa.lat, lon: casa.lon });
}

// Rotas da casa até os destinos mais prováveis da demonstração.
const alvos = [
  ...['ubs', 'estacao', 'farmacia'].map((c) => lugares[c].lugares[0]).filter(Boolean),
  ...locais.locais.slice(0, 2),
];
const rotas = [];
for (const d of alvos) {
  try {
    rotas.push(await post('/rotas', {
      origem: { lat: casa.lat, lon: casa.lon, nome: casa.nome },
      destino: { lat: d.lat, lon: d.lon, nome: d.nome, id: d.id },
      perfis: ['sem_apoio'], chuva: 'nao',
    }));
  } catch (e) {
    console.warn('rota ignorada:', d.nome, e.message);
  }
}

const mocks = {
  gravado_em: new Date().toISOString(),
  territorio,
  clima: await get(`/clima?${ref}`),
  ondeEstou: await get(`/onde-estou?${ref}`),
  lugares,
  relatos: await get('/relatos'),
  instituicoes: await get('/instituicoes'),
  novidades: { novidades: [] },
  locais,
  local,
  destino,
  rotas,
  ajuda: await post('/assistente/ajuda', { pergunta: 'Como o app funciona?' }),
};

writeFileSync(SAIDA, JSON.stringify(mocks));
console.log(`mocks gravados em ${SAIDA} (${rotas.length} rotas, ${mocks.relatos.relatos.length} relatos)`);
