/**
 * Perfil de elevação da rota: o sobe e desce do caminho (altitude x distância),
 * com os trechos acima do limite do perfil destacados. Os dados são reais
 * (altitude dos pontos do grafo: Copernicus DEM via Open-Meteo).
 *
 * O gráfico é complemento: tudo o que ele mostra também está em texto logo abaixo
 * (resumo e lista de trechos fortes), então o SVG fica oculto para leitores de tela.
 */
import { useMemo, useState } from 'react';
import { formatarDistancia } from '../../localizacao/geo.js';

const L = 320; // largura do viewBox
const A = 132; // altura do viewBox
const M = { esq: 44, dir: 10, topo: 12, baixo: 22 };

const pct = (v) => `${String(Math.round(v * 10) / 10).replace('.', ',')}%`;

export function PerfilElevacao({ elevacao }) {
  const { perfil, fortes = [] } = elevacao;
  const [foco, setFoco] = useState(null);

  const g = useMemo(() => {
    const total = perfil.at(-1)[0] || 1;
    let min = Math.min(...perfil.map((p) => p[1]));
    let max = Math.max(...perfil.map((p) => p[1]));
    // Faixa mínima de 10 m: num caminho quase plano, o gráfico não exagera o relevo.
    if (max - min < 10) { const meio = (max + min) / 2; min = meio - 5; max = meio + 5; }
    const x = (d) => M.esq + (d / total) * (L - M.esq - M.dir);
    const y = (h) => M.topo + (1 - (h - min) / (max - min)) * (A - M.topo - M.baixo);
    const pts = perfil.map(([d, h]) => [x(d), y(h)]);
    const linha = pts.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join('');
    const area = `${linha}L${x(total).toFixed(1)},${A - M.baixo}L${M.esq},${A - M.baixo}Z`;
    // Trechos fortes: o pedaço do perfil entre o início e o fim de cada um.
    const destaques = fortes.map((f) => {
      const dentro = perfil.filter(([d]) => d >= f.inicio_m - 1 && d <= f.fim_m + 1);
      const seg = dentro.length >= 2 ? dentro : perfil.filter(([d]) => d >= f.inicio_m - 30 && d <= f.fim_m + 30);
      return seg.map(([d, h], i) => `${i ? 'L' : 'M'}${x(d).toFixed(1)},${y(h).toFixed(1)}`).join('');
    });
    return { total, min, max, x, y, linha, area, destaques };
  }, [perfil, fortes]);

  const mover = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * L;
    let melhor = 0;
    perfil.forEach(([d], i) => { if (Math.abs(g.x(d) - px) < Math.abs(g.x(perfil[melhor][0]) - px)) melhor = i; });
    setFoco(melhor);
  };

  const p = foco != null ? perfil[foco] : null;
  const altMin = Math.round(Math.min(...perfil.map((q) => q[1])));
  const altMax = Math.round(Math.max(...perfil.map((q) => q[1])));
  return (
    <div className="perfil-elevacao">
      <svg viewBox={`0 0 ${L} ${A}`} aria-hidden="true" focusable="false"
        onPointerMove={mover} onPointerDown={mover} onPointerLeave={() => setFoco(null)}>
        {/* grade recessiva: só a linha de base e a do topo */}
        <line className="pe-grade" x1={M.esq} x2={L - M.dir} y1={g.y(altMax)} y2={g.y(altMax)} />
        <line className="pe-base" x1={M.esq} x2={L - M.dir} y1={A - M.baixo} y2={A - M.baixo} />
        <path className="pe-area" d={g.area} />
        <path className="pe-linha" d={g.linha} />
        {g.destaques.map((d, i) => <path key={i} className="pe-forte" d={d} />)}
        <text className="pe-eixo" x={M.esq - 6} y={g.y(altMax) + 4} textAnchor="end">{altMax} m</text>
        <text className="pe-eixo" x={M.esq - 6} y={g.y(altMin) + 4} textAnchor="end">{altMin} m</text>
        <text className="pe-eixo" x={M.esq} y={A - 6}>saída</text>
        <text className="pe-eixo" x={L - M.dir} y={A - 6} textAnchor="end">{formatarDistancia(g.total)}</text>
        {p && (
          <g className="pe-foco">
            <line x1={g.x(p[0])} x2={g.x(p[0])} y1={M.topo} y2={A - M.baixo} />
            <circle cx={g.x(p[0])} cy={g.y(p[1])} r="4.5" />
          </g>
        )}
      </svg>
      <p className="pe-dica" aria-hidden="true">
        {p ? `A ${formatarDistancia(p[0])} da saída: ${Math.round(p[1])} m de altitude` : 'Toque no gráfico para ver a altitude em cada ponto.'}
      </p>
      {fortes.length > 0 && (
        <p className="pe-legenda" aria-hidden="true"><i className="pe-legenda-forte" /> acima de {pct(elevacao.limite_pct)} ({elevacao.limite_para})</p>
      )}
    </div>
  );
}

/** Resumo curto do relevo para a linha de números da rota. */
export function resumoRelevo(e) {
  if (!e?.disponivel) return null;
  return `sobe ${e.sobe_m} m · mais íngreme ${pct(e.max_inclinacao_pct)}`;
}

/** Explicação do que é inclinação (também usada na Ajuda). */
export function ExplicaInclinacao({ limite }) {
  return (
    <div className="explica-inclinacao">
      <p><strong>Inclinação</strong> é quanto o chão sobe ou desce. <strong>8%</strong> quer dizer que sobe 8 metros
        a cada 100 metros andados.</p>
      <ul>
        <li><strong>Até 5%</strong>: quase plano, confortável para todos.</li>
        <li><strong>Até 8,33%</strong>: o máximo que a norma de acessibilidade (NBR 9050) aceita em rampas.</li>
        <li><strong>Acima de 10%</strong>: subida forte; cansa e pode ser perigosa na descida.</li>
      </ul>
      {limite != null && <p>No seu perfil, o app evita e avisa trechos acima de <strong>{pct(limite)}</strong>.</p>}
    </div>
  );
}

export { pct as formatarInclinacao };
