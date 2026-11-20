import { useState } from 'react';

/**
 * Gráficos do Painel ADM em SVG/HTML puro (sem biblioteca).
 * Cores por papel (tokens em adm.css): série 1 = azul, série 2 = laranja (par validado
 * para daltonismo); status usam a paleta de status, sempre com rótulo de texto ao lado.
 */

/** Barras horizontais de uma série: valor escrito no fim de cada barra + dica ao passar o mouse. */
export function BarrasHorizontais({ dados, rotulo, formatar = (v) => v, total }) {
  const [dica, setDica] = useState(null);
  const max = Math.max(1, ...dados.map((d) => d.valor));
  return (
    <div className="grafico-barras" role="img" aria-label={rotulo}>
      {dados.map((d) => (
        <div key={d.nome} className="barra-linha" onMouseEnter={() => setDica(d.nome)} onMouseLeave={() => setDica(null)}
          onFocus={() => setDica(d.nome)} onBlur={() => setDica(null)} tabIndex={0}>
          <span className="barra-nome">{d.nome}</span>
          <span className="barra-trilho">
            <span className="barra-preenchida" style={{ width: `${(d.valor / max) * 100}%` }} />
          </span>
          <span className="barra-valor">{formatar(d.valor)}</span>
          {dica === d.nome && (
            <span className="dica" role="tooltip">
              <strong>{d.nome}</strong> {formatar(d.valor)}{total ? ` · ${Math.round((100 * d.valor) / total)}% do total` : ''}
              {d.extra ? <><br />{d.extra}</> : null}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

/** Linhas no tempo (até 2 séries), eixo y único, cruz + dica ao passar o mouse, rótulo direto no fim. */
export function LinhasTempo({ pontos, series, rotulo }) {
  const [i, setI] = useState(null);
  const L = 640, A = 220, m = { e: 34, d: 92, t: 14, b: 28 };
  const w = L - m.e - m.d, h = A - m.t - m.b;
  const max = Math.max(1, ...pontos.flatMap((p) => series.map((s) => p[s.chave])));
  const passoY = max <= 4 ? 1 : Math.ceil(max / 4);
  const topo = passoY * Math.ceil(max / passoY);
  const x = (k) => m.e + (pontos.length <= 1 ? 0 : (k / (pontos.length - 1)) * w);
  const y = (v) => m.t + h - (v / topo) * h;
  const fmtDia = (d) => new Date(`${d}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  const marcas = [];
  for (let v = 0; v <= topo; v += passoY) marcas.push(v);
  const aoMover = (ev) => {
    const r = ev.currentTarget.getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * L;
    const k = Math.round(((px - m.e) / w) * (pontos.length - 1));
    setI(Math.max(0, Math.min(pontos.length - 1, k)));
  };
  const ult = pontos.length - 1;
  return (
    <div className="grafico-linhas">
      <svg viewBox={`0 0 ${L} ${A}`} role="img" aria-label={rotulo} onMouseMove={aoMover} onMouseLeave={() => setI(null)}>
        {marcas.map((v) => (
          <g key={v}>
            <line className="grade" x1={m.e} x2={m.e + w} y1={y(v)} y2={y(v)} />
            <text className="eixo" x={m.e - 8} y={y(v) + 4} textAnchor="end">{v}</text>
          </g>
        ))}
        {[0, Math.floor(ult / 2), ult].map((k) => (
          <text key={k} className="eixo" x={x(k)} y={A - 8} textAnchor={k === 0 ? 'start' : k === ult ? 'end' : 'middle'}>{fmtDia(pontos[k].dia)}</text>
        ))}
        {series.map((s) => (
          <g key={s.chave}>
            <polyline className={`linha ${s.classe}`} points={pontos.map((p, k) => `${x(k)},${y(p[s.chave])}`).join(' ')} />
            <circle className={`ponto-fim ${s.classe}`} cx={x(ult)} cy={y(pontos[ult][s.chave])} r="4" />
          </g>
        ))}
        {/* rótulos diretos no fim (afastados se ficarem colados) */}
        {(() => {
          const ys = series.map((s) => y(pontos[ult][s.chave]));
          if (ys.length === 2 && Math.abs(ys[0] - ys[1]) < 16) { const mid = (ys[0] + ys[1]) / 2; ys[0] = mid - 9; ys[1] = mid + 9; }
          return series.map((s, k) => (
            <text key={s.chave} className="rotulo-direto" x={x(ult) + 10} y={ys[k] + 4}>{s.nome}</text>
          ));
        })()}
        {i != null && (
          <g>
            <line className="cruz" x1={x(i)} x2={x(i)} y1={m.t} y2={m.t + h} />
            {series.map((s) => <circle key={s.chave} className={`ponto-ativo ${s.classe}`} cx={x(i)} cy={y(pontos[i][s.chave])} r="5" />)}
          </g>
        )}
      </svg>
      {i != null && (
        <div className="dica dica-linhas" role="tooltip" style={{ left: `${(x(i) / L) * 100}%` }}>
          <strong>{fmtDia(pontos[i].dia)}</strong>
          {series.map((s) => <span key={s.chave}><i className={`amostra ${s.classe}`} />{s.nome}: {pontos[i][s.chave]}</span>)}
        </div>
      )}
      <p className="legenda">
        {series.map((s) => <span key={s.chave}><i className={`amostra ${s.classe}`} />{s.nome}</span>)}
      </p>
    </div>
  );
}
