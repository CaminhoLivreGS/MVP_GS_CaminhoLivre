/**
 * Preferências do usuário: ficam SÓ no aparelho (LGPD: o perfil de mobilidade
 * nunca vai para o servidor junto com identidade). localStorage pode falhar
 * (aba anônima, armazenamento cheio): tudo tem valor padrão.
 */
const CHAVE = 'caminhoLivre.preferencias.v1';

export const PADRAO = {
  onboardingFeito: false,
  // 'fala' (voz conduz: microfone em destaque, tudo narrado) ou 'digitar' (telas com texto; voz quando quiser)
  modo: null,
  perfis: [],
  // valem para qualquer perfil: nunca escada, caminho plano, ruas iluminadas
  preferenciasRota: [],
  // Perfis de caminhada salvos (ex.: "Eu" e "Minha mãe"), para quem planeja rotas para outra pessoa.
  // `perfis`/`preferenciasRota` acima são sempre os do perfil ativo (o resto do app lê só eles).
  perfisSalvos: [],
  perfilAtivo: null,
  vozAlta: true,
  vozDevagar: true,
  vibrar: true,
  letra: 'media',
  tema: 'claro',
  acompanhante: '',
  // App de corrida preferido para destinos longe ('uber' | '99' | 'indrive' | null). Fica só no aparelho.
  appCorrida: null,
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
  // Quem já usava o app (versão sem perfis salvos) ganha o perfil "Eu" com o que tinha escolhido.
  if (!p.perfisSalvos?.length && p.perfis?.length) {
    p.perfisSalvos = [{ id: 'eu', nome: 'Eu', perfis: p.perfis, preferenciasRota: p.preferenciasRota ?? [] }];
    p.perfilAtivo = 'eu';
  }
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
  muletas: 'Muletas',
  baixa_visao: 'Enxergo pouco',
  sem_apoio: 'Sem apoio',
};

export const VELOCIDADE = { cadeira: 0.85, bengala: 0.75, muletas: 0.7, baixa_visao: 0.85, sem_apoio: 1.2 };

export const NOMES_PREFERENCIA = {
  sem_escada: 'Nunca usar escadas',
  plano: 'Prefiro caminhos planos',
  iluminado: 'Prefiro ruas iluminadas',
};

export function velocidadePerfil(perfis) {
  const v = perfis.map((p) => VELOCIDADE[p]).filter(Boolean);
  return v.length ? Math.min(...v) : 1.1;
}

export const novoIdPerfil = () => `p${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;

/** Resumo curto de um perfil para mostrar na tela ("Cadeira de rodas · nunca usar escadas"). */
export function resumoPerfil(p) {
  if (!p?.perfis?.length) return 'Sem perfil cadastrado';
  return [p.perfis.map((x) => NOMES_PERFIL[x]).join(', '), ...(p.preferenciasRota ?? []).map((x) => NOMES_PREFERENCIA[x]?.toLowerCase())]
    .filter(Boolean).join(' · ');
}

/**
 * Salva (cria ou atualiza) um perfil e o deixa ativo. Devolve as mudanças para setPrefs.
 * Função pura: testada em test/perfis.test.js.
 */
export function salvarPerfil(prefs, { id, nome, perfis, preferenciasRota }) {
  const lista = [...(prefs.perfisSalvos ?? [])];
  const pid = id ?? novoIdPerfil();
  const k = lista.findIndex((x) => x.id === pid);
  const anterior = k >= 0 ? lista[k] : null;
  const item = { id: pid, nome: (nome ?? anterior?.nome ?? 'Eu').trim().slice(0, 24) || 'Eu', perfis, preferenciasRota: preferenciasRota ?? [] };
  if (k >= 0) lista[k] = item; else lista.push(item);
  return { perfisSalvos: lista, perfilAtivo: pid, perfis, preferenciasRota: item.preferenciasRota };
}

export function usarPerfil(prefs, id) {
  const p = (prefs.perfisSalvos ?? []).find((x) => x.id === id);
  return p ? { perfilAtivo: id, perfis: p.perfis, preferenciasRota: p.preferenciasRota ?? [] } : {};
}

export function apagarPerfil(prefs, id) {
  const lista = (prefs.perfisSalvos ?? []).filter((x) => x.id !== id);
  if (prefs.perfilAtivo !== id) return { perfisSalvos: lista };
  const prox = lista[0];
  return { perfisSalvos: lista, perfilAtivo: prox?.id ?? null, perfis: prox?.perfis ?? [], preferenciasRota: prox?.preferenciasRota ?? [] };
}
