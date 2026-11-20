import { useEffect, useMemo, useState } from 'react';
import { Aviso, Botao, BotaoSom, Carregando, Tela, Titulo } from '../componentes/base.jsx';
import { Icone } from '../componentes/Icone.jsx';
import { Mapa } from '../componentes/Mapa.jsx';
import { BarraNav } from '../componentes/BarraNav.jsx';
import { api } from '../servicos/api.js';
import { distancia, formatarDistancia } from '../../localizacao/geo.js';
import { falar } from '../servicos/voz.js';

export const NOME_RELATO = {
  buraco: 'Buraco', calcada_irregular: 'Calçada irregular', obstaculo: 'Obstáculo', sem_rampa: 'Sem rampa',
  alagamento: 'Alagamento', luz_apagada: 'Luz apagada', obra: 'Obra', outro: 'Outro problema', entrada: 'Entrada de lugar',
};
const STATUS = { em_verificacao: 'Em verificação', confirmado: 'Confirmado', encaminhado: 'Encaminhado à prefeitura', resolvido: 'Consertado' };
const FILTROS = [
  { id: 'todos', nome: 'Todos' }, { id: 'buraco', nome: 'Buracos' }, { id: 'calcada_irregular', nome: 'Calçada' },
  { id: 'obstaculo', nome: 'Obstáculos' }, { id: 'sem_rampa', nome: 'Sem rampa' }, { id: 'alagamento', nome: 'Alagamento' },
];
const RAIO_M = 2500;

function quando(iso) {
  const dias = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (dias <= 0) return 'hoje';
  if (dias === 1) return 'ontem';
  return `há ${dias} dias`;
}

/**
 * Mapa de barreiras (pitch: "disponibilizando essa informação no mapa para consulta de outros
 * usuários" e "esses registros poderão ser consultados e confirmados por outros usuários").
 * O mapa é complemento: a mesma lista, com as mesmas ações, está em texto logo abaixo.
 */
