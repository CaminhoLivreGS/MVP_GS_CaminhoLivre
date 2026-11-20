import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Status: cores reservadas da paleta de status, sempre acompanhadas do nome (legenda e dica).
export const COR_STATUS = {
  em_verificacao: '#fab219', confirmado: '#d03b3b', encaminhado: '#ec835a', resolvido: '#0ca30c', descartado: '#8a8984',
};
// Rampa sequencial azul (claro = poucos problemas ativos, escuro = muitos).
const RAMPA = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95'];

/** Mapa do painel: setores pintados pela quantidade de problemas ativos + cada ocorrência por status. */
export function MapaAdm({ relatos, regioes, porRegiao, nomesStatus, nomesCategoria, aoSelecionar, regiaoSel }) {
  const div = useRef(null);
  const mapa = useRef(null);
  const camadas = useRef(null);
  const sel = useRef(aoSelecionar);
  sel.current = aoSelecionar;

  useEffect(() => {
    const m = L.map(div.current, { zoomControl: true, attributionControl: true });
    m.attributionControl.setPrefix(false);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(m);
    camadas.current = L.layerGroup().addTo(m);
    mapa.current = m;
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(div.current);
    return () => { ro.disconnect(); m.remove(); };
  }, []);

  useEffect(() => {
    const m = mapa.current;
    const g = camadas.current;
    if (!m || !regioes?.length) return;
    g.clearLayers();
    const ativos = Object.fromEntries((porRegiao ?? []).map((r) => [r.regiao, r.ativos]));
    const max = Math.max(1, ...Object.values(ativos));
    const limites = L.latLngBounds([]);
    for (const r of regioes) {
      const [s, w, n, e] = r.bbox;
      const v = ativos[r.nome] ?? 0;
      const passo = v === 0 ? 0 : Math.min(RAMPA.length - 1, Math.ceil((v / max) * (RAMPA.length - 1)));
      const ret = L.rectangle([[s, w], [n, e]], {
        color: regiaoSel === r.nome ? '#0b0b0b' : '#ffffff', weight: regiaoSel === r.nome ? 3 : 2,
        fillColor: RAMPA[passo], fillOpacity: v === 0 ? 0.08 : 0.42,
      }).addTo(g);
      ret.bindTooltip(`<strong>${r.nome}</strong><br>${v} ${v === 1 ? 'problema ativo' : 'problemas ativos'}`, { sticky: true });
      limites.extend([[s, w], [n, e]]);
    }
    for (const r of relatos) {
      const c = L.circleMarker([r.lat, r.lon], {
        radius: 7, color: '#ffffff', weight: 2, fillColor: COR_STATUS[r.status] ?? '#8a8984', fillOpacity: 1,
      }).addTo(g);
      c.bindTooltip(`<strong>${nomesCategoria[r.categoria] ?? r.categoria}</strong> · ${nomesStatus[r.status] ?? r.status}<br>${r.rua ?? 'sem rua'} · ${r.regiao}`);
      c.on('click', () => sel.current?.(r));
    }
    if (limites.isValid()) m.fitBounds(limites, { padding: [12, 12] });
  }, [relatos, regioes, porRegiao, regiaoSel, nomesStatus, nomesCategoria]);

  return <div ref={div} className="mapa-adm" role="img" aria-label="Mapa das ocorrências por setor. Os mesmos dados estão na tabela de regiões e na aba Ocorrências." />;
}

export { RAMPA };
