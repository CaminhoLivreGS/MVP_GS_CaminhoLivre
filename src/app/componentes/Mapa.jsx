import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

/**
 * Mapa real (ruas e nomes do OpenStreetMap, tiles da CARTO), como no Waze /
 * Google Maps, com os elementos do guia visual por cima: rota verde, rota
 * mais curta evitada (tracejado laranja), "!" nos problemas, você em amarelo.
 *
 * modo 'visao': enquadra rota e marcadores. modo 'seguir': acompanha a pessoa.
 * O mapa é complemento: toda informação dele também está em texto e voz.
 */
// Tiles padrão do OpenStreetMap (uso leve, com atribuição). O tema escuro é
// feito por filtro CSS. TODO: integrar um provedor de tiles com SLA/chave
// (MapTiler, Stadia ou servidor próprio) antes de abrir ao público.
const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATRIBUICAO = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

const icone = (classe, html = '') => L.divIcon({ className: '', html: `<span class="${classe}">${html}</span>`, iconSize: [0, 0] });
const ICONES = {
  voce: icone('pin-voce'),
  destino: icone('pin-destino'),
  perigo: icone('pin-perigo', '!'),
};

export function Mapa({ coords = [], comum = null, marcadores = [], posicao = null, modo = 'visao', rotulo, altura = 'media', zoomSeguir = 18 }) {
  const div = useRef(null);
  const mapa = useRef(null);
  const camadas = useRef(null);
  const tiles = useRef(null);
  const enquadrado = useRef(false);

  // cria o mapa uma vez
  useEffect(() => {
    const m = L.map(div.current, {
      zoomControl: false, attributionControl: true, keyboard: false, preferCanvas: false,
      zoomSnap: 0.5, maxZoom: 19,
    });
    m.attributionControl.setPrefix(false);
    m.setView([-23.55, -46.7], 14); // vista inicial: camadas de linha exigem centro e zoom definidos
    camadas.current = L.layerGroup().addTo(m);
    mapa.current = m;
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(div.current);
    return () => { ro.disconnect(); m.remove(); mapa.current = null; };
  }, []);

  // camada de ruas conforme o tema
  const tema = typeof document !== 'undefined' ? document.documentElement.dataset.tema : 'claro';
  useEffect(() => {
    const m = mapa.current;
    if (!m) return;
    tiles.current?.remove();
    tiles.current = L.tileLayer(TILES, { maxZoom: 19, attribution: ATRIBUICAO, className: `tiles-${tema}` }).addTo(m);
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
      L.marker([mk.lat, mk.lon], { icon: ICONES[mk.tipo] ?? ICONES.perigo, interactive: false, keyboard: false }).addTo(g);
    }
    enquadrado.current = false;
  }, [chaveRota, comum, marcadores.map((x) => `${x.lat},${x.lon}`).join('|')]); // eslint-disable-line react-hooks/exhaustive-deps

  // você (atualiza sem redesenhar a rota) + câmera
  const voce = useRef(null);
  useEffect(() => {
    const m = mapa.current;
    if (!m) return;
    if (posicao) {
      if (!voce.current) voce.current = L.marker([posicao.lat, posicao.lon], { icon: ICONES.voce, interactive: false, keyboard: false, zIndexOffset: 1000 }).addTo(m);
      else voce.current.setLatLng([posicao.lat, posicao.lon]);
    }
    if (modo === 'seguir' && posicao) {
      m.setView([posicao.lat, posicao.lon], enquadrado.current ? m.getZoom() : zoomSeguir, { animate: enquadrado.current });
      enquadrado.current = true;
      return;
    }
    if (enquadrado.current) return;
    const pts = [...coords, ...marcadores.map((x) => [x.lat, x.lon]), ...(posicao ? [[posicao.lat, posicao.lon]] : [])];
    if (pts.length === 1) m.setView(pts[0], 16);
    else if (pts.length > 1) m.fitBounds(L.latLngBounds(pts), { padding: [28, 28], maxZoom: 17 });
    enquadrado.current = pts.length > 0;
  }, [posicao?.lat, posicao?.lon, modo, chaveRota]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={`mapa mapa-${altura}`} role="img" aria-label={rotulo ?? 'Mapa do caminho'}>
      <div ref={div} className="mapa-leaflet" aria-hidden="true" />
    </div>
  );
}
