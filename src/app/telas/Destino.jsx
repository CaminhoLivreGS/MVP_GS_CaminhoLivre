import { useEffect, useRef, useState } from 'react';
import { Aviso, AvisoSemVoz, Botao, BotaoSom, Cabecalho, CaixaFala, Carregando, Rodape, Tela, Titulo } from '../componentes/base.jsx';
import { resumoPerfil } from '../servicos/preferencias.js';
import { Icone, Marca } from '../componentes/Icone.jsx';
import { Mapa } from '../componentes/Mapa.jsx';
import { BarraNav } from '../componentes/BarraNav.jsx';
import { formatarDistancia } from '../../localizacao/geo.js';
import { escutaDisponivel, escutar, falar } from '../servicos/voz.js';

const ICONE_CATEGORIA = { ubs: 'ubs', hospital: 'ubs', clinica: 'ubs', farmacia: 'ubs', estacao: 'estacao', casa: 'casa' };

/** Página 4: início. */
/**
 * Página 4: início, no padrão dos apps de mapa (Google Maps, Waze): o mapa ao fundo mostra
 * você e as barreiras avisadas por perto; por cima, a barra de busca/local e o perfil em uso;
 * embaixo, um painel com a ação principal. Cabe numa tela, sem rolar.
 * modo 'fala': microfone grande no painel. modo 'digitar': busca em destaque no topo.
 */
