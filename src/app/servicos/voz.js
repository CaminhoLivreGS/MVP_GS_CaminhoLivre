/**
 * Voz do app: fala (speechSynthesis) e escuta (SpeechRecognition).
 * Tudo que é falado também aparece na tela (quem não ouve não perde nada),
 * e tudo que pode ser falado também pode ser digitado.
 */
let config = { ativa: true, devagar: true };
let vozPt = null;
let geracao = 0; // cada nova fala invalida a fila da anterior

const idioma = (v) => (v.lang ?? '').replace('_', '-').toLowerCase();

/**
 * Escolhe a voz em português (função pura, testada em test/voz.test.js).
 * Ordem: pt-BR de boa qualidade conhecida > qualquer pt-BR > pt-PT.
 * NUNCA devolve voz de outro idioma: voz inglesa lendo português fica
 * incompreensível, então é melhor não falar e avisar na tela.
 */
export function escolherVozPt(vozes = []) {
  const br = vozes.filter((v) => idioma(v) === 'pt-br');
  const preferidas = [/google/i, /luciana/i, /francisca|thalita|maria/i, /felipe|daniel|antonio/i];
  for (const re of preferidas) {
    const v = br.find((x) => re.test(x.name));
    if (v) return v;
  }
  return br.find((v) => v.localService) ?? br[0] ?? vozes.find((v) => idioma(v).startsWith('pt')) ?? null;
}

// O Chrome carrega as vozes DEPOIS da página: falar antes disso usava a voz
// padrão do sistema (inglês). Por isso toda fala espera as vozes ficarem prontas.
let vozesProntas = null;
function prepararVozes() {
  if (vozesProntas) return vozesProntas;
  vozesProntas = new Promise((resolve) => {
    const s = globalThis.speechSynthesis;
    if (!s) return resolve(null);
    const pegar = () => {
      const lista = s.getVoices();
      if (lista.length) {
        vozPt = escolherVozPt(lista);
        resolve(vozPt);
        return true;
      }
      return false;
    };
    if (pegar()) return;
    s.addEventListener?.('voiceschanged', pegar);
    setTimeout(() => { if (!pegar()) resolve(null); }, 2500);
  });
  return vozesProntas;
}
if (globalThis.speechSynthesis) {
  prepararVozes();
  // Lista de vozes pode mudar (ex.: voz instalada depois): escolhe de novo.
  speechSynthesis.addEventListener?.('voiceschanged', () => { vozPt = escolherVozPt(speechSynthesis.getVoices()); });
}

/** true/false quando souber se há voz em português; null se o navegador não fala. */
export async function temVozPortugues() {
  if (!globalThis.speechSynthesis) return null;
  return Boolean(await prepararVozes());
}

export function configurarVoz(c) {
  config = { ...config, ...c };
  if (!config.ativa) calar();
}

export const somAtivo = () => config.ativa;
export const vozDisponivel = () => Boolean(globalThis.speechSynthesis);

/**
 * Fala o texto. `forcar` fala mesmo com o som desligado (pedido explícito,
 * ex.: "Ouvir explicação"). Frase por frase: o Chrome corta falas longas.
 */
export async function falar(texto, { forcar = false, interromper = true } = {}) {
  if (!texto || !globalThis.speechSynthesis || (!config.ativa && !forcar)) return;
  const minha = ++geracao;
  if (interromper) speechSynthesis.cancel();
  const voz = await prepararVozes();
  if (!voz || minha !== geracao) return; // sem voz em português: não fala em outro idioma
  const frases = String(texto).match(/[^.!?]+[.!?]*/g)?.map((f) => f.trim()).filter(Boolean) ?? [texto];
  for (const frase of frases) {
    if (minha !== geracao || (!config.ativa && !forcar)) return;
    await new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(frase);
      u.voice = voz;
      u.lang = voz.lang;
      u.rate = config.devagar ? 0.85 : 1.0;
      const limite = setTimeout(resolve, 4000 + frase.length * 120); // alguns navegadores não disparam onend
      u.onend = () => { clearTimeout(limite); resolve(); };
      u.onerror = u.onend;
      if (minha !== geracao || (!config.ativa && !forcar)) { clearTimeout(limite); resolve(); return; }
      speechSynthesis.speak(u);
    });
  }
}

export function calar() {
  geracao++;
  globalThis.speechSynthesis?.cancel();
}

// TODO: integrar reconhecimento de fala no servidor (ex.: Whisper) para navegadores sem SpeechRecognition (Firefox, iOS antigo).
const Reconhecimento = globalThis.SpeechRecognition ?? globalThis.webkitSpeechRecognition;
export const escutaDisponivel = () => Boolean(Reconhecimento);

/**
 * Escuta uma frase. aoParcial(texto) recebe o texto enquanto a pessoa fala.
 * Retorna { pronto: Promise<string>, parar() }.
 */
/**
 * Escuta o microfone. Com { continuo: true } grava até a pessoa chamar parar(),
 * mesmo com pausas na fala (o navegador encerra sessões sozinho; reiniciamos).
 * parar() entrega TUDO o que foi dito, inclusive o trecho ainda não confirmado
 * pelo reconhecedor, para nada se perder ao apertar "Parar".
 */
export function escutar(aoParcial = () => {}, { continuo = false } = {}) {
  if (!Reconhecimento) return { pronto: Promise.reject(new Error('SEM_SUPORTE')), parar() {} };
  calar();
  const r = new Reconhecimento();
  r.lang = 'pt-BR';
  r.interimResults = true;
  r.maxAlternatives = 1;
  r.continuous = continuo;
  let anterior = ''; // texto de sessões já encerradas pelo navegador
  let final = '';
  let parcial = '';
  let paradoPelaPessoa = false;
  let falhou = null;
  const juntar = (...partes) => partes.map((p) => p.trim()).filter(Boolean).join(' ');
  const texto = () => juntar(anterior, final, parcial);
  const pronto = new Promise((resolve, reject) => {
    r.onresult = (ev) => {
      final = '';
      parcial = '';
      for (const res of ev.results) {
        if (res.isFinal) final += ` ${res[0].transcript}`;
        else parcial += ` ${res[0].transcript}`;
      }
      aoParcial(texto());
    };
    r.onerror = (ev) => {
      if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') falhou = 'PERMISSAO_NEGADA';
      else if (continuo && (ev.error === 'no-speech' || ev.error === 'aborted')) return; // pausa: segue gravando
      else falhou = ev.error === 'no-speech' ? 'SEM_FALA' : 'ERRO';
    };
    r.onend = () => {
      if (continuo && !paradoPelaPessoa && !falhou) {
        anterior = texto();
        final = '';
        parcial = '';
        try { r.start(); return; } catch { /* não reiniciou: entrega o que tem */ }
      }
      const t = texto();
      if (t) resolve(t);
      else reject(new Error(falhou ?? 'SEM_FALA'));
    };
  });
  r.start();
  return {
    pronto,
    parar: () => {
      paradoPelaPessoa = true;
      r.stop();
    },
  };
}

let vibrarAtivo = true;
export function configurarVibracao(v) {
  vibrarAtivo = v;
}
export function vibrar(padrao) {
  if (vibrarAtivo && globalThis.navigator?.vibrate) navigator.vibrate(padrao);
}
export const VIBRA = { manobra: [120], alerta: [250, 120, 250, 120, 250], chegada: [80, 60, 80, 60, 300] };
