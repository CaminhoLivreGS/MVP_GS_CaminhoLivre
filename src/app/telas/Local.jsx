import { useEffect, useRef, useState } from 'react';
import { Aviso, Botao, Cabecalho, CaixaFala, Carregando, Rodape, Tela, Titulo } from '../componentes/base.jsx';
import { Icone } from '../componentes/Icone.jsx';
import { Mapa } from '../componentes/Mapa.jsx';
import { formatarDistancia } from '../../localizacao/geo.js';
import { api } from '../servicos/api.js';
import { falar } from '../servicos/voz.js';

const PILOTO = 'shopping-uniao-osasco'; // lugar mapeado do piloto (demonstração fora de Osasco)
const PORTA = { automatica: 'Porta automática', giratoria: 'Porta giratória', comum: 'Porta comum', deslizante: 'Porta de correr' };

/** Características de uma entrada em frases curtas (o que importa para decidir). */
export function caracteristicas(e) {
  const out = [];
  if (e.degraus === 0) out.push('Sem degraus');
  else if (e.degraus) out.push(`${e.degraus} ${e.degraus === 1 ? 'degrau' : 'degraus'}`);
  if (e.rampa) out.push('Rampa');
  if (e.elevador) out.push('Elevador');
  if (e.porta && PORTA[e.porta]) out.push(PORTA[e.porta]);
  if (e.largura_m) out.push(`Passagem de ${Math.round(e.largura_m * 100)} cm`);
  if (e.piso_tatil) out.push('Piso tátil');
  if (e.coberta) out.push('Coberta');
  return out;
}

/** Cartão da entrada (ou saída) escolhida, com a fonte do dado sempre visível. */
export function CartaoEntrada({ entrada, titulo = 'Entrada recomendada', dadosExemplo, fechado, descartadas = [] }) {
  if (!entrada) return null;
  return (
    <section className="cartao cartao-entrada" aria-label={titulo}>
      <div className="cartao-entrada-topo">
        <Icone nome="porta" />
        <div>
          <span className="rotulo-pequeno">{titulo}</span>
          <strong>{entrada.nome}</strong>
          {entrada.distancia_fora_m != null && (
            <span>{formatarDistancia(entrada.distancia_fora_m)} pelo caminho{entrada.distancia_dentro_m ? ` + ${formatarDistancia(entrada.distancia_dentro_m)} dentro do lugar` : ''}</span>
          )}
        </div>
      </div>
      <ul className="chips" aria-label="Como é">
        {caracteristicas(entrada).map((c) => <li key={c} className="chip">{c}</li>)}
      </ul>
      {entrada.horario && <p className="nota">Horário: {entrada.horario}{fechado ? ' · fechada agora' : ''}</p>}
      {descartadas.length > 0 && (
        <details>
          <summary className="link-simples">Por que não as outras ({descartadas.length})</summary>
          <ul className="lista-avisos">{descartadas.map((d) => <li key={d.id}><strong>{d.nome}</strong>: {d.motivo}.</li>)}</ul>
        </details>
      )}
      {dadosExemplo && <p className="selo-exemplo">Dados de exemplo · serão trocados pelo levantamento em campo</p>}
    </section>
  );
}

/** Lê o QR code colado no ponto interno (ex.: praça de alimentação). Usa o leitor nativo do navegador. */
function LeitorQR({ aoLer, aoFechar }) {
  const video = useRef(null);
  const [erro, setErro] = useState(null);
  useEffect(() => {
    if (!('BarcodeDetector' in window)) {
      setErro('Este navegador não lê QR code. Escolha na lista onde você está.');
      return undefined;
    }
    let stream;
    let timer;
    let vivo = true;
    (async () => {
      try {
        const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
        if (!vivo) return;
        video.current.srcObject = stream;
        await video.current.play();
        timer = setInterval(async () => {
          try {
            const [c] = await detector.detect(video.current);
            if (c?.rawValue) { clearInterval(timer); aoLer(c.rawValue); }
          } catch { /* quadro sem código */ }
        }, 400);
      } catch {
        if (vivo) setErro('Não consegui abrir a câmera. Escolha na lista onde você está.');
      }
    })();
    return () => { vivo = false; clearInterval(timer); stream?.getTracks().forEach((t) => t.stop()); };
  }, [aoLer]);
  return (
    <div className="leitor-qr">
      {erro ? <Aviso tipo="info">{erro}</Aviso> : (
        <>
          <video ref={video} playsInline muted aria-label="Câmera para ler o código" />
          <p className="nota">Aponte para o código colado na parede ou na placa.</p>
        </>
      )}
      <Botao variante="secundario" icone="fechar" onClick={aoFechar}>Fechar leitor</Botao>
    </div>
  );
}

