import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escolherVozPt } from '../src/app/servicos/voz.js';

const v = (name, lang, localService = true) => ({ name, lang, localService });

test('escolhe voz pt-BR mesmo quando a padrão do sistema é inglês', () => {
  const vozes = [v('Samantha', 'en-US'), v('Alex', 'en-US'), v('Luciana', 'pt-BR'), v('Joana', 'pt-PT')];
  assert.equal(escolherVozPt(vozes).name, 'Luciana');
});

test('prefere a voz do Google em pt-BR e aceita lang com sublinhado (Android)', () => {
  const vozes = [v('Luciana', 'pt-BR'), v('Google português do Brasil', 'pt-BR', false)];
  assert.equal(escolherVozPt(vozes).name, 'Google português do Brasil');
  assert.equal(escolherVozPt([v('pt-br-x-afs-local', 'pt_BR')]).name, 'pt-br-x-afs-local');
});

test('usa pt-PT só se não houver pt-BR', () => {
  assert.equal(escolherVozPt([v('Samantha', 'en-US'), v('Joana', 'pt-PT')]).name, 'Joana');
});

test('nunca devolve voz de outro idioma', () => {
  assert.equal(escolherVozPt([v('Samantha', 'en-US'), v('Monica', 'es-ES')]), null);
  assert.equal(escolherVozPt([]), null);
});
