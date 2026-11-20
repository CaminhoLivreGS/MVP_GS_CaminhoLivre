import { useEffect, useState } from 'react';
import { Marca } from '../app/componentes/Icone.jsx';
import './embed.css';

/**
 * Widget "Como chegar com acessibilidade" (modelo de negócio do pitch): shoppings, hospitais e
 * universidades colocam este quadro no próprio site com um <iframe src="/embed/<lugar>">.
 * Mostra as entradas verificadas e abre o Caminho Livre com a rota até o lugar.
 */
const PORTA = { automatica: 'porta automática', giratoria: 'porta giratória', comum: 'porta comum', manual: 'porta manual' };

function atributos(e) {
  const a = [];
  if (e.degraus === 0 && !e.rampa && !e.elevador) a.push(['ok', 'sem degraus']);
  if (e.degraus > 0) a.push([e.rampa || e.elevador ? 'aviso' : 'ruim', `${e.degraus} ${e.degraus === 1 ? 'degrau' : 'degraus'}`]);
  if (e.rampa) a.push(['ok', 'rampa']);
  if (e.elevador) a.push(['ok', 'elevador']);
  if (e.porta) a.push([e.porta === 'giratoria' ? 'ruim' : 'ok', PORTA[e.porta] ?? e.porta]);
  if (e.largura_m != null) a.push([e.largura_m < 0.8 ? 'ruim' : 'ok', `passagem de ${Math.round(e.largura_m * 100)} cm`]);
  if (e.piso_tatil) a.push(['ok', 'piso tátil']);
  if (e.coberta) a.push(['ok', 'coberta']);
  return a;
}
const acessivel = (e) => (e.degraus === 0 || e.rampa || e.elevador) && e.porta !== 'giratoria' && !(e.largura_m != null && e.largura_m < 0.8);

export function Embed({ id }) {
  const [local, setLocal] = useState(null);
  const [erro, setErro] = useState(false);
  useEffect(() => {
    fetch(`/api/locais/${encodeURIComponent(id)}`).then((r) => (r.ok ? r.json() : Promise.reject())).then((l) => {
      setLocal(l);
      document.title = `Como chegar com acessibilidade: ${l.nome}`;
    }).catch(() => setErro(true));
  }, [id]);
  const link = `${location.origin}/?destino=${encodeURIComponent(id)}`;
  if (erro) return <div className="embed"><p>Lugar não encontrado.</p></div>;
  if (!local) return <div className="embed"><p role="status">Carregando…</p></div>;
  const ordenadas = [...local.entradas].sort((a, b) => acessivel(b) - acessivel(a));
  return (
    <div className="embed">
      <header>
        <Marca tamanho={34} />
        <div><p className="sobre">Como chegar com acessibilidade</p><h1>{local.nome}</h1></div>
      </header>
      {local.endereco && <p className="endereco">{local.endereco}</p>}
      <h2>Entradas verificadas</h2>
      <ul className="entradas">
        {ordenadas.map((e) => (
          <li key={e.id} className={acessivel(e) ? 'acessivel' : ''}>
            <strong>{e.nome}</strong>
            <span className="selo">{acessivel(e) ? '✓ Acessível para cadeira de rodas' : 'Com barreiras'}</span>
            <ul className="atributos">{atributos(e).map(([t, n]) => <li key={n} className={t}>{n}</li>)}</ul>
          </li>
        ))}
      </ul>
      <a className="botao-rota" href={link} target="_blank" rel="noopener">Traçar rota acessível até aqui</a>
      <p className="rodape">
        O Caminho Livre escolhe a entrada certa para o seu jeito de andar e desvia de escadas e calçadas com problema.
        {local.dados_exemplo && <><br /><em>Dados de exemplo (levantamento de demonstração).</em></>}
      </p>
    </div>
  );
}