/** Conteúdo do QR: link do app com ?saindo=<lugar>&ponto=<ponto> (abre o app pela câmera comum também). */
export function lerCodigoLocal(texto) {
  try {
    const u = new URL(texto, location.origin);
    const local = u.searchParams.get('saindo');
    return local ? { localId: local, ponto: u.searchParams.get('ponto') } : null;
  } catch {
    return null;
  }
}

/** "Estou saindo": de onde você está dentro do lugar até a melhor saída para o seu destino. */
export function Saindo({ origem, perfis, salvos, inicial, hora, aoVoltar, aoRota }) {
  const [locais, setLocais] = useState(null);
  const [local, setLocal] = useState(null);
  const [ponto, setPonto] = useState(inicial?.ponto ?? null);
  const [texto, setTexto] = useState('');
  const [lendo, setLendo] = useState(false);
  const [destino, setDestino] = useState(null);
  const [opcoesDestino, setOpcoesDestino] = useState([]);
  const [busca, setBusca] = useState('');
  const [res, setRes] = useState({ carregando: false });

  // Lugar: o do QR code / link, ou os mapeados perto de você.
  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        if (inicial?.localId) {
          const l = await api.local(inicial.localId);
          if (vivo) { setLocal(l); setLocais([l]); }
        } else {
          const r = await api.locaisPerto(origem.lat, origem.lon);
          if (vivo) { setLocais(r.locais); if (r.locais.length) setLocal(await api.local(r.locais[0].id)); }
        }
      } catch {
        if (vivo) setLocais([]);
      }
    })();
    return () => { vivo = false; };
  }, [inicial?.localId, origem.lat, origem.lon]);

  // Destinos lá fora: ponto de ônibus mais perto do lugar + lugares salvos.
  useEffect(() => {
    if (!local) return;
    api.lugares('', { lat: local.lat, lon: local.lon }, 'ponto_onibus')
      .then((r) => setOpcoesDestino([...(r.lugares[0] ? [{ ...r.lugares[0], apelido: 'Ponto de ônibus mais perto' }] : []), ...salvos]))
      .catch(() => setOpcoesDestino(salvos));
  }, [local, salvos]);

  const nomePonto = local?.pontos_internos.find((p) => p.id === ponto)?.nome;
  const pronto = local && destino && (ponto || texto.trim());

  async function calcular() {
    setRes({ carregando: true });
    try {
      const r = await api.saida({ localId: local.id, ponto, texto: ponto ? null : texto, destino, perfis, hora });
      setRes({ carregando: false, r });
      if (r.ponto) setPonto(r.ponto.id);
      falar(r.fala);
    } catch (e) {
      setRes({ carregando: false, erro: e.message });
      falar(e.message);
    }
  }

  async function buscarDestino(e) {
    e.preventDefault();
    if (!busca.trim()) return;
    try {
      const r = await api.lugares(busca.trim(), { lat: local.lat, lon: local.lon });
      setOpcoesDestino((o) => [...r.lugares.slice(0, 3), ...o.filter((x) => !r.lugares.some((y) => y.id === x.id))]);
      if (r.lugares[0]) setDestino(r.lugares[0]);
    } catch { /* sem resultado */ }
  }

  const fala = 'Estou saindo. Me diga onde você está dentro do lugar e para onde vai, que eu indico a melhor saída.';
  if (locais === null) {
    return <Tela fala="Procurando o lugar."><Cabecalho titulo="Estou saindo" aoVoltar={aoVoltar} /><Carregando texto="Procurando o lugar…" /></Tela>;
  }
  if (!local) {
    return (
      <Tela fala="Ainda não tenho o mapa de entradas de um lugar perto de você.">
        <Cabecalho titulo="Estou saindo" aoVoltar={aoVoltar} />
        <CaixaFala titulo={<Titulo>Ainda não mapeamos as saídas deste lugar</Titulo>}>
          Por enquanto o piloto tem o Shopping União de Osasco. Você pode avisar como é uma entrada em "Avisar", na opção "Entrada de lugar".
        </CaixaFala>
        <div className="empurra" />
        <Rodape>
          <Botao icone="saida" onClick={async () => { const l = await api.local(PILOTO); setLocais([l]); setLocal(l); }}>
            Ver como funciona no Shopping União
          </Botao>
          <Botao variante="secundario" onClick={aoVoltar}>Voltar</Botao>
        </Rodape>
      </Tela>
    );
  }

  if (res.r?.escolhida) {
    const e = res.r.escolhida;
    const marcadores = [
      { id: 'saida', lat: e.lat, lon: e.lon, tipo: 'voce' },
      { id: 'destino', lat: destino.lat, lon: destino.lon, tipo: 'destino' },
      ...res.r.descartadas.map((d) => ({ id: d.id, lat: d.lat, lon: d.lon, tipo: 'perigo' })),
    ];
    return (
      <Tela fala={res.r.fala}>
        <Cabecalho titulo="Melhor saída" aoVoltar={() => setRes({ carregando: false })} fala={res.r.fala} />
        <CaixaFala titulo={<Titulo>{res.r.fala.split('.')[0]}.</Titulo>}>{res.r.fala.split('.').slice(1).join('.').trim()}</CaixaFala>
        <div className="cartao">
          <Mapa coords={[]} marcadores={marcadores} altura="pequena" rotulo={`Mapa com a saída ${e.nome} e o destino ${destino.nome}`} />
        </div>
        <CartaoEntrada entrada={e} titulo={`Saída a partir de: ${res.r.ponto?.nome ?? 'onde você está'}`}
          dadosExemplo={res.r.dados_exemplo} fechado={res.r.fechado_agora} descartadas={res.r.descartadas} />
        <div className="empurra" />
        <Rodape>
          <Botao icone="caminho" onClick={() => aoRota({ lat: e.lat, lon: e.lon, nome: `Saída: ${e.nome}` }, destino, res.r)}>
            Ver o caminho até {destino.apelido ?? destino.nome}
          </Botao>
          <Botao variante="secundario" onClick={() => setRes({ carregando: false })}>Mudar onde estou</Botao>
        </Rodape>
      </Tela>
    );
  }

  return (
    <Tela fala={fala}>
      <Cabecalho titulo="Estou saindo" aoVoltar={aoVoltar} fala={fala} />
      <p className="local-atual"><Icone nome="lugar" /><span>Você está no <strong>{local.nome}</strong></span></p>
      {locais.length > 1 && (
        <select aria-label="Trocar de lugar" value={local.id} onChange={async (ev) => setLocal(await api.local(ev.target.value))}>
          {locais.map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
        </select>
      )}
      {local.dados_exemplo && <p className="selo-exemplo">Dados de exemplo · serão trocados pelo levantamento em campo</p>}

      <section aria-labelledby="t-onde">
        <h2 id="t-onde">1. Em que parte você está?</h2>
        {lendo ? (
          <LeitorQR aoFechar={() => setLendo(false)} aoLer={(t) => {
            const c = lerCodigoLocal(t);
            setLendo(false);
            if (c?.localId === local.id && c.ponto) { setPonto(c.ponto); falar('Achei onde você está.'); }
            else falar('Esse código não é deste lugar. Escolha na lista.');
          }} />
        ) : (
          <>
            <div className="chips" role="radiogroup" aria-label="Onde você está">
              {local.pontos_internos.map((p) => (
                <button key={p.id} type="button" role="radio" aria-checked={ponto === p.id} className="chip"
                  onClick={() => { setPonto(p.id); setTexto(''); }}>
                  {ponto === p.id && <Icone nome="check" />}{p.nome}
                </button>
              ))}
            </div>
            <div className="linha-botoes">
              <Botao variante="secundario" icone="qr" onClick={() => setLendo(true)}>Ler código</Botao>
            </div>
            <label className="campo">
              <span>Ou escreva como falaria</span>
              <input value={texto} onChange={(ev) => { setTexto(ev.target.value); setPonto(null); }}
                placeholder="Ex.: estou perto do cinema" autoComplete="off" />
            </label>
            {nomePonto && <p className="nota">Você está em: {nomePonto}</p>}
          </>
        )}
      </section>

      <section aria-labelledby="t-para">
        <h2 id="t-para">2. Para onde você vai?</h2>
        <div className="lista-simples">
          {opcoesDestino.map((d) => (
            <button key={d.id ?? d.nome} type="button" className="item-ajuste" aria-pressed={destino?.id === d.id}
              onClick={() => setDestino(d)}>
              <Icone nome={destino?.id === d.id ? 'check' : 'lugar'} />
              <div><strong>{d.apelido ?? d.nome}</strong>{d.apelido && <span>{d.nome}</span>}</div>
            </button>
          ))}
        </div>
        <form className="digitar" onSubmit={buscarDestino}>
          <label htmlFor="busca-saida" className="so-leitor">Outro destino</label>
          <input id="busca-saida" value={busca} onChange={(ev) => setBusca(ev.target.value)} placeholder="Outro lugar" autoComplete="off" />
          <button type="submit" className="botao primario" aria-label="Buscar"><span>Ir</span></button>
        </form>
      </section>

      {res.erro && <Aviso tipo="erro">{res.erro}</Aviso>}
      {res.r && !res.r.escolhida && <Aviso tipo="info">{res.r.fala}</Aviso>}
      <div className="empurra" />
      <Botao icone="saida" disabled={!pronto || res.carregando} onClick={calcular}>
        {res.carregando ? 'Procurando a melhor saída…' : 'Qual a melhor saída?'}
      </Botao>
    </Tela>
  );
}
