/**
 * Fontes de posição com a mesma interface:
 *   const f = new FonteGPS();  f.iniciar((pos) => ..., (erro) => ...);  f.parar();
 *   pos = { lat, lon, precisao, rumo, velocidade, t, simulada }
 *
 * FonteGPS: Geolocation API (watchPosition) com filtro de precisão e
 *   suavização. Precisão ruim (> 60 m, comum entre prédios) é descartada,
 *   mas avisada, para o app não "pular" de calçada.
 * FonteSimulada: anda pela rota numa velocidade de caminhada (para a banca
 *   e para testes fora do território). Pode acelerar, pausar e desviar.
 */
import { Polilinha, distancia, rumo } from './geo.js';

// Localização fixa (gravação de vídeo / demonstração sem expor o endereço real):
// VITE_LOCAL_FIXO="lat,lon,Nome" no .env.local. Com ela, o GPS do aparelho NUNCA é consultado.
function lerLocalFixo(txt) {
  const [lat, lon, ...nome] = String(txt ?? '').split(',');
  const p = { lat: Number(lat), lon: Number(lon), nome: nome.join(',').trim() || 'Você' };
  return Number.isFinite(p.lat) && Number.isFinite(p.lon) && lat.trim() && lon.trim() ? p : null;
}
export const LOCAL_FIXO = lerLocalFixo(import.meta.env?.VITE_LOCAL_FIXO);

export const ERROS_GPS = {
  1: 'PERMISSAO_NEGADA',
  2: 'SEM_SINAL',
  3: 'DEMOROU',
};

export class FonteGPS {
  constructor({ precisaoMaxima = 60, suavizacao = 0.5, geo = globalThis.navigator?.geolocation } = {}) {
    this.geo = geo;
    this.precisaoMaxima = precisaoMaxima;
    this.alfa = suavizacao;
    this.id = null;
    this.ultima = null;
    this.simulada = false;
  }

  static disponivel() {
    return Boolean(globalThis.navigator?.geolocation);
  }

  iniciar(aoMudar, aoErro = () => {}) {
    if (LOCAL_FIXO) {
      aoMudar({ lat: LOCAL_FIXO.lat, lon: LOCAL_FIXO.lon, precisao: 5, t: Date.now(), rumo: null, velocidade: 0, simulada: false });
      return;
    }
    if (!this.geo) {
      aoErro({ codigo: 'SEM_SUPORTE' });
      return;
    }
    this.id = this.geo.watchPosition(
      ({ coords, timestamp }) => {
        if (coords.accuracy > this.precisaoMaxima) {
          aoErro({ codigo: 'PRECISAO_BAIXA', precisao: Math.round(coords.accuracy) });
          return;
        }
        let pos = { lat: coords.latitude, lon: coords.longitude, precisao: coords.accuracy, t: timestamp };
        if (this.ultima) {
          // Média exponencial ponderada pela precisão: leituras boas pesam mais.
          const peso = Math.min(1, this.alfa * (this.ultima.precisao / Math.max(coords.accuracy, 1)));
          pos.lat = this.ultima.lat + (pos.lat - this.ultima.lat) * Math.max(peso, 0.35);
          pos.lon = this.ultima.lon + (pos.lon - this.ultima.lon) * Math.max(peso, 0.35);
          const d = distancia(this.ultima, pos);
          pos.rumo = d > 2 ? rumo(this.ultima, pos) : (coords.heading ?? this.ultima.rumo ?? null);
          pos.velocidade = coords.speed ?? d / Math.max((timestamp - this.ultima.t) / 1000, 0.5);
        } else {
          pos.rumo = coords.heading ?? null;
          pos.velocidade = coords.speed ?? 0;
        }
        pos.simulada = false;
        this.ultima = pos;
        aoMudar(pos);
      },
      (e) => aoErro({ codigo: ERROS_GPS[e.code] ?? 'DESCONHECIDO', mensagem: e.message }),
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 },
    );
  }

  parar() {
    if (this.id != null) this.geo?.clearWatch(this.id);
    this.id = null;
  }

  /** Uma leitura só (para a tela inicial): Promise<pos>. */
  static obterUmaVez({ timeout = 12000, geo = globalThis.navigator?.geolocation } = {}) {
    return new Promise((resolve, reject) => {
      if (LOCAL_FIXO) return resolve({ lat: LOCAL_FIXO.lat, lon: LOCAL_FIXO.lon, precisao: 5, t: Date.now() });
      if (!geo) return reject({ codigo: 'SEM_SUPORTE' });
      geo.getCurrentPosition(
        ({ coords, timestamp }) => resolve({ lat: coords.latitude, lon: coords.longitude, precisao: coords.accuracy, t: timestamp }),
        (e) => reject({ codigo: ERROS_GPS[e.code] ?? 'DESCONHECIDO' }),
        { enableHighAccuracy: true, maximumAge: 30000, timeout },
      );
    });
  }
}

export class FonteSimulada {
  /**
   * @param {{coords: number[][], acumulado_m?: number[]}} geometria da rota
   * @param {object} o velocidade (m/s), multiplicador, intervaloMs, relogio (para testes)
   */
  constructor(geometria, { velocidade = 1.0, multiplicador = 4, intervaloMs = 1000, ruido = 0, agendar } = {}) {
    this.linha = new Polilinha(geometria.coords, geometria.acumulado_m);
    this.velocidade = velocidade;
    this.multiplicador = multiplicador;
    this.intervaloMs = intervaloMs;
    this.ruido = ruido;
    this.s = 0;
    this.pausado = false;
    this.desvioM = 0; // afastamento lateral (simula sair da rota)
    this.timer = null;
    this.simulada = true;
    this.agendar = agendar ?? ((fn, ms) => setInterval(fn, ms));
    this.cancelar = agendar ? () => {} : (id) => clearInterval(id);
  }

  iniciar(aoMudar) {
    this.aoMudar = aoMudar;
    this.emitir();
    this.timer = this.agendar(() => this.passo(), this.intervaloMs);
  }

  passo() {
    if (this.pausado) return;
    this.s = Math.min(this.linha.total, this.s + this.velocidade * this.multiplicador * (this.intervaloMs / 1000));
    this.emitir();
  }

  emitir() {
    const p = this.linha.pontoEm(this.s);
    let { lat, lon } = p;
    if (this.desvioM) {
      // desloca perpendicularmente ao rumo (à direita)
      const ang = ((p.rumo + 90) * Math.PI) / 180;
      lat += (Math.cos(ang) * this.desvioM) / 110540;
      lon += (Math.sin(ang) * this.desvioM) / (111320 * Math.cos((lat * Math.PI) / 180));
    }
    if (this.ruido) {
      lat += ((Math.random() - 0.5) * this.ruido) / 110540;
      lon += ((Math.random() - 0.5) * this.ruido) / 111320;
    }
    this.aoMudar?.({ lat, lon, precisao: 5, rumo: p.rumo, velocidade: this.pausado ? 0 : this.velocidade, t: Date.now(), simulada: true });
  }

  pausar(v = true) {
    this.pausado = v;
  }

  sairDaRota(metros = 60) {
    this.desvioM = metros;
  }

  parar() {
    if (this.timer != null) this.cancelar(this.timer);
    this.timer = null;
  }
}
