import { useCallback, useEffect, useRef, useState } from 'react';
import { Aviso, Botao, Cabecalho, CaixaFala, Rodape, Tela, Titulo, BotaoSom } from '../componentes/base.jsx';
import { Icone } from '../componentes/Icone.jsx';
import { Mapa } from '../componentes/Mapa.jsx';
import { MotorNavegacao } from '../../localizacao/MotorNavegacao.js';
import { FonteGPS, FonteSimulada } from '../../localizacao/fontes.js';
import { formatarDistancia } from '../../localizacao/geo.js';
import { api } from '../servicos/api.js';
import { falar, vibrar, VIBRA } from '../servicos/voz.js';
import { velocidadePerfil } from '../servicos/preferencias.js';
import { CartaoEntrada } from './Local.jsx';

export const ICONE_RELATO = {
  buraco: 'buraco', calcada_irregular: 'buraco', obstaculo: 'obstaculo', sem_rampa: 'semRampa',
  alagamento: 'alagamento', luz_apagada: 'luzApagada', obra: 'obstaculo', outro: 'outro',
  escada: 'semRampa', subida_forte: 'caminho', risco_alagamento: 'alagamento',
};
const NOME_CURTO = {
  buraco: 'Buraco na calçada', calcada_irregular: 'Calçada irregular', obstaculo: 'Obstáculo na calçada',
  sem_rampa: 'Falta de rampa', alagamento: 'Alagamento', luz_apagada: 'Luz apagada', obra: 'Obra na calçada',
};

/** Página 7: a rota, com o porquê de cada desvio. */
export function PreviaRota({ rota, origem, aoComecar, aoVoltar }) {
  const [simular, setSimular] = useState(origem?.fonte !== 'gps');
  const [verAvisos, setVerAvisos] = useState(false);
  const motivo = rota.falas.motivos_desvio?.[0];
  const semDados = rota.fonte_dados === 'sem_acessibilidade';
  const avisos = [...(rota.falas.motivos_desvio ?? []).slice(1), ...(rota.falas.avisos ?? [])];
  const entrada = rota.entrada;
  const fala = [entrada?.fala, rota.falas.resumo_voz, ...(rota.falas.motivos_desvio ?? []), ...(rota.falas.avisos ?? [])].filter(Boolean).join(' ');
  const [o, d] = [rota.geometria.coords[0], rota.geometria.coords.at(-1)];
  const linkMapa = `https://www.google.com/maps/dir/?api=1&origin=${o[0]},${o[1]}&destination=${d[0]},${d[1]}&travelmode=walking`;
  const marcadores = [
    ...rota.desvios.filter((x) => x.lat).map((x, i) => ({ id: `d${i}`, lat: x.lat, lon: x.lon, tipo: 'perigo' })),
    ...rota.alertas_no_caminho.map((a) => ({ id: a.id, lat: a.lat, lon: a.lon, tipo: 'perigo' })),
  ];
  const sub = semDados ? 'Aqui ainda não tenho dados de calçada e escada. Vá com atenção.'
    : motivo ? null : 'Não encontrei problemas avisados nesse caminho.';
  return (
    <Tela fala={fala}>
      <Cabecalho titulo="Sua rota" aoVoltar={aoVoltar} fala={fala} />
      <Titulo className="so-leitor">Sua rota até {rota.destino.nome}</Titulo>
      <div className="mapa-flex">
        <Mapa coords={rota.geometria.coords} comum={rota.desvios.length ? rota.rota_comum.coords : null} marcadores={marcadores}
          posicao={{ lat: o[0], lon: o[1] }}
          rotulo={`Mapa: caminho de ${formatarDistancia(rota.distancia_m)} até ${rota.destino.nome}. Em verde, o caminho escolhido; tracejado laranja, o caminho mais curto evitado.`} />
      </div>
      <div className="numeros">
        <div className="numero"><strong>{rota.duracao_min} min</strong><span>a pé</span></div>
        <div className="numero"><strong>{semDados ? '?' : rota.escadas}</strong><span>{rota.escadas === 1 ? 'escada' : 'escadas'}</span></div>
        <div className="numero"><strong>{rota.desvios.length}</strong><span>{rota.desvios.length === 1 ? 'desvio' : 'desvios'}</span></div>
      </div>
      {entrada?.escolhida && (
        <CartaoEntrada entrada={entrada.escolhida} dadosExemplo={entrada.dados_exemplo} fechado={entrada.fechado_agora}
          descartadas={entrada.descartadas} />
      )}
      {rota.fonte_dados === 'ors' && <p className="nota">Caminho calculado pelo OpenRouteService (evita escadas).</p>}
      <CaixaFala titulo={motivo ?? `São ${formatarDistancia(rota.distancia_m)} a pé.`}>
        {sub}
        {avisos.length > 0 && (
          <button type="button" className="link-avisos" aria-expanded={verAvisos} onClick={() => setVerAvisos((v) => !v)}>
            {verAvisos ? 'Esconder avisos' : `Ver ${avisos.length} ${avisos.length === 1 ? 'aviso' : 'avisos'} do caminho`}
          </button>
        )}
        {verAvisos && <ul className="lista-avisos">{avisos.map((a, i) => <li key={i}>{a}</li>)}</ul>}
      </CaixaFala>
      <Rodape>
        <Botao icone="caminho" onClick={() => aoComecar({ simular })}>Começar rota</Botao>
        <div className="linha-botoes">
          <a className="botao secundario" href={linkMapa} target="_blank" rel="noopener noreferrer"><Icone nome="mapa" /><span>App de mapa</span></a>
          <button type="button" className="botao secundario" aria-pressed={simular} onClick={() => setSimular((v) => !v)}>
            <Icone nome={simular ? 'check' : 'caminho'} /><span>{simular ? 'Simulando' : 'Simular'}</span>
          </button>
        </div>
      </Rodape>
    </Tela>
  );
}

