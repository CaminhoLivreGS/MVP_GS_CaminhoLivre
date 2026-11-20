import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apagarPerfil, resumoPerfil, salvarPerfil, usarPerfil } from '../src/app/servicos/preferencias.js';

test('cadastrar o primeiro perfil deixa ele ativo', () => {
  const m = salvarPerfil({ perfisSalvos: [] }, { nome: 'Eu', perfis: ['cadeira'], preferenciasRota: ['sem_escada'] });
  assert.equal(m.perfisSalvos.length, 1);
  assert.equal(m.perfilAtivo, m.perfisSalvos[0].id);
  assert.deepEqual(m.perfis, ['cadeira']);
});

test('segundo perfil, troca e edição', () => {
  let prefs = { perfisSalvos: [{ id: 'eu', nome: 'Eu', perfis: ['sem_apoio'], preferenciasRota: [] }], perfilAtivo: 'eu' };
  prefs = { ...prefs, ...salvarPerfil(prefs, { nome: 'Minha mãe', perfis: ['bengala'], preferenciasRota: ['plano'] }) };
  assert.equal(prefs.perfisSalvos.length, 2);
  assert.deepEqual(prefs.perfis, ['bengala']);
  prefs = { ...prefs, ...usarPerfil(prefs, 'eu') };
  assert.deepEqual(prefs.perfis, ['sem_apoio']);
  prefs = { ...prefs, ...salvarPerfil(prefs, { id: 'eu', perfis: ['muletas'], preferenciasRota: [] }) };
  assert.equal(prefs.perfisSalvos.find((p) => p.id === 'eu').nome, 'Eu');
  assert.deepEqual(prefs.perfis, ['muletas']);
});

test('apagar o perfil ativo passa para o próximo', () => {
  const prefs = { perfisSalvos: [{ id: 'a', nome: 'A', perfis: ['cadeira'] }, { id: 'b', nome: 'B', perfis: ['bengala'] }], perfilAtivo: 'a' };
  const m = apagarPerfil(prefs, 'a');
  assert.equal(m.perfilAtivo, 'b');
  assert.deepEqual(m.perfis, ['bengala']);
  assert.deepEqual(apagarPerfil({ perfisSalvos: [{ id: 'a' }], perfilAtivo: 'a' }, 'a').perfis, []);
});

test('resumo em linguagem simples', () => {
  assert.equal(resumoPerfil({ perfis: ['cadeira'], preferenciasRota: ['sem_escada'] }), 'Cadeira de rodas · nunca usar escadas');
  assert.equal(resumoPerfil({ perfis: [] }), 'Sem perfil cadastrado');
});