export function Home({ clima, salvos, origem, local, avisoOrigem, aoFalar, aoDigitar, aoEscolher, aoMenu, locaisPerto = [], aoSaindo,
  modo = 'fala', perfil = null, aoPerfis, barreiras = [], aoBarreiras }) {
  const [texto, setTexto] = useState('');
  const modoDigitar = modo === 'digitar' || !escutaDisponivel();
  const [digitando, setDigitando] = useState(modoDigitar);
  const perto = barreiras.filter((b) => b.distancia <= 800);
  const fala = `${clima?.texto ? clima.texto + ' ' : ''}Para onde você quer ir? ${modoDigitar ? 'Digite o nome do lugar.' : 'Toque no botão amarelo e fale.'}`
    + (perto.length ? ` Há ${perto.length} ${perto.length === 1 ? 'barreira avisada' : 'barreiras avisadas'} perto de você.` : '');
  const saindoDe = locaisPerto[0] && locaisPerto[0].distancia_m < 600 ? locaisPerto[0] : null;
  const buscar = (e) => { e.preventDefault(); if (texto.trim()) aoDigitar(texto.trim()); };
  const campoBusca = (
    <form className="busca-flutuante" onSubmit={buscar} role="search">
      <Marca tamanho={34} />
      <label htmlFor="campo-destino" className="so-leitor">Para onde você quer ir</label>
      <input id="campo-destino" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Para onde você quer ir?"
        autoComplete="off" enterKeyHint="go" />
      {texto.trim() ? (
        <button type="submit" className="busca-ir" aria-label="Buscar"><Icone nome="seta" /></button>
      ) : escutaDisponivel() && (
        <button type="button" className="busca-mic" onClick={aoFalar} aria-label="Falar para onde quer ir"><Icone nome="mic" /></button>
      )}
    </form>
  );
  return (
    <Tela fala={fala} fixa className="tela-home">
      <div className="home-mapa">
        <Mapa posicao={origem} modo="seguir" zoomSeguir={16} focoAcima={0.18} altura="cheia"
          marcadores={perto.map((b) => ({ id: b.id, lat: b.lat, lon: b.lon, tipo: b.status === 'em_verificacao' ? 'verificacao' : 'perigo' }))}
          aoTocarMarcador={aoBarreiras ? (id) => aoBarreiras(id) : undefined}
          rotulo={`Mapa: você está em ${local ?? 'sua posição'}. ${perto.length} barreiras avisadas por perto; a lista está no Mapa de barreiras.`} />
      </div>

      <div className="home-topo">
        <div className="home-topo-linha">
          {digitando ? campoBusca : (
            <p className="pilula-local"><Marca tamanho={30} /><span>{local
              ? <>{origem?.fonte === 'demo' ? 'Demonstração: ' : ''}{local}</> : 'Procurando onde você está…'}</span></p>
          )}
          <BotaoSom fala={fala} />
        </div>
        <div className="home-topo-chips">
          <button type="button" className="pilula pilula-perfil" onClick={aoPerfis}
            aria-label={perfil ? `Rotas para ${perfil.nome}: ${resumoPerfil(perfil)}. Toque para trocar de perfil` : 'Cadastrar meu perfil'}>
            <Icone nome="pessoa" /><span>{perfil ? <><strong>{perfil.nome}</strong> · {resumoPerfil(perfil)}</> : 'Cadastrar meu perfil'}</span>
          </button>
          {clima?.texto && (
            <p className="pilula pilula-clima" title={clima.texto}>
              <Icone nome={clima.alerta_tipo === 'calor' || clima.alerta_tipo === 'uv' ? 'sol' : clima.alerta_tipo === 'ar' ? 'alerta' : 'chuva'} />
              <span>{clima.texto.split('.')[0]}{clima.simulado ? ' (simulação)' : ''}</span>
            </p>
          )}
        </div>
      </div>

      <section className="folha home-folha" aria-label="Para onde você quer ir">
        <AvisoSemVoz />
        {avisoOrigem && <p className="nota nota-origem"><Icone nome="lugar" />{avisoOrigem}</p>}
        {digitando ? (
          <Titulo className="home-titulo">Para onde você quer ir?</Titulo>
        ) : (
          <div className="home-falar">
            <button type="button" className="botao-mic" onClick={aoFalar} aria-label="Falar para onde quer ir"><Icone nome="mic" /></button>
            <div>
              <Titulo className="home-titulo">Para onde você quer ir?</Titulo>
              <p className="sub">Toque no microfone e fale.</p>
              <button type="button" className="link-simples link-digitar" onClick={() => setDigitando(true)}>Prefiro digitar</button>
            </div>
          </div>
        )}
        {!perfil && (
          <button type="button" className="convite-perfil" onClick={aoPerfis}>
            <Icone nome="bengala" /><span><strong>Cadastre seu perfil</strong> para rotas sem escadas, planas ou iluminadas. Leva 1 minuto.</span><Icone nome="seta" />
          </button>
        )}
        {salvos.length > 0 && (
          <div className="lugares-salvos" role="group" aria-label="Lugares salvos">
            {salvos.map((l) => (
              <button key={l.id ?? l.nome} type="button" className="lugar-salvo" onClick={() => aoEscolher(l)}
                aria-label={`${l.apelido ?? l.nome}${l.distancia_m != null ? `, ${formatarDistancia(l.distancia_m)}` : ''}`}>
                <Icone nome={ICONE_CATEGORIA[l.categoria] ?? 'lugar'} />
                <strong>{l.apelido ?? l.nome}</strong>
                {l.distancia_m != null && <span>{formatarDistancia(l.distancia_m)}</span>}
              </button>
            ))}
          </div>
        )}
        <div className="home-atalhos">
          {aoBarreiras && (
            <button type="button" className="atalho" onClick={() => aoBarreiras()}>
              <span className="atalho-num" aria-hidden="true">{perto.length}</span>
              <span className="so-leitor">{perto.length === 1 ? 'barreira perto' : 'barreiras perto'}. Ver no mapa</span>
              <span aria-hidden="true">Barreiras</span>
            </button>
          )}
          {aoSaindo && (
            <button type="button" className="atalho" onClick={aoSaindo}>
              <Icone nome="saida" /><span>{saindoDe ? `Saindo do ${saindoDe.nome}` : 'Estou saindo'}</span>
            </button>
          )}
        </div>
        <BarraNav atual="home" aoIr={aoMenu} />
      </section>
    </Tela>
  );
}

/** Campo para digitar o destino (usado quando a voz falha ou a pessoa prefere escrever). */
export function BuscaDigitada({ inicial = '', aoBuscar, rotulo = 'Buscar' }) {
  const [texto, setTexto] = useState(inicial);
  return (
    <form className="digitar" onSubmit={(e) => { e.preventDefault(); if (texto.trim()) aoBuscar(texto.trim()); }}>
      <label htmlFor="campo-busca" className="so-leitor">Para onde você quer ir</label>
      <input id="campo-busca" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Ex.: posto de saúde"
        autoComplete="off" enterKeyHint="search" autoFocus />
      <button type="submit" className="botao primario" aria-label={rotulo} disabled={!texto.trim()}><span>Ir</span></button>
    </form>
  );
}

