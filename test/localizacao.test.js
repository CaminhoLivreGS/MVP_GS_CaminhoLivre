import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Polilinha, distancia, falarDistancia } from '../src/localizacao/geo.js';
import { FonteSimulada, FonteGPS } from '../src/localizacao/fontes.js';
import { MotorNavegacao } from '../src/localizacao/MotorNavegacao.js';

const rota = JSON.parse(readFileSync(new URL('./fixtures/rota_demo.json', import.meta.url)));

/** Caminha a rota com a fonte simulada (relógio manual) e coleta eventos. */
function caminhar(motor, { desviar = null, ruido = 0, passoM = 2 } = {}) {
  let tick;
  const fonte = new FonteSimulada(rota.geometria, { velocidade: passoM, multiplicador: 1, intervaloMs: 1000, ruido, agendar: (fn) => (tick = fn) });
  const eventos = [];
  fonte.iniciar((pos) => {
    for (const ev of motor.atualizar(pos)) if (ev.tipo !== 'progresso') eventos.push({ ...ev, s: Math.round(fonte.s) });
  });
  for (let i = 0; i < 2000 && !motor.estado.chegou; i++) {
    if (desviar && fonte.s >= desviar.em && fonte.s < desviar.em + desviar.por) fonte.sairDaRota(desviar.metros);
    else fonte.sairDaRota(0);
    tick();
  }
  return eventos;
}

test('geo: distância e polilinha batem com o acumulado da API', () => {
  const l = new Polilinha(rota.geometria.coords);
  assert.ok(Math.abs(l.total - rota.distancia_m) < 3, `${l.total} vs ${rota.distancia_m}`);
  const meio = l.pontoEm(l.total / 2);
  const p = l.projetar(meio);
  assert.ok(p.d < 0.5 && Math.abs(p.s - l.total / 2) < 1);
  assert.equal(falarDistancia(18), '20 metros');
  assert.equal(falarDistancia(1430), '1,4 quilômetro');
});

test('caminhada completa: manobras em ordem, alerta antes do problema, pergunta depois, chegada', () => {
  const motor = new MotorNavegacao(rota, { velocidade: 0.75 });
  const ev = caminhar(motor);
  const tipos = ev.map((e) => e.tipo);
  assert.equal(tipos.at(-1), 'chegada');
  assert.ok(!tipos.includes('fora_da_rota'));
  // cada manobra intermediária recebe aviso 'agora' uma única vez
  const agora = ev.filter((e) => e.tipo === 'manobra' && e.fase === 'agora').map((e) => e.manobra.indice);
  assert.deepEqual(agora, [...new Set(agora)]);
  assert.ok(agora.length >= rota.manobras.length - 2);
  // alerta do relato em verificação: antes de chegar nele; pergunta: depois de passar
  const alvo = rota.alertas_no_caminho.find((a) => a.status_relato === 'em_verificacao');
  const al = ev.find((e) => e.tipo === 'alerta' && e.alerta.id === alvo.id);
  const pg = ev.find((e) => e.tipo === 'pergunta' && e.alerta.id === alvo.id);
  assert.ok(al && al.s < alvo.acumulado_m && alvo.acumulado_m - al.s <= 32);
  assert.ok(pg && pg.s > alvo.acumulado_m);
  assert.match(MotorNavegacao.falaEvento(al), /^Atenção\. Em \d+ metros, pode ter calçada irregular\. Siga pela direita\.$/);
});

test('sair da rota dispara recálculo uma vez e avisa ao voltar', () => {
  const motor = new MotorNavegacao(rota);
  const ev = caminhar(motor, { desviar: { em: 200, por: 40, metros: 60 } });
  assert.equal(ev.filter((e) => e.tipo === 'fora_da_rota').length, 1);
  assert.equal(ev.filter((e) => e.tipo === 'de_volta').length, 1);
  assert.equal(ev.at(-1).tipo, 'chegada');
});

test('GPS com ruído de 15 m não tira da rota nem faz o progresso voltar', () => {
  const motor = new MotorNavegacao(rota);
  let anterior = 0;
  let tick;
  const fonte = new FonteSimulada(rota.geometria, { velocidade: 1.5, multiplicador: 1, ruido: 15, agendar: (fn) => (tick = fn) });
  const tipos = [];
  fonte.iniciar((p) => {
    for (const e of motor.atualizar(p)) tipos.push(e.tipo);
    assert.ok(motor.estado.s >= anterior);
    anterior = motor.estado.s;
  });
  for (let i = 0; i < 1500 && !motor.estado.chegou; i++) tick();
  assert.ok(!tipos.includes('fora_da_rota'));
  assert.ok(motor.estado.chegou);
});

test('leitura com precisão ruim é ignorada', () => {
  const motor = new MotorNavegacao(rota);
  const [lat, lon] = rota.geometria.coords.at(-1);
  assert.deepEqual(motor.atualizar({ lat, lon, precisao: 200 }), []);
  assert.equal(motor.estado.chegou, false);
});

test('FonteGPS filtra precisão baixa e repassa erros de permissão', () => {
  let cb;
  let erroCb;
  const geo = { watchPosition: (ok, err) => { cb = ok; erroCb = err; return 1; }, clearWatch: () => {} };
  const fonte = new FonteGPS({ geo });
  const posicoes = [];
  const erros = [];
  fonte.iniciar((p) => posicoes.push(p), (e) => erros.push(e.codigo));
  cb({ coords: { latitude: -23.54, longitude: -46.77, accuracy: 150 }, timestamp: 1 });
  cb({ coords: { latitude: -23.54, longitude: -46.77, accuracy: 8 }, timestamp: 2 });
  erroCb({ code: 1, message: 'negado' });
  assert.equal(posicoes.length, 1);
  assert.deepEqual(erros, ['PRECISAO_BAIXA', 'PERMISSAO_NEGADA']);
  assert.ok(distancia(posicoes[0], { lat: -23.54, lon: -46.77 }) < 1);
});