export function MapaBarreiras({ origem, inicial = null, extra = null, aoVoltar, aoMenu, aoAvisar }) {
  const [relatos, setRelatos] = useState(null);
  const [erro, setErro] = useState(null);
  const [filtro, setFiltro] = useState('todos');
  const [sel, setSel] = useState(inicial);
  const [votos, setVotos] = useState({});
  const [aberta, setAberta] = useState(false); // painel da lista expandido (como a "folha" do Google Maps)

  useEffect(() => {
    api.relatos().then((r) => setRelatos(r.relatos.filter((x) => x.categoria !== 'entrada'))).catch((e) => setErro(e.message));
  }, []);

  const comDistancia = useMemo(() => (relatos ?? [])
    .map((r) => ({ ...r, distancia: origem ? distancia(origem, r) : 0 }))
    .sort((a, b) => a.distancia - b.distancia), [relatos, origem]);
  // Fora da área piloto (nenhum aviso num raio de 2,5 km, de nenhum tipo): mostra os avisos
  // da área piloto, em vez de um mapa vazio, e enquadra o mapa neles.
  const areaPiloto = relatos != null && relatos.length > 0 && !comDistancia.some((r) => r.distancia <= RAIO_M);
  const perto = useMemo(() => comDistancia
    .filter((r) => (areaPiloto || r.distancia <= RAIO_M) && (filtro === 'todos' || r.categoria === filtro)),
  [comDistancia, areaPiloto, filtro]);
  // extra: relato que não está mais ativo (ex.: consertado, aberto pela Novidade)
  const atual = perto.find((r) => r.id === sel) ?? (relatos ?? []).find((r) => r.id === sel) ?? (extra?.id === sel ? extra : null);

  const nomeFiltro = filtro === 'todos' ? null : FILTROS.find((f) => f.id === filtro)?.nome.toLowerCase();
  const titulo = areaPiloto
    ? `${perto.length} ${perto.length === 1 ? 'barreira' : 'barreiras'} na área piloto`
    : perto.length ? `${perto.length} ${perto.length === 1 ? 'barreira' : 'barreiras'} perto de você`
      : nomeFiltro ? `Nenhum aviso de ${nomeFiltro} perto` : 'Nenhuma barreira avisada perto';
  const fala = !relatos ? 'Mapa de barreiras.'
    : areaPiloto
      ? `Mapa de barreiras. Não há avisos perto de você. Mostrando ${perto.length} ${perto.length === 1 ? 'problema avisado' : 'problemas avisados'} na área piloto, Vila Yara, em Osasco.`
      : `Mapa de barreiras. ${perto.length} ${perto.length === 1 ? 'problema avisado' : 'problemas avisados'} perto de você. Toque em um para ver a foto e confirmar se ainda está lá.`;

  const escolher = (r) => {
    setSel(r.id);
    falar(`${NOME_RELATO[r.categoria] ?? 'Problema'}${r.rua ? ` na ${r.rua}` : ''}, a ${formatarDistancia(r.distancia ?? 0)}. ${STATUS[r.status] ?? ''}.`);
  };

  const votar = async (r, resposta) => {
    setVotos((v) => ({ ...v, [r.id]: { enviando: true } }));
    try {
      const res = await api.responder(r.id, resposta);
      setRelatos((lista) => lista.map((x) => (x.id === r.id ? { ...x, ...res.relato } : x)));
      const msg = !res.contou ? 'Você já tinha respondido sobre este problema.'
        : resposta === 'sim' ? 'Obrigado! Sua confirmação ajuda outras pessoas a desviar.'
          : 'Obrigado! Se mais pessoas disserem o mesmo, o problema sai do mapa.';
      setVotos((v) => ({ ...v, [r.id]: { msg } }));
      falar(msg);
    } catch (e) {
      setVotos((v) => ({ ...v, [r.id]: { msg: e.message, erro: true } }));
    }
  };

  const visiveis = extra && !perto.some((r) => r.id === extra.id) ? [...perto, extra] : perto;
  const marcadores = visiveis.map((r) => ({
    id: r.id, lat: r.lat, lon: r.lon,
    tipo: `${r.status === 'em_verificacao' ? 'verificacao' : 'perigo'}${r.id === sel ? '_sel' : ''}`,
  }));

  return (
    <Tela fala={relatos ? fala : undefined} fixa className="tela-barreiras">
      <Titulo className="so-leitor">Mapa de barreiras perto de você</Titulo>
      <div className="home-mapa">
        {/* key: ao descobrir que a pessoa está fora da área piloto, o mapa é recriado enquadrando os avisos. */}
        <Mapa key={areaPiloto ? 'piloto' : 'perto'} marcadores={marcadores} posicao={areaPiloto ? null : origem} altura="cheia"
          modo={areaPiloto ? 'visao' : 'seguir'} zoomSeguir={15.5} focoAcima={0.2} margemInferior={0.3} margemTopo={130}
          aoTocarMarcador={(id) => {
            const r = visiveis.find((x) => x.id === id);
            if (r) { escolher(r); setAberta(false); }
          }} rotulo={`Mapa com ${perto.length} problemas avisados perto de você. A lista no painel tem os mesmos itens.`} />
      </div>
      <div className="flutuante-topo flutuante-topo-coluna">
        <div className="flutuante-linha">
          <button type="button" className="botao-redondo" onClick={aoVoltar} aria-label="Voltar"><Icone nome="voltar" /></button>
          <p className="pilula pilula-destino"><Icone nome="mapa" /><span>{areaPiloto ? 'Barreiras: Vila Yara' : 'Barreiras perto'}</span></p>
          <BotaoSom fala={fala} />
        </div>
        <div className="chips filtros-barreiras" role="radiogroup" aria-label="Filtrar por tipo">
          {FILTROS.map((f) => (
            <button key={f.id} type="button" role="radio" aria-checked={filtro === f.id} className="chip" onClick={() => setFiltro(f.id)}>
              {filtro === f.id && <Icone nome="check" />}{f.nome}
            </button>
          ))}
        </div>
      </div>

      <section className={`folha barreiras-folha ${aberta ? 'aberta' : ''}`} aria-label="Lista de barreiras">
        <button type="button" className="fab-avisar" onClick={aoAvisar} aria-label="Avisar um problema novo">
          <Icone nome="alerta" /><span>Avisar</span>
        </button>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        {!relatos && !erro && <Carregando texto="Buscando os avisos da comunidade" />}
        {atual ? (
          <div className="detalhe-relato" aria-labelledby="titulo-detalhe">
            <div className="detalhe-topo">
              {atual.tem_foto && (
                <figure>
                  <img src={`/api/relatos/${encodeURIComponent(atual.id)}/foto`} alt={`Foto do problema: ${NOME_RELATO[atual.categoria] ?? 'problema'}`} />
                  <figcaption>{atual.foto_ilustrativa ? 'Ilustrativa' : 'Borrada (LGPD)'}</figcaption>
                </figure>
              )}
              <div className="detalhe-texto">
                <h2 id="titulo-detalhe">{NOME_RELATO[atual.categoria] ?? 'Problema'}</h2>
                <p>{atual.rua || 'Local marcado no mapa'}{atual.distancia != null ? ` · ${formatarDistancia(atual.distancia)}` : ''}</p>
                <p className="nota">Avisado {quando(atual.criado_em)} · {atual.confirmacoes} {atual.confirmacoes === 1 ? 'confirmação' : 'confirmações'}</p>
                <span className={`chip chip-${atual.status}`}>{STATUS[atual.status] ?? atual.status}</span>
              </div>
              <button type="button" className="botao-redondo pequeno" onClick={() => setSel(null)} aria-label="Fechar detalhe"><Icone nome="fechar" /></button>
            </div>
            {atual.descricao && <p className="descricao-relato">“{atual.descricao}”</p>}
            {atual.status === 'resolvido' ? null : votos[atual.id]?.msg ? (
              <Aviso tipo={votos[atual.id].erro ? 'erro' : 'info'} icone={votos[atual.id].erro ? 'alerta' : 'ok'}>{votos[atual.id].msg}</Aviso>
            ) : (
              <div className="linha-botoes">
                <Botao icone="ok" disabled={votos[atual.id]?.enviando} onClick={() => votar(atual, 'sim')}>Ainda está</Botao>
                <Botao icone="fechar" variante="secundario" disabled={votos[atual.id]?.enviando} onClick={() => votar(atual, 'nao')}>Já resolveram</Botao>
              </div>
            )}
          </div>
        ) : relatos && (
          <>
            <button type="button" className="folha-cabeca" aria-expanded={aberta} onClick={() => setAberta((v) => !v)}>
              <span className="folha-alca" aria-hidden="true" />
              <span className="folha-cabeca-texto">
                <strong>{titulo}</strong>
                {areaPiloto && <span className="nota">Nada avisado perto de você. Estes são da área piloto (Vila Yara, Osasco).</span>}
                <span className="legenda-mapa" aria-hidden="true">
                  <span><i className="bolinha-legenda confirmado">!</i> confirmado</span>
                  <span><i className="bolinha-legenda verificacao">?</i> em verificação</span>
                </span>
              </span>
              <Icone nome={aberta ? 'fechar' : 'lista'} />
            </button>
            <ul className="lista-barreiras folha-rolavel">
              {perto.map((r) => (
                <li key={r.id}>
                  <button type="button" className="item-barreira" onClick={() => { escolher(r); setAberta(false); }}>
                    <span className={`marca-status ${r.status}`} aria-hidden="true">{r.status === 'em_verificacao' ? '?' : '!'}</span>
                    <span><strong>{NOME_RELATO[r.categoria] ?? 'Problema'}</strong>
                      <span>{r.rua || 'Local no mapa'} · {formatarDistancia(r.distancia)} · {STATUS[r.status]}</span></span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        <BarraNav atual="mapa" aoIr={aoMenu} />
      </section>
    </Tela>
  );
}