const ICONE_MANOBRA = { vire_direita: 'seta', vire_esquerda: 'setaEsq', volte: 'retorno', chegada: 'lugar', atravesse: 'setaCima', siga: 'setaCima', inicio: 'setaCima' };
const DEPOIS = {
  vire_direita: 'depois vire à direita', vire_esquerda: 'depois vire à esquerda', volte: 'depois faça o retorno',
  atravesse: 'depois atravesse', siga: 'depois siga em frente', chegada: 'até chegar', inicio: 'siga em frente',
};

/**
 * Páginas 8, 9, 10 e 12: navegação. O motor roda no aparelho; a API só é
 * chamada para recalcular (saiu da rota) e para registrar respostas.
 */
export function Navegacao({ rotaInicial, prefs, simular, emSegundoPlano = false, aoChegar, aoAvisar, aoSair, pedidoRota }) {
  const [rota, setRota] = useState(rotaInicial);
  const [estado, setEstado] = useState(null);
  const [sobreposicao, setSobreposicao] = useState(null);
  const [fila, setFila] = useState([]);
  const [erroGps, setErroGps] = useState(null);
  const [usarSim, setUsarSim] = useState(simular);
  const [sim, setSim] = useState({ pausado: false, mult: 4, fora: false });
  const [verTodos, setVerTodos] = useState(false);
  const [solto, setSolto] = useState(false);
  const [recentrar, setRecentrar] = useState(0);
  const motor = useRef(null);
  const fonte = useRef(null);
  const inicio = useRef(Date.now());
  const recalculando = useRef(false);
  const fundo = useRef(emSegundoPlano);
  fundo.current = emSegundoPlano;
  const evitados = rotaInicial.desvios.length;

  const recalcular = useCallback(async (pos) => {
    if (recalculando.current) return;
    recalculando.current = true;
    try {
      const nova = await api.rota({ ...pedidoRota, origem: { lat: pos.lat, lon: pos.lon, nome: 'Você' }, explicar: false });
      setRota(nova);
      falar(`Novo caminho. ${nova.manobras[0]?.fala ?? ''}`);
    } catch (e) {
      falar('Não consegui recalcular. Volte para o caminho verde.');
    } finally {
      recalculando.current = false;
    }
  }, [pedidoRota]);

  useEffect(() => {
    const m = new MotorNavegacao(rota, { velocidade: velocidadePerfil(prefs.perfis) });
    motor.current = m;
    setEstado({ ...m.estado });
    const aoMudar = (pos) => {
      const eventos = m.atualizar(pos);
      setEstado({ ...m.estado });
      for (const ev of eventos) {
        const texto = MotorNavegacao.falaEvento(ev);
        if (ev.tipo === 'manobra') {
          if (!fundo.current) { vibrar(VIBRA.manobra); falar(texto); }
        } else if (ev.tipo === 'alerta') {
          vibrar(VIBRA.alerta);
          falar(texto);
          if (!fundo.current) setFila((f) => [...f, { tipo: 'alerta', alerta: ev.alerta, distancia: ev.distancia }]);
        } else if (ev.tipo === 'pergunta') {
          if (!fundo.current) setFila((f) => [...f, { tipo: 'pergunta', alerta: ev.alerta }]);
        } else if (ev.tipo === 'fora_da_rota') {
          vibrar(VIBRA.alerta);
          falar(texto);
          recalcular(pos);
        } else if (ev.tipo === 'de_volta') {
          falar(texto);
        } else if (ev.tipo === 'chegada') {
          vibrar(VIBRA.chegada);
          fonte.current?.parar();
          aoChegar({ destino: rota.destino, minutos: Math.max(1, Math.round((Date.now() - inicio.current) / 60000)), evitados, rotaId: rota.id,
            posicao: { lat: rota.destino.lat, lon: rota.destino.lon }, fonte: rota.fonte_dados });
        }
      }
    };
    let f;
    if (usarSim) {
      f = new FonteSimulada(rota.geometria, { velocidade: velocidadePerfil(prefs.perfis), multiplicador: sim.mult });
      f.iniciar(aoMudar);
    } else {
      f = new FonteGPS();
      f.iniciar(aoMudar, (e) => {
        if (e.codigo === 'PRECISAO_BAIXA') setErroGps(`Sinal de GPS fraco (${e.precisao} m). Vou esperar melhorar.`);
        else if (e.codigo === 'PERMISSAO_NEGADA') setErroGps('A localização não foi liberada.');
        else setErroGps('Não estou recebendo sua localização.');
      });
    }
    fonte.current = f;
    if (rota === rotaInicial) falar(rota.falas?.instrucoes?.[0] ?? rota.manobras[0]?.fala);
    return () => f.parar();
  }, [rota, usarSim]); // eslint-disable-line react-hooks/exhaustive-deps

  // Uma sobreposição por vez; a simulação pausa enquanto a pessoa lê.
  useEffect(() => {
    if (!sobreposicao && fila.length && !emSegundoPlano) {
      setSobreposicao(fila[0]);
      setFila((f) => f.slice(1));
    }
  }, [fila, sobreposicao, emSegundoPlano]);
  useEffect(() => {
    if (fonte.current instanceof FonteSimulada) fonte.current.pausar(Boolean(sobreposicao) || sim.pausado || emSegundoPlano);
  }, [sobreposicao, sim.pausado, emSegundoPlano]);
  useEffect(() => {
    if (fonte.current instanceof FonteSimulada) {
      fonte.current.multiplicador = sim.mult;
      fonte.current.sairDaRota(sim.fora ? 60 : 0);
    }
  }, [sim.mult, sim.fora]);

  if (sobreposicao?.tipo === 'alerta') {
    return <TelaAlerta alerta={sobreposicao.alerta} distancia={sobreposicao.distancia} aoEntender={() => setSobreposicao(null)} />;
  }
  if (sobreposicao?.tipo === 'pergunta') {
    return <PerguntaComunidade alerta={sobreposicao.alerta} aoFim={() => setSobreposicao(null)} />;
  }

  const e = estado ?? motor.current?.estado;
  if (!e) return null;
  const prox = e.proxima;
  const chegada = new Date(Date.now() + e.eta_min * 60000).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }).replace(':', 'h');
  const repetir = () => falar(motor.current?.falaAtual(), { forcar: true });
  const textoPrincipal = e.foraDaRota ? 'Você saiu do caminho. Estou calculando de novo.' : prox?.fala;
  const marcadores = rota.alertas_no_caminho.map((a) => ({ id: a.id, lat: a.lat, lon: a.lon, tipo: 'perigo' }));

  const feito = e.s ?? 0;
  const seguintes = rota.manobras.filter((m) => prox && m.acumulado_m > prox.acumulado_m + 1);
  const depois = seguintes[0];
  const posAtual = e.posicao ? (e.foraDaRota ? e.posicao : e.posicaoNaRota) : null;

  return (
    <main className="tela tela-navegacao" hidden={emSegundoPlano} aria-label="Navegação">
      <div className="nav-mapa">
        <Mapa coords={rota.geometria.coords} marcadores={marcadores} posicao={posAtual} modo="seguir" altura="cheia"
          focoAcima={-0.08} aoSoltar={() => setSolto(true)} recentrar={recentrar} rotulo="Mapa com sua posição no caminho" />
      </div>

      <div className="nav-topo">
        <section className="nav-instrucao" aria-live="polite">
          <span className="nav-seta"><Icone nome={ICONE_MANOBRA[prox?.tipo] ?? 'setaCima'} /></span>
          <div className="nav-instrucao-texto">
            <strong>{formatarDistancia(e.distanciaProxima)}</strong>
            <p>{textoPrincipal}</p>
          </div>
        </section>
        {depois && (
          <div className="nav-depois">
            <span>Depois</span>
            <Icone nome={ICONE_MANOBRA[depois.tipo] ?? 'setaCima'} />
            <span className="nav-depois-texto">{depois.fala}</span>
          </div>
        )}
        {erroGps && !usarSim && (
          <div className="nav-gps" role="alert">
            <Icone nome="lugar" /><span>{erroGps}</span>
            <button type="button" onClick={() => { setErroGps(null); setUsarSim(true); }}>Simular caminhada</button>
          </div>
        )}
      </div>

      <div className="nav-lateral">
        <button type="button" className="nav-redondo" onClick={repetir} aria-label="Repetir a instrução"><Icone nome="repetir" /></button>
        <BotaoSom fala={motor.current?.falaAtual()} />
        <button type="button" className="nav-redondo nav-redondo-alerta" onClick={() => aoAvisar(e.posicao ?? e.posicaoNaRota)}
          aria-label="Avisar problema na calçada"><Icone nome="alerta" /></button>
      </div>

      {solto && (
        <button type="button" className="nav-recentrar" onClick={() => { setSolto(false); setRecentrar((n) => n + 1); }}>
          <Icone nome="caminho" />Recentralizar
        </button>
      )}

      {usarSim && (
        <div className="nav-sim" role="group" aria-label="Controles da caminhada simulada">
          <strong>Simulação</strong>
          <button type="button" onClick={() => setSim((x) => ({ ...x, pausado: !x.pausado }))} aria-pressed={sim.pausado}>
            {sim.pausado ? 'Continuar' : 'Pausar'}
          </button>
          {[2, 4, 8].map((m) => (
            <button key={m} type="button" aria-pressed={sim.mult === m} onClick={() => setSim((x) => ({ ...x, mult: m }))}>{m}x</button>
          ))}
          <button type="button" aria-pressed={sim.fora} onClick={() => setSim((x) => ({ ...x, fora: !x.fora }))}>
            {sim.fora ? 'Voltar' : 'Sair da rota'}
          </button>
        </div>
      )}

      <section className="nav-rodape" aria-live="off">
        <button type="button" className="nav-redondo" onClick={() => setVerTodos(true)} aria-label="Ver todos os passos"><Icone nome="lista" /></button>
        <div className="nav-eta">
          <strong>{e.eta_min} min</strong>
          <span>{formatarDistancia(e.restante)} · chega {chegada}</span>
        </div>
        <button type="button" className="nav-redondo" onClick={aoSair} aria-label="Encerrar rota"><Icone nome="fechar" /></button>
      </section>

      {verTodos && (
        <section className="nav-passos" role="dialog" aria-modal="true" aria-label="Passos do caminho">
          <div className="nav-passos-topo">
            <h2>Próximos passos</h2>
            <button type="button" className="nav-redondo" onClick={() => setVerTodos(false)} aria-label="Fechar lista de passos"><Icone nome="fechar" /></button>
          </div>
          <ol>
            {[prox, ...seguintes].filter(Boolean).map((m, i) => (
              <li key={m.indice ?? m.acumulado_m} className={i === 0 ? 'atual' : ''}>
                <Icone nome={ICONE_MANOBRA[m.tipo] ?? 'setaCima'} />
                <span>{m.fala}</span>
                <em>{formatarDistancia(Math.max(0, m.acumulado_m - feito))}</em>
              </li>
            ))}
          </ol>
        </section>
      )}
    </main>
  );
}

