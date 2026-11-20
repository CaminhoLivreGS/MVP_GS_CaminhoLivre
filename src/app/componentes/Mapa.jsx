import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

/**
 * Mapa real dentro do app (ruas e nomes do OpenStreetMap, desenhados pela
 * MapTiler), com os elementos do guia visual por cima: rota verde, rota
 * mais curta evitada (tracejado laranja), "!" nos problemas, você em amarelo.
 *
 * modo 'visao': enquadra rota e marcadores. modo 'seguir': acompanha a pessoa.
 * O mapa é complemento: toda informação dele também está em texto e voz.
 */
// Provedor principal: MapTiler (chave pública de navegador em VITE_MAPTILER_KEY,
// restrita por domínio no painel da MapTiler). Tiles 512 px com versão @2x em
// tela retina; estilo escuro nos temas Escuro e Contraste.
// Reserva: tiles públicos do OpenStreetMap, usados sem chave ou se a MapTiler
// falhar (cota estourada, domínio não liberado, fora do ar).
const CHAVE_MAPTILER = (import.meta.env?.VITE_MAPTILER_KEY ?? '').trim();
const ESTILO_MAPTILER = { claro: 'base-v4', escuro: 'base-v4-dark', contraste: 'base-v4-dark' };
const ATRIBUICAO_OSM = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
const ATRIBUICAO_MAPTILER = '<a href="https://www.maptiler.com/copyright/">© MapTiler</a> '
  + '<a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a>';
const FALHAS_PARA_RESERVA = 4; // tiles com erro antes de o primeiro carregar
let maptilerFalhou = false;    // vale para todos os mapas da sessão

function camadaOsm() {
  return L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: ATRIBUICAO_OSM, className: 'tiles-osm' });
}

function camadaMapTiler(tema) {
  const estilo = ESTILO_MAPTILER[tema] ?? ESTILO_MAPTILER.claro;
  return L.tileLayer(`https://api.maptiler.com/maps/${estilo}/{z}/{x}/{y}{r}.png?key=${encodeURIComponent(CHAVE_MAPTILER)}`, {
    tileSize: 512, zoomOffset: -1, minZoom: 1, maxZoom: 19, crossOrigin: true, attribution: ATRIBUICAO_MAPTILER, className: 'tiles-maptiler',
  });
}

/** Põe a camada de ruas no mapa; se a MapTiler falhar, troca sozinho para o OSM. */
function camadaRuas(m, tema) {
  if (!CHAVE_MAPTILER || maptilerFalhou) return camadaOsm().addTo(m);
  const camada = camadaMapTiler(tema);
  let carregou = false;
  let falhas = 0;
  camada.on('tileload', () => { carregou = true; });
  camada.on('tileerror', () => {
    if (carregou || ++falhas < FALHAS_PARA_RESERVA) return;
    maptilerFalhou = true;
    console.warn('[mapa] MapTiler indisponível; usando tiles do OpenStreetMap.');
    camada.remove();
    if (m._caminhoLivreRuas === camada) m._caminhoLivreRuas = camadaOsm().addTo(m);
  });
  return camada.addTo(m);
}

const icone = (classe, html = '') => L.divIcon({ className: '', html: `<span class="${classe}">${html}</span>`, iconSize: [0, 0] });
const ICONES = {
  voce: icone('pin-voce'),
  destino: icone('pin-destino'),
  perigo: icone('pin-perigo', '!'),
  // mapa de barreiras: confirmado (!), em verificação (?), selecionado (anel)
  verificacao: icone('pin-perigo pin-verificacao', '?'),
  perigo_sel: icone('pin-perigo pin-selecionado', '!'),
  verificacao_sel: icone('pin-perigo pin-verificacao pin-selecionado', '?'),
};

