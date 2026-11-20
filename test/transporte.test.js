import { test } from 'node:test';
import assert from 'node:assert/strict';
import { APPS_CORRIDA, avaliarDistancia, formatarTempo, limiteAPe, links } from '../src/app/servicos/transporte.js';

const casa = { lat: -23.5421954, lon: -46.7775496, nome: 'Casa' };
const ubs = { lat: -23.5482159, lon: -46.7762656, nome: 'UBS Santa Maria Goretti' }; // ~680 m
const centroSP = { lat: -23.5505, lon: -46.6333, nome: 'Praça da Sé', endereco: 'Praça da Sé, São Paulo' }; // ~15 km

test('limite a pé: menor para quem usa apoio ou anda devagar', () => {
  assert.equal(limiteAPe(['sem_apoio']), 2000);
  assert.equal(limiteAPe(['cadeira']), 1000);
  assert.equal(limiteAPe(['sem_apoio'], true), 1000);
});

test('perto não é longe; ir a pé continua possível', () => {
  const a = avaliarDistancia(casa, ubs, ['sem_apoio']);
  assert.equal(a.longe, false);
  assert.equal(a.aPePossivel, true);
  assert.ok(a.minutos > 5 && a.minutos < 20, `minutos=${a.minutos}`);
});

test('o mesmo destino pode ser longe para cadeira de rodas e perto para quem anda sem apoio', () => {
  const meio = { lat: -23.5521, lon: -46.7775 }; // ~1,1 km em linha reta, ~1,4 km pelas calçadas
  assert.equal(avaliarDistancia(casa, meio, ['sem_apoio']).longe, false);
  assert.equal(avaliarDistancia(casa, meio, ['cadeira']).longe, true);
});

test('muito longe: a pé deixa de ser possível (a API recusa acima de 8 km)', () => {
  const a = avaliarDistancia(casa, centroSP, ['sem_apoio']);
  assert.equal(a.longe, true);
  assert.equal(a.aPePossivel, false);
  assert.ok(a.minutos > 180);
});

test('tempo em linguagem simples', () => {
  assert.equal(formatarTempo(25), '25 minutos');
  assert.equal(formatarTempo(60), '1 hora');
  assert.equal(formatarTempo(135), '2 horas e 15 minutos');
});

test('links de ônibus, carro e Uber levam origem e destino', () => {
  assert.match(links.onibusGoogle(casa, centroSP), /travelmode=transit/);
  assert.match(links.carroGoogle(casa, centroSP), /destination=-23.5505,-46.6333&travelmode=driving/);
  assert.match(links.carroWaze(casa, centroSP), /ll=-23.5505,-46.6333&navigate=yes/);
  const uber = APPS_CORRIDA.find((a) => a.id === 'uber').link(casa, centroSP);
  assert.match(uber, /^https:\/\/m\.uber\.com\/ul\/\?action=setPickup/);
  assert.match(uber, /dropoff\[latitude\]=-23.5505&dropoff\[longitude\]=-46.6333/);
  assert.match(uber, /dropoff\[nickname\]=Pra%C3%A7a%20da%20S%C3%A9/);
});