/** Página 9: alerta de problema à frente. */
function TelaAlerta({ alerta, distancia, aoEntender }) {
  const titulo = `${NOME_CURTO[alerta.tipo] ?? 'Problema na calçada'} ${distancia <= 5 ? 'logo à frente' : `em ${distancia} metros`}.`;
  const acao = alerta.lado_seguro ? `Siga pela ${alerta.lado_seguro}` : 'Vá com cuidado';
  const fala = `Atenção. ${titulo} ${acao}.`;
  return (
    <Tela className="tela-alerta" rotulo="Atenção">
      <div className="cabecalho">
        <span className="selo-atencao"><Icone nome="alerta" />Atenção</span><span />
        <BotaoSom fala={fala} claro />
      </div>
      <div className="alerta-icone"><Icone nome={ICONE_RELATO[alerta.tipo] ?? 'alerta'} /></div>
      <Titulo>{titulo}</Titulo>
      <p className="alerta-acao"><Icone nome={alerta.lado_seguro === 'esquerda' ? 'setaEsq' : 'seta'} />{acao}</p>
      <p>{alerta.status_relato === 'em_verificacao' ? 'Ainda em verificação · ' : ''}Avisado por {alerta.confirmacoes} {alerta.confirmacoes === 1 ? 'pessoa' : 'pessoas'} · o celular vibrou para avisar</p>
      <div className="empurra" />
      <Botao icone="ok" variante="escuro" onClick={aoEntender}>Entendi</Botao>
    </Tela>
  );
}

