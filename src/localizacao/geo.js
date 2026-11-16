/**
 * Geometria para navegação a pé (sem dependências; roda no navegador e no Node).
 * Distâncias em metros, ângulos em graus (0 = norte, 90 = leste).
 */
const R = 6371000;
const rad = (g) => (g * Math.PI) / 180;

export function distancia(a, b) {
  const p1 = rad(a.lat);
  const p2 = rad(b.lat);
  const dp = p2 - p1;
  const dl = rad(b.lon - a.lon);
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function rumo(a, b) {
  const p1 = rad(a.lat);
  const p2 = rad(b.lat);
  const dl = rad(b.lon - a.lon);
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Diferença angular com sinal em (-180, 180]: positivo = virar à direita. */
export function diferencaAngular(de, para) {
  return ((para - de + 540) % 360) - 180;
}

/** Interpola um ponto entre a e b (t de 0 a 1). */
export function interpolar(a, b, t) {
  return { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t };
}

/** Projeção equirretangular local do ponto p no segmento ab: { d, t }. */
export function projetarSegmento(p, a, b) {
  const kx = 111320 * Math.cos(rad(p.lat));
  const ky = 110540;
  const ax = (a.lon - p.lon) * kx;
  const ay = (a.lat - p.lat) * ky;
  const bx = (b.lon - p.lon) * kx;
  const by = (b.lat - p.lat) * ky;
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2));
  return { d: Math.hypot(ax + t * dx, ay + t * dy), t };
}

/**
 * Linha da rota com distância acumulada. Aceita coords como [[lat, lon], ...].
 * projetar() procura o segmento mais próximo; com `dica` (índice do último
 * segmento) prefere seguir em frente, evitando "pular" para um trecho
 * paralelo da própria rota (ex.: ida e volta na mesma rua).
 */
export class Polilinha {
  constructor(coords, acumulado) {
    this.pontos = coords.map(([lat, lon]) => ({ lat, lon }));
    if (acumulado && acumulado.length === coords.length) {
      this.acum = acumulado.slice();
    } else {
      this.acum = [0];
      for (let i = 1; i < this.pontos.length; i++) {
        this.acum.push(this.acum[i - 1] + distancia(this.pontos[i - 1], this.pontos[i]));
      }
    }
    this.total = this.acum[this.acum.length - 1] ?? 0;
  }

  projetar(p, dica = null, janela = 25) {
    let melhor = null;
    const n = this.pontos.length - 1;
    const ini = dica == null ? 0 : Math.max(0, dica - 3);
    const fim = dica == null ? n : Math.min(n, dica + janela);
    const testar = (i) => {
      const { d, t } = projetarSegmento(p, this.pontos[i], this.pontos[i + 1]);
      if (!melhor || d < melhor.d - 0.01) {
        const s = this.acum[i] + t * (this.acum[i + 1] - this.acum[i]);
        melhor = { d, t, segmento: i, s, ponto: interpolar(this.pontos[i], this.pontos[i + 1], t) };
      }
    };
    for (let i = ini; i < fim; i++) testar(i);
    // Se a janela local ficou longe, busca global (usuário pode ter cortado caminho).
    if (dica != null && (!melhor || melhor.d > 30)) for (let i = 0; i < n; i++) testar(i);
    return melhor;
  }

  /** Ponto e rumo a s metros do início. */
  pontoEm(s) {
    const alvo = Math.max(0, Math.min(this.total, s));
    let i = 0;
    while (i < this.acum.length - 2 && this.acum[i + 1] < alvo) i++;
    const len = this.acum[i + 1] - this.acum[i];
    const t = len > 0 ? (alvo - this.acum[i]) / len : 0;
    return { ...interpolar(this.pontos[i], this.pontos[i + 1], t), rumo: rumo(this.pontos[i], this.pontos[i + 1]), segmento: i };
  }
}

/** Arredonda distâncias para a fala: "20 metros", "150 metros", "1,2 quilômetro". */
export function falarDistancia(m) {
  if (m >= 1000) return `${(Math.round(m / 100) / 10).toString().replace('.', ',')} quilômetro${m >= 2000 ? 's' : ''}`;
  if (m >= 100) return `${Math.round(m / 50) * 50} metros`;
  if (m >= 30) return `${Math.round(m / 10) * 10} metros`;
  return `${Math.max(1, Math.round(m / 5) * 5)} metros`;
}

export function formatarDistancia(m) {
  if (m >= 1000) return `${(Math.round(m / 100) / 10).toString().replace('.', ',')} km`;
  return `${m >= 100 ? Math.round(m / 10) * 10 : Math.round(m)} m`;
}
