/**
 * Motor de navegação a pé (sem DOM, testável no Node).
 *
 *   const motor = new MotorNavegacao(rota, { velocidade: 0.75 });
 *   for (const ev of motor.atualizar(pos)) { ... }   // pos = { lat, lon, precisao }
 *   motor.estado  // progresso, próxima manobra, restante, chegada...
 *
 * Eventos (cada um disparado uma única vez, salvo indicação):
 *   manobra       { manobra, distancia, fase: 'previa' | 'agora' }  instrução de voz
 *   alerta        { alerta, distancia }   problema relatado à frente (vibra)
 *   pergunta      { alerta }              passou por um relato em verificação:
 *                                         perguntar se o problema ainda está lá
 *   fora_da_rota  { distancia }           N leituras seguidas longe da rota:
 *                                         o app recalcula a partir da posição
 *   de_volta      {}                      voltou para a rota
 *   chegada       {}                      perto do destino
 *
 * Robustez a GPS ruim: leituras com precisão pior que `precisaoMaxima` não
 * mudam o progresso; o progresso não anda para trás por ruído (só por mais
 * de `recuoMaximo` metros); "fora da rota" exige leituras consecutivas.
 */
import { Polilinha, distancia, falarDistancia } from './geo.js';

const PADRAO = {
  velocidade: 1.0, // m/s, depende do perfil
  raioForaRota: 30,
  leiturasForaRota: 3,
  raioChegada: 15,
  avisoPrevioM: 40,
  avisoAgoraM: 12,
  avisoAlertaM: 30,
  perguntaAposM: 10,
  precisaoMaxima: 60,
  recuoMaximo: 25,
};

export class MotorNavegacao {
  constructor(rota, opcoes = {}) {
    this.o = { ...PADRAO, ...opcoes };
    this.rota = rota;
    this.linha = new Polilinha(rota.geometria.coords, rota.geometria.acumulado_m);
    // A primeira manobra (início) é falada ao começar; não precisa de aviso prévio.
    this.manobras = (rota.manobras ?? []).map((m, i) => ({ ...m, indice: i }));
    this.alertas = (rota.alertas_no_caminho ?? []).slice().sort((a, b) => a.acumulado_m - b.acumulado_m);
    this.avisados = new Set(); // chaves "manobra:i:fase", "alerta:id", "pergunta:id"
    this.avisados.add('manobra:0:previa');
    this.avisados.add('manobra:0:agora');
    this.segmento = null;
    this.foraSeguidas = 0;
    this.estado = {
      s: 0,
      restante: this.linha.total,
      eta_min: Math.max(1, Math.round(this.linha.total / this.o.velocidade / 60)),
      proxima: this.manobras[1] ?? this.manobras[0] ?? null,
      distanciaProxima: this.manobras[1] ? this.manobras[1].acumulado_m : 0,
      foraDaRota: false,
      afastamento: 0,
      chegou: false,
      posicao: null,
      posicaoNaRota: this.linha.pontos[0],
      alertaAFrente: null,
    };
  }

  get total() {
    return this.linha.total;
  }