/** Página 10: confirmação pela comunidade. */
function PerguntaComunidade({ alerta, aoFim }) {
  const [enviando, setEnviando] = useState(false);
  const desc = { buraco: 'um buraco', calcada_irregular: 'calçada irregular', obstaculo: 'um obstáculo', sem_rampa: 'falta de rampa', alagamento: 'alagamento', luz_apagada: 'luz apagada', obra: 'uma obra' }[alerta.tipo] ?? 'um problema';
  const pergunta = `Alguém avisou de ${desc} aqui. Ainda está aí?`;
  const responder = async (r) => {
    setEnviando(true);
    try {
      await api.responder(alerta.id, r);
      falar(r === 'nao_sei' ? 'Tudo bem. Vamos seguir.' : 'Obrigado! Sua resposta ajuda quem vem depois.');
    } catch {
      falar('Não consegui enviar agora, mas tudo bem. Vamos seguir.');
    }
    aoFim();
  };
  return (
    <Tela fala={`${pergunta} Sua resposta ajuda a decidir se o trecho fica fora das rotas.`}>
      <Cabecalho titulo="Ajude quem vem depois" aoVoltar={aoFim} fala={pergunta} />
      <Mapa coords={[]} marcadores={[{ id: alerta.id, lat: alerta.lat, lon: alerta.lon, tipo: 'perigo' }]} posicao={{ lat: alerta.lat - 0.00008, lon: alerta.lon }}
        altura="pequena" rotulo="Mapa do ponto avisado" />
      <CaixaFala titulo={<Titulo>{pergunta}</Titulo>}>Sua resposta ajuda a decidir se o trecho fica fora das rotas.</CaixaFala>
      <div className="empurra" />
      <Rodape>
        <Botao icone="alerta" variante="alerta" disabled={enviando} onClick={() => responder('sim')}>Sim, ainda está</Botao>
        <Botao icone="ok" disabled={enviando} onClick={() => responder('nao')}>Não tem mais</Botao>
        <Botao variante="secundario" disabled={enviando} onClick={() => responder('nao_sei')}>Não sei</Botao>
      </Rodape>
    </Tela>
  );
}