// focoAcima: no modo 'seguir', desloca a pessoa do centro (fração da altura; negativo = mais
// abaixo), para não ficar escondida atrás do que flutua sobre o mapa.
// aoSoltar: a pessoa arrastou o mapa (para de seguir). recentrar: mude o número para voltar a seguir.
export function Mapa({ coords = [], comum = null, marcadores = [], posicao = null, modo = 'visao', rotulo, altura = 'media',
  zoomSeguir = 18, focoAcima = 0, aoSoltar, recentrar = 0, aoTocarMarcador, margemInferior = 0, margemTopo = 0 }) {
  const tocar = useRef(aoTocarMarcador);
  tocar.current = aoTocarMarcador;
  const div = useRef(null);
  const livre = useRef(false);
  const ultimo = useRef({ modo, aoSoltar, posicao });
  ultimo.current = { modo, aoSoltar, posicao };
  const mapa = useRef(null);
  const camadas = useRef(null);
  const tiles = useRef(null);
  const enquadrado = useRef(false);
  // mapa de barreiras: trocar o marcador selecionado não deve reenquadrar o mapa
  const manterEnquadramento = useRef(false);
  const voce = useRef(null);

  // cria o mapa uma vez
  useEffect(() => {
    const m = L.map(div.current, {
      zoomControl: false, attributionControl: true, keyboard: false, preferCanvas: false,
      zoomSnap: 0.5, maxZoom: 19,
    });
    m.attributionControl.setPrefix(false);
    m.setView([-23.55, -46.7], 14); // vista inicial: camadas de linha exigem centro e zoom definidos
    m.on('dragstart', () => {
      if (ultimo.current.modo !== 'seguir' || livre.current) return;
      livre.current = true;
      ultimo.current.aoSoltar?.();
    });
    camadas.current = L.layerGroup().addTo(m);
    mapa.current = m;
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(div.current);
    return () => {
      ro.disconnect();
      m.remove();
      // O mapa pode ser recriado no mesmo componente (React StrictMode monta duas vezes):
      // o estado que pertence ao mapa antigo não pode passar para o novo.
      mapa.current = null;
      voce.current = null;
      tiles.current = null;
      enquadrado.current = false;
      manterEnquadramento.current = false;
    };
  }, []);

  // camada de ruas conforme o tema
  const tema = typeof document !== 'undefined' ? document.documentElement.dataset.tema : 'claro';
  useEffect(() => {
    const m = mapa.current;
    if (!m) return;
    (m._caminhoLivreRuas ?? tiles.current)?.remove();
    m._caminhoLivreRuas = camadaRuas(m, tema);
    tiles.current = m._caminhoLivreRuas;
  }, [tema]);

  // rota, marcadores e enquadramento
  const chaveRota = coords.length ? `${coords.length}:${coords[0]}:${coords.at(-1)}` : 'sem';
  useEffect(() => {
    const m = mapa.current;
    const g = camadas.current;
    if (!m) return;
    g.clearLayers();
    if (comum && comum.length > 1) L.polyline(comum, { className: 'mapa-comum', weight: 5, dashArray: '2 10', lineCap: 'round' }).addTo(g);
    if (coords.length > 1) {
      L.polyline(coords, { className: 'mapa-rota-borda', weight: 11, lineCap: 'round', lineJoin: 'round' }).addTo(g);
      L.polyline(coords, { className: 'mapa-rota', weight: 7, lineCap: 'round', lineJoin: 'round' }).addTo(g);
      L.marker(coords.at(-1), { icon: ICONES.destino, interactive: false, keyboard: false }).addTo(g);
    }
    for (const mk of marcadores) {
      // Tocável só quando a tela oferece a mesma ação numa lista acessível (o mapa é aria-hidden).
      const clicavel = Boolean(tocar.current && mk.id);
      const m2 = L.marker([mk.lat, mk.lon], { icon: ICONES[mk.tipo] ?? ICONES.perigo, interactive: clicavel, keyboard: false }).addTo(g);
      if (clicavel) m2.on('click', () => tocar.current?.(mk.id));
    }
    if (!manterEnquadramento.current) enquadrado.current = false;
    manterEnquadramento.current = Boolean(tocar.current);
  }, [chaveRota, comum, marcadores.map((x) => `${x.lat},${x.lon},${x.tipo}`).join('|')]); // eslint-disable-line react-hooks/exhaustive-deps

  // você (atualiza sem redesenhar a rota) + câmera
  useEffect(() => {
    const m = mapa.current;
    if (!m) return;
    if (posicao) {
      if (!voce.current) voce.current = L.marker([posicao.lat, posicao.lon], { icon: ICONES.voce, interactive: false, keyboard: false, zIndexOffset: 1000 }).addTo(m);
      else voce.current.setLatLng([posicao.lat, posicao.lon]);
    }
    if (modo === 'seguir' && posicao) {
      if (livre.current) return; // a pessoa está olhando o mapa: não puxa de volta
      const z = enquadrado.current ? m.getZoom() : zoomSeguir;
      const alvo = focoAcima
        ? m.unproject(m.project([posicao.lat, posicao.lon], z).add([0, m.getSize().y * focoAcima]), z)
        : [posicao.lat, posicao.lon];
      m.setView(alvo, z, { animate: enquadrado.current });
      enquadrado.current = true;
      return;
    }
    if (enquadrado.current) return;
    const pts = [...coords, ...marcadores.map((x) => [x.lat, x.lon]), ...(posicao ? [[posicao.lat, posicao.lon]] : [])];
    if (!pts.length) return;
    enquadrado.current = true;
    let tentativas = 0;
    let espera = null;
    const enquadrar = () => {
      const mm = mapa.current;
      if (!mm) return;
      mm.invalidateSize();
      // Recém-montado, o mapa pode ainda não ter altura: o fitBounds daria um zoom inválido. Espera o layout.
      if (mm.getSize().y < 50 && tentativas++ < 20) { espera = setTimeout(enquadrar, 50); return; }
      // margemInferior (fração da altura) e margemTopo (px): espaço coberto pelos painéis flutuantes.
      const baixo = 28 + mm.getSize().y * margemInferior;
      const topo = 28 + margemTopo;
      if (pts.length === 1) {
        mm.setView(pts[0], 16);
        if (margemInferior || margemTopo) mm.panBy([0, (baixo - topo) / 2], { animate: false });
      } else mm.fitBounds(L.latLngBounds(pts), { paddingTopLeft: [28, topo], paddingBottomRight: [28, baixo], maxZoom: 17 });
    };
    enquadrar();
    return () => clearTimeout(espera);
  }, [posicao?.lat, posicao?.lon, modo, chaveRota]); // eslint-disable-line react-hooks/exhaustive-deps

  // Recentralizar: volta a seguir a pessoa no zoom de navegação.
  useEffect(() => {
    const m = mapa.current;
    const p = ultimo.current.posicao;
    if (!recentrar || !m) return;
    livre.current = false;
    if (p) {
      const alvo = focoAcima ? m.unproject(m.project([p.lat, p.lon], zoomSeguir).add([0, m.getSize().y * focoAcima]), zoomSeguir) : [p.lat, p.lon];
      m.setView(alvo, zoomSeguir, { animate: true });
    }
  }, [recentrar]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={`mapa mapa-${altura}`} role="img" aria-label={rotulo ?? 'Mapa do caminho'}>
      <div ref={div} className="mapa-leaflet" aria-hidden="true" />
    </div>
  );
}
