/**
 * Destino longe: quando ir a pé deixa de fazer sentido e quais alternativas
 * oferecer (ônibus, carro, carro por aplicativo). Funções puras (testadas em
 * test/transporte.test.js); as telas ficam em telas/Longe.jsx.
 */
import { distancia } from '../../localizacao/geo.js';

// Mesmas velocidades do roteamento da API (api/app/roteamento.py), em m/s.
const VELOCIDADE_MS = { cadeira: 0.85, bengala: 0.75, muletas: 0.7, baixa_visao: 0.85, sem_apoio: 1.2 };
// O caminho pelas calçadas é, em média, ~30% maior que a linha reta.
const FATOR_CAMINHO = 1.3;
// Acima disso a API nem calcula rota a pé (linha reta).
export const MAXIMO_A_PE_M = 8000;

/** Até quantos metros (pelas calçadas) ir a pé é razoável para este perfil. */
export function limiteAPe(perfis = [], idoso = false) {
  const comApoio = perfis.some((p) => p !== 'sem_apoio');
  return comApoio || idoso ? 1000 : 2000;
}

/**
 * Avalia a ida a pé até o destino.
 * @returns {{ linhaReta, caminho, minutos, longe, aPePossivel }}
 */
export function avaliarDistancia(origem, destino, perfis = [], idoso = false) {
  const linhaReta = distancia(origem, destino);
  const caminho = Math.round(linhaReta * FATOR_CAMINHO);
  const lista = perfis.length ? perfis : ['sem_apoio'];
  const vel = Math.min(...lista.map((p) => VELOCIDADE_MS[p] ?? 1.1)) * (idoso ? 0.85 : 1);
  return {
    linhaReta,
    caminho,
    minutos: Math.round(caminho / vel / 60),
    longe: caminho > limiteAPe(lista, idoso),
    aPePossivel: linhaReta <= MAXIMO_A_PE_M,
  };
}

export function formatarKm(m) {
  return m < 1000 ? `${Math.round(m / 50) * 50} metros` : `${(m / 1000).toFixed(1).replace('.', ',')} km`;
}

export function formatarTempo(min) {
  if (min < 60) return `${min} minutos`;
  const h = Math.floor(min / 60);
  const resto = min % 60;
  return `${h} hora${h > 1 ? 's' : ''}${resto ? ` e ${resto} minutos` : ''}`;
}

const enc = encodeURIComponent;
const ll = (p) => `${p.lat},${p.lon}`;

/** Links para ônibus e carro (abrem o app instalado ou o site). */
export const links = {
  onibusGoogle: (o, d) => `https://www.google.com/maps/dir/?api=1&origin=${ll(o)}&destination=${ll(d)}&travelmode=transit`,
  onibusMoovit: (o, d) => `https://moovitapp.com/?from=${enc(o.nome ?? 'Origem')}&fll=${o.lat}_${o.lon}&to=${enc(d.nome ?? 'Destino')}&tll=${d.lat}_${d.lon}&lang=pt`,
  carroGoogle: (o, d) => `https://www.google.com/maps/dir/?api=1&origin=${ll(o)}&destination=${ll(d)}&travelmode=driving`,
  carroWaze: (_o, d) => `https://waze.com/ul?ll=${ll(d)}&navigate=yes`,
};

/**
 * Apps de corrida. `comDestino`: o link já abre o app com o destino preenchido.
 * Sem link público documentado (99, inDrive), o app abre e o endereço vai para a
 * área de transferência, para a pessoa colar no campo de destino.
 */
export const APPS_CORRIDA = [
  {
    id: 'uber', nome: 'Uber', comDestino: true,
    link: (o, d) => `https://m.uber.com/ul/?action=setPickup&pickup[latitude]=${o.lat}&pickup[longitude]=${o.lon}`
      + `&dropoff[latitude]=${d.lat}&dropoff[longitude]=${d.lon}&dropoff[nickname]=${enc(d.nome ?? 'Destino')}`
      + (d.endereco ? `&dropoff[formatted_address]=${enc(d.endereco)}` : ''),
  },
  { id: '99', nome: '99', comDestino: false, link: () => 'https://99app.com/' },
  { id: 'indrive', nome: 'inDrive', comDestino: false, link: () => 'https://indrive.com/' },
];

export const appCorrida = (id) => APPS_CORRIDA.find((a) => a.id === id) ?? null;

/** Texto do destino para colar no app de corrida. */
export const enderecoParaColar = (d) => [d.nome, d.endereco].filter(Boolean).join(', ');