/** Página 11: chegada. */
export function Chegada({ resumo, prefs, aoFim }) {
  const [avaliado, setAvaliado] = useState(false);
  const nome = resumo.destino?.nome ?? 'seu destino';
  const extra = resumo.evitados ? ` · ${resumo.evitados} ${resumo.evitados === 1 ? 'problema evitado' : 'problemas evitados'}` : '';
  const fala = `Você chegou em ${nome}. O caminho estava bom?`;
  const avaliar = async (nota) => {
    setAvaliado(true);
    falar('Obrigado pela resposta!');
    try { await api.avaliar(resumo.rotaId, nota, { perfil: (prefs.perfis ?? []).join('+') || 'sem_apoio', fonte_dados: resumo.fonte }); } catch { /* opcional */ }
    setTimeout(aoFim, 1200);
  };
  // Aviso ao acompanhante: a pessoa decide e envia (LGPD). Compartilhamento nativo do celular
  // (WhatsApp, SMS, e-mail...) com a posição de chegada; sem suporte, SMS pronto.
  const texto = `Cheguei em ${nome}. (Caminho Livre)`;
  const msg = encodeURIComponent(texto);
  const compartilhar = async () => {
    const url = resumo.posicao ? `https://www.openstreetmap.org/?mlat=${resumo.posicao.lat}&mlon=${resumo.posicao.lon}#map=18/${resumo.posicao.lat}/${resumo.posicao.lon}` : undefined;
    try { await navigator.share({ title: 'Caminho Livre', text: texto, url }); } catch { /* cancelado */ }
  };
  return (
    <Tela className="tela-chegada" fala={fala}>
      <div className="cabecalho"><span /><span /><BotaoSom fala={fala} claro /></div>
      <Icone nome="lugar" className="icone-grande" />
      <Titulo>Você chegou em {nome}.</Titulo>
      <p className="sub">{resumo.minutos} {resumo.minutos === 1 ? 'minuto' : 'minutos'}{extra}</p>
      {typeof navigator !== 'undefined' && navigator.share ? (
        <button type="button" className="botao secundario" onClick={compartilhar}>
          <Icone nome="compartilhar" /><span>Avisar {prefs.acompanhante || 'quem acompanha'}</span>
        </button>
      ) : prefs.acompanhante && (
        <a className="botao secundario" href={`sms:?&body=${msg}`}><Icone nome="pessoa" /><span>Avisar {prefs.acompanhante}</span></a>
      )}
      <div className="empurra" />
      <section className="cartao-avaliacao">
        <h2>O caminho estava bom?</h2>
        <div className="avaliar">
          <button type="button" className="bom" disabled={avaliado} onClick={() => avaliar('bom')}><Icone nome="bom" />Bom</button>
          <button type="button" className="ruim" disabled={avaliado} onClick={() => avaliar('ruim')}><Icone nome="ruim" />Ruim</button>
        </div>
      </section>
      <button type="button" className="link-simples" style={{ color: 'inherit' }} onClick={aoFim}>Voltar ao início</button>
    </Tela>
  );
}