  atualizar(pos) {
    const eventos = [];
    const e = this.estado;
    e.posicao = pos;
    if (e.chegou) return eventos;
    if (pos.precisao != null && pos.precisao > this.o.precisaoMaxima) return eventos;

    const proj = this.linha.projetar(pos, this.segmento);
    if (!proj) return eventos;
    e.afastamento = proj.d;

    // --- fora da rota -----------------------------------------------------
    if (proj.d > this.o.raioForaRota) {
      this.foraSeguidas += 1;
      if (this.foraSeguidas >= this.o.leiturasForaRota && !e.foraDaRota) {
        e.foraDaRota = true;
        eventos.push({ tipo: 'fora_da_rota', distancia: Math.round(proj.d) });
      }
      return eventos; // longe da rota: não avança progresso
    }
    this.foraSeguidas = 0;
    if (e.foraDaRota) {
      e.foraDaRota = false;
      eventos.push({ tipo: 'de_volta' });
    }

    // --- progresso (monotônico com tolerância) -----------------------------
    if (proj.s >= e.s - this.o.recuoMaximo) {
      e.s = Math.max(e.s, proj.s);
      this.segmento = proj.segmento;
    }
    e.posicaoNaRota = proj.ponto;
    e.restante = Math.max(0, this.linha.total - e.s);
    e.eta_min = Math.max(e.restante > 0 ? 1 : 0, Math.round(e.restante / this.o.velocidade / 60));

    // --- chegada ----------------------------------------------------------
    const fim = this.linha.pontos[this.linha.pontos.length - 1];
    if (e.restante <= this.o.raioChegada || distancia(pos, fim) <= this.o.raioChegada) {
      e.chegou = true;
      e.restante = 0;
      eventos.push({ tipo: 'chegada' });
      return eventos;
    }

    // --- próxima manobra ----------------------------------------------------
    const proxima = this.manobras.find((m) => m.acumulado_m > e.s + 2 && m.tipo !== 'chegada')
      ?? this.manobras[this.manobras.length - 1];
    e.proxima = proxima;
    e.distanciaProxima = Math.max(0, proxima.acumulado_m - e.s);
    if (proxima.tipo !== 'chegada') {
      const d = e.distanciaProxima;
      const chave = (fase) => `manobra:${proxima.indice}:${fase}`;
      if (d <= this.o.avisoAgoraM && !this.avisados.has(chave('agora'))) {
        this.avisados.add(chave('agora'));
        this.avisados.add(chave('previa'));
        eventos.push({ tipo: 'manobra', fase: 'agora', manobra: proxima, distancia: Math.round(d) });
      } else if (d <= this.o.avisoPrevioM && d > this.o.avisoAgoraM && !this.avisados.has(chave('previa'))) {
        this.avisados.add(chave('previa'));
        eventos.push({ tipo: 'manobra', fase: 'previa', manobra: proxima, distancia: Math.round(d) });
      }
    }

    // --- alertas à frente e pergunta depois de passar -------------------
    e.alertaAFrente = null;
    for (const a of this.alertas) {
      const d = a.acumulado_m - e.s;
      if (d >= -5 && d <= this.o.avisoAlertaM) {
        e.alertaAFrente = { ...a, distancia: Math.max(0, Math.round(d)) };
        if (!this.avisados.has(`alerta:${a.id}`)) {
          this.avisados.add(`alerta:${a.id}`);
          eventos.push({ tipo: 'alerta', alerta: a, distancia: Math.max(0, Math.round(d)) });
        }
      }
      if (a.status_relato === 'em_verificacao' && -d >= this.o.perguntaAposM && !this.avisados.has(`pergunta:${a.id}`)) {
        this.avisados.add(`pergunta:${a.id}`);
        eventos.push({ tipo: 'pergunta', alerta: a });
      }
    }
    eventos.push({ tipo: 'progresso' });
    return eventos;
  }

  /** Frase para o botão "Repetir" e para a fala de cada manobra. */
  falaAtual() {
    const e = this.estado;
    if (e.chegou) return this.manobras[this.manobras.length - 1]?.fala ?? 'Você chegou.';
    if (e.foraDaRota) return 'Você saiu do caminho. Estou calculando de novo.';
    const m = e.proxima;
    if (!m) return '';
    if (m.tipo === 'chegada') return `Faltam ${falarDistancia(e.restante)} para chegar.`;
    const d = e.distanciaProxima;
    return d <= this.o.avisoAgoraM ? `${m.fala.split('.')[0]} agora.` : `Em ${falarDistancia(d)}, ${minusculaInicial(m.fala)}`;
  }

  static falaEvento(ev) {
    switch (ev.tipo) {
      case 'manobra':
        return ev.fase === 'agora'
          ? `${ev.manobra.fala.split('.')[0]} agora.`
          : `Em ${falarDistancia(ev.distancia)}, ${minusculaInicial(ev.manobra.fala)}`;
      case 'alerta': {
        const a = ev.alerta;
        const verbo = a.status_relato === 'em_verificacao' ? 'pode ter' : 'tem';
        const lado = a.lado_seguro ? ` Siga pela ${a.lado_seguro}.` : ' Vá com cuidado.';
        const onde = ev.distancia <= 5 ? 'Logo à frente' : `Em ${falarDistancia(ev.distancia)}`;
        return `Atenção. ${onde}, ${verbo} ${a.descricao}.${lado}`;
      }
      case 'fora_da_rota':
        return 'Você saiu do caminho. Estou calculando de novo.';
      case 'de_volta':
        return 'Você voltou para o caminho.';
      case 'chegada':
        return null; // a tela de chegada fala
      default:
        return null;
    }
  }
}

function minusculaInicial(t) {
  return t ? t[0].toLowerCase() + t.slice(1) : t;
}