/** Página 5: estou ouvindo. */
export function Ouvindo({ aoResultado, aoFechar }) {
  // gravando: microfone aberto até a pessoa apertar "Parar de gravar".
  // parado: o texto fica na tela; a pessoa busca ou continua gravando (acrescenta).
  const [estado, setEstado] = useState('gravando'); // gravando | parado | digitando
  const [texto, setTexto] = useState('');
  const [erro, setErro] = useState(null);
  const escuta = useRef(null);
  const ativo = useRef(true);
  const juntar = (a, b) => [a, b].map((x) => (x ?? '').trim()).filter(Boolean).join(' ');

  const gravar = (base = '') => {
    setErro(null);
    setEstado('gravando');
    escuta.current = escutar((p) => ativo.current && setTexto(juntar(base, p)), { continuo: true });
    escuta.current.pronto
      .then((t) => {
        if (!ativo.current) return;
        setTexto(juntar(base, t));
        setEstado('parado');
      })
      .catch((e) => {
        if (!ativo.current) return;
        if (base && e.message === 'SEM_FALA') { setTexto(base); setEstado('parado'); return; }
        const msg = e.message === 'PERMISSAO_NEGADA' ? 'O microfone não foi liberado. Você pode digitar o destino.'
          : e.message === 'SEM_SUPORTE' ? 'Este navegador não ouve. Você pode digitar o destino.'
            : 'Não ouvi nada. Toque em Gravar de novo ou digite.';
        setErro(msg);
        setEstado('parado');
        falar(msg);
      });
  };

  useEffect(() => {
    ativo.current = true;
    // pequena pausa para a fala anterior não ser captada pelo microfone
    const t = setTimeout(() => gravar(), 350);
    return () => { ativo.current = false; clearTimeout(t); escuta.current?.parar(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const gravando = estado === 'gravando';
  const digitar = () => { escuta.current?.parar(); setErro(null); setEstado('digitando'); };
  if (estado === 'digitando') {
    return (
      <Tela fixa className="tela-ouvindo" fala="Digite para onde você quer ir.">
        <div className="cabecalho"><span /><span />
          <button type="button" className="botao-icone claro" onClick={() => aoFechar()} aria-label="Fechar"><Icone nome="fechar" /></button>
        </div>
        <Titulo>Para onde você quer ir?</Titulo>
        <BuscaDigitada inicial={texto} aoBuscar={aoResultado} />
        <div className="empurra" />
        <Botao icone="mic" variante="secundario" onClick={() => gravar('')}>Prefiro falar</Botao>
      </Tela>
    );
  }
  return (
    <Tela fixa className="tela-ouvindo">
      <div className="cabecalho"><span /><span />
        <button type="button" className="botao-icone claro" onClick={() => aoFechar()} aria-label="Fechar"><Icone nome="fechar" /></button>
      </div>
      <Titulo>{erro ? 'Não consegui ouvir' : gravando ? 'Estou ouvindo…' : 'Confira o que você disse'}</Titulo>
      {gravando && <div className="onda" aria-hidden="true">{Array.from({ length: 9 }, (_, i) => <i key={i} />)}</div>}
      <div className="voce-disse" aria-live="polite">
        {erro ? <p>{erro}</p> : <>Você disse<strong>{texto ? `"${texto}"` : '…'}</strong></>}
      </div>
      <div className="empurra" />
      {gravando ? (
        <Botao icone="pausa" variante="escuro" onClick={() => escuta.current?.parar()}>Parar de gravar</Botao>
      ) : (
        <Rodape>
          {texto && <Botao icone="check" variante="escuro" onClick={() => aoResultado(texto)}>Buscar este destino</Botao>}
          <Botao icone="mic" variante={texto ? 'secundario' : 'escuro'} onClick={() => gravar(texto)}>
            {texto ? 'Continuar gravando' : 'Gravar de novo'}
          </Botao>
          <Botao icone="teclado" variante="secundario" onClick={digitar}>{texto ? 'Corrigir digitando' : 'Digitar'}</Botao>
        </Rodape>
      )}
    </Tela>
  );
}

/** Página 6: confirmar destino. */
export function ConfirmarDestino({ resultado, carregando, erro, consulta, aoSim, aoNao, aoVoltar, aoBuscar }) {
  const [indice, setIndice] = useState(0);
  useEffect(() => setIndice(0), [resultado]);
  if (carregando) {
    return (
      <Tela fala="Procurando o lugar." fixa>
        <Cabecalho titulo="Destino" aoVoltar={aoVoltar} />
        <Carregando texto="Procurando o lugar…" />
      </Tela>
    );
  }
  if (erro || !resultado) {
    return (
      <Tela fala={erro} fixa>
        <Cabecalho titulo="Destino" aoVoltar={aoVoltar} fala={erro} />
        <Titulo>Não consegui buscar</Titulo>
        <Aviso tipo="erro">{erro}</Aviso>
        {aoBuscar && <BuscaDigitada key={consulta} inicial={consulta} aoBuscar={aoBuscar} rotulo="Tentar de novo" />}
        <div className="empurra" />
        <Botao icone="mic" variante="secundario" onClick={aoNao}>Falar de novo</Botao>
      </Tela>
    );
  }
  if (resultado.emergencia) {
    return (
      <Tela fala={resultado.fala} fixa>
        <Cabecalho titulo="Emergência" aoVoltar={aoVoltar} fala={resultado.fala} />
        <CaixaFala titulo={<Titulo>{resultado.fala}</Titulo>} />
        <a className="botao alerta" href="tel:192"><Icone nome="alerta" /><span>Ligar 192 (SAMU)</span></a>
        <div className="empurra" />
        <Botao variante="secundario" onClick={aoVoltar}>Voltar</Botao>
      </Tela>
    );
  }
  const c = resultado.candidatos[indice];
  if (!c) {
    const naoAchei = consulta ? `Não encontrei "${consulta}" aqui perto.` : 'Não encontrei esse lugar aqui perto.';
    return (
      <Tela fala={`${naoAchei} Digite outro nome ou fale de novo.`} key={consulta} fixa>
        <Cabecalho titulo="Destino" aoVoltar={aoVoltar} fala={naoAchei} />
        <Titulo>Não encontrei esse lugar</Titulo>
        <Aviso tipo="erro" icone="lugar">{naoAchei} Tente o nome com o bairro, por exemplo "UBS Santa Maria Goretti", ou um tipo de lugar, como "farmácia".</Aviso>
        {aoBuscar && <BuscaDigitada key={consulta} inicial={consulta} aoBuscar={aoBuscar} />}
        <div className="empurra" />
        <Botao icone="mic" variante="secundario" onClick={aoNao}>Falar de novo</Botao>
      </Tela>
    );
  }
  const distTxt = c.distancia_m != null ? `, a ${c.distancia_m >= 100 ? Math.round(c.distancia_m / 50) * 50 : c.distancia_m} metros` : '';
  const fala = indice === 0 ? resultado.fala : `Encontrei ${c.nome}${distTxt}. Quer ir para lá?`;
  const outros = resultado.candidatos.filter((_, i) => i !== indice);
  return (
    <Tela fala={fala} key={indice} fixa>
      <Cabecalho titulo="Destino" aoVoltar={aoVoltar} fala={fala} />
      <CaixaFala titulo={<Titulo>{c.nome.length > 34 ? `Encontrei este lugar${distTxt}. Quer ir para lá?` : fala}</Titulo>}>
        {consulta && <span className="nota">Você buscou: "{consulta}"</span>}
      </CaixaFala>
      <div className="cartao cartao-destino">
        <div className="mapa-flex mapa-flex-interna">
          <Mapa coords={[]} marcadores={[{ lat: c.lat, lon: c.lon, tipo: 'destino' }]} altura="pequena"
            rotulo={`Mapa com ${c.nome}`} />
        </div>
        <div className="cartao-lugar">
          <Icone nome={ICONE_CATEGORIA[c.categoria] ?? 'lugar'} />
          <div>
            <strong>{c.nome}</strong>
            <span>{[c.endereco, c.horario && `horário: ${c.horario}`].filter(Boolean).join(' · ') || 'Endereço não informado no mapa aberto'}</span>
          </div>
        </div>
      </div>
      {outros.length > 0 && (
        <details className="outros-lugares">
          <summary className="link-simples">Ver outros {outros.length} lugares parecidos</summary>
          <div className="lista-simples lista-rolavel">
            {resultado.candidatos.map((o, i) => i !== indice && (
              <button key={o.id} type="button" className="item-ajuste" onClick={() => setIndice(i)}>
                <Icone nome={ICONE_CATEGORIA[o.categoria] ?? 'lugar'} />
                <div><strong>{o.nome}</strong>{o.distancia_m != null && <span>{formatarDistancia(o.distancia_m)}</span>}</div>
              </button>
            ))}
          </div>
        </details>
      )}
      <Rodape>
        <Botao icone="ok" onClick={() => aoSim(c)}>Sim, quero ir</Botao>
        <Botao icone="mic" variante="secundario" onClick={aoNao}>Não, falar de novo</Botao>
      </Rodape>
    </Tela>
  );
}

export { Marca };
