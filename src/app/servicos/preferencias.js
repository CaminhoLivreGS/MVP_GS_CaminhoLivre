/**
 * Preferências do usuário: ficam SÓ no aparelho (LGPD: o perfil de mobilidade
 * nunca vai para o servidor junto com identidade). localStorage pode falhar
 * (aba anônima, armazenamento cheio): tudo tem valor padrão.
 */
const CHAVE = 'caminhoLivre.preferencias.v1';

export const PADRAO = {
  onboardingFeito: false,
  perfis: [],
  vozAlta: true,
  vozDevagar: true,
  vibrar: true,
  letra: 'media',
  tema: 'claro',
  acompanhante: '',
  dispositivo: null,
};

function uuid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));
}

export function carregar() {
  let salvo = {};
  try {
    salvo = JSON.parse(localStorage.getItem(CHAVE) ?? '{}') ?? {};
  } catch {
    salvo = {};
  }
  const p = { ...PADRAO, ...salvo };
  if (!p.dispositivo) p.dispositivo = uuid();
  return p;
}

export function salvar(p) {
  try {
    localStorage.setItem(CHAVE, JSON.stringify(p));
  } catch {
    /* sem armazenamento: segue só em memória */
  }
}

export const NOMES_PERFIL = {
  bengala: 'Bengala ou andador',
  cadeira: 'Cadeira de rodas',
  baixa_visao: 'Enxergo pouco',
  sem_apoio: 'Sem apoio',
};

export const VELOCIDADE = { cadeira: 0.85, bengala: 0.75, baixa_visao: 0.85, sem_apoio: 1.2 };

export function velocidadePerfil(perfis) {
  const v = perfis.map((p) => VELOCIDADE[p]).filter(Boolean);
  return v.length ? Math.min(...v) : 1.1;
}
