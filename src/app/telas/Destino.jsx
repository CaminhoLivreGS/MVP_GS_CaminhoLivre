import { useEffect, useRef, useState } from 'react';
import { Aviso, AvisoSemVoz, Botao, Cabecalho, CaixaFala, Carregando, Rodape, Tela, Titulo } from '../componentes/base.jsx';
import { Icone, Marca } from '../componentes/Icone.jsx';
import { Mapa } from '../componentes/Mapa.jsx';
import { BarraNav } from '../componentes/BarraNav.jsx';
import { formatarDistancia } from '../../localizacao/geo.js';
import { escutaDisponivel, escutar, falar } from '../servicos/voz.js';

const ICONE_CATEGORIA = { ubs: 'ubs', hospital: 'ubs', clinica: 'ubs', farmacia: 'ubs', estacao: 'estacao', casa: 'casa' };

/** Página 4: início. */
export function Home({ clima, salvos, origem, local, avisoOrigem, aoFalar, aoDigitar, aoEscolher, aoMenu }) {
  const [texto, setTexto] = useState('');
  const [digitando, setDigitando] = useState(!escutaDisponivel());
  const fala = `${clima?.texto ? clima.texto + ' ' : ''}Para onde você quer ir? Toque no botão amarelo e fale.`;
  return (
    <Tela fala={fala}>
      <Cabecalho marca fala={fala} />
      {local && (
        <p className="local-atual"><Icone nome="lugar" /><span>{origem?.fonte === 'demo' ? 'Partida de demonstração: ' : 'Você está em '}{local}</span></p>
      )}
      {clima?.texto && (
        <div className="banner-clima" role="status">
          <Icone nome="chuva" />
          <p><strong>{clima.texto.split('.')[0]}.</strong>{clima.texto.split('.').slice(1).join('.')}
            {clima.simulado && <span className="nota"> (simulação)</span>}</p>
        </div>
      )}
      <AvisoSemVoz />
      {avisoOrigem && <Aviso tipo="info" icone="lugar">{avisoOrigem}</Aviso>}
      <div className="area-flex">
        <button type="button" className="botao-mic" onClick={aoFalar} aria-label="Falar para onde quer ir">
          <Icone nome="mic" />
        </button>
      </div>
      <div className="pergunta-central">
        <Titulo>Para onde você quer ir?</Titulo>
        <p>{escutaDisponivel() ? 'Toque e fale' : 'Digite o nome do lugar'}</p>
      </div>
      {digitando ? (
        <form className="digitar" onSubmit={(e) => { e.preventDefault(); if (texto.trim()) aoDigitar(texto.trim()); }}>
          <label htmlFor="campo-destino" className="so-leitor">Para onde você quer ir</label>
          <input id="campo-destino" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Ex.: posto de saúde" autoComplete="off" enterKeyHint="go" />
          <button type="submit" className="botao primario" aria-label="Buscar"><span>Ir</span></button>
        </form>
      ) : (
        <button type="button" className="link-simples" onClick={() => setDigitando(true)}>Prefiro digitar</button>
      )}
      {salvos.length > 0 && (
        <section aria-labelledby="titulo-salvos">
          <h2 id="titulo-salvos" style={{ marginBottom: 8 }}>Lugares salvos</h2>
          <div className="lugares-salvos">
            {salvos.map((l) => (
              <button key={l.id ?? l.nome} type="button" className="lugar-salvo" onClick={() => aoEscolher(l)}
                aria-label={`${l.apelido ?? l.nome}${l.distancia_m != null ? `, ${formatarDistancia(l.distancia_m)}` : ''}`}>
                <Icone nome={ICONE_CATEGORIA[l.categoria] ?? 'lugar'} />
                <strong>{l.apelido ?? l.nome}</strong>
                {l.distancia_m != null && <span>{formatarDistancia(l.distancia_m)}</span>}
              </button>
            ))}
          </div>
        </section>
      )}
      <BarraNav atual="home" aoIr={aoMenu} />
    </Tela>
  );
}

/** Página 5: estou ouvindo. */
export function Ouvindo({ aoResultado, aoFechar }) {
  const [parcial, setParcial] = useState('');
  const [erro, setErro] = useState(null);
  const escuta = useRef(null);
  useEffect(() => {
    let ativo = true;
    // pequena pausa para a fala anterior não ser captada pelo microfone
    const t = setTimeout(() => {
      escuta.current = escutar((p) => ativo && setParcial(p));
      escuta.current.pronto.then((txt) => ativo && aoResultado(txt)).catch((e) => {
        if (!ativo) return;
        const msg = e.message === 'PERMISSAO_NEGADA' ? 'O microfone não foi liberado. Você pode digitar o destino.'
          : e.message === 'SEM_SUPORTE' ? 'Este navegador não ouve. Você pode digitar o destino.'
            : 'Não ouvi nada. Toque em Falar de novo ou digite.';
        setErro(msg);
        falar(msg);
      });
    }, 350);
    return () => { ativo = false; clearTimeout(t); escuta.current?.parar(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Tela className="tela-ouvindo">
      <div className="cabecalho"><span /><span />
        <button type="button" className="botao-icone claro" onClick={aoFechar} aria-label="Fechar"><Icone nome="fechar" /></button>
      </div>
      <Titulo>{erro ? 'Não consegui ouvir' : 'Estou ouvindo…'}</Titulo>
      {!erro && <div className="onda" aria-hidden="true">{Array.from({ length: 9 }, (_, i) => <i key={i} />)}</div>}
      <div className="voce-disse" aria-live="polite">
        {erro ? <p>{erro}</p> : <>Você disse<strong>{parcial ? `"${parcial}"` : '…'}</strong></>}
      </div>
      <div className="empurra" />
      {erro ? (
        <Rodape>
          <Botao icone="mic" variante="escuro" onClick={() => { setErro(null); setParcial(''); aoFechar('falar'); }}>Falar de novo</Botao>
          <Botao icone="teclado" variante="secundario" onClick={() => aoFechar('digitar')}>Digitar</Botao>
        </Rodape>
      ) : (
        <Botao icone="mic" variante="escuro" onClick={() => escuta.current?.parar()}>Parar de ouvir</Botao>
      )}
    </Tela>
  );
}

/** Página 6: confirmar destino. */
export function ConfirmarDestino({ resultado, carregando, erro, aoSim, aoNao, aoVoltar }) {
  const [indice, setIndice] = useState(0);
  if (carregando) {
    return (
      <Tela fala="Procurando o lugar.">
        <Cabecalho titulo="Destino" aoVoltar={aoVoltar} />
        <Carregando texto="Procurando o lugar…" />
      </Tela>
    );
  }
  if (erro || !resultado) {
    return (
      <Tela fala={erro}>
        <Cabecalho titulo="Destino" aoVoltar={aoVoltar} fala={erro} />
        <Titulo>Não consegui buscar</Titulo>
        <Aviso tipo="erro">{erro}</Aviso>
        <div className="empurra" />
        <Botao icone="mic" variante="secundario" onClick={aoNao}>Tentar de novo</Botao>
      </Tela>
    );
  }
  if (resultado.emergencia) {
    return (
      <Tela fala={resultado.fala}>
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
    return (
      <Tela fala={resultado.fala}>
        <Cabecalho titulo="Destino" aoVoltar={aoVoltar} fala={resultado.fala} />
        <CaixaFala titulo={<Titulo>{resultado.fala}</Titulo>}>Fale o nome do lugar e do bairro, por exemplo "UBS Santa Maria Goretti".</CaixaFala>
        <div className="empurra" />
        <Botao icone="mic" variante="secundario" onClick={aoNao}>Falar de novo</Botao>
      </Tela>
    );
  }
  const distTxt = c.distancia_m != null ? `, a ${c.distancia_m >= 100 ? Math.round(c.distancia_m / 50) * 50 : c.distancia_m} metros` : '';
  const fala = indice === 0 ? resultado.fala : `Encontrei ${c.nome}${distTxt}. Quer ir para lá?`;
  const outros = resultado.candidatos.filter((_, i) => i !== indice);
  return (
    <Tela fala={fala} key={indice}>
      <Cabecalho titulo="Destino" aoVoltar={aoVoltar} fala={fala} />
      <CaixaFala titulo={<Titulo>{c.nome.length > 34 ? `Encontrei este lugar${distTxt}. Quer ir para lá?` : fala}</Titulo>} />
      <div className="cartao">
        <Mapa coords={[]} marcadores={[{ lat: c.lat, lon: c.lon, tipo: 'destino' }]} altura="pequena"
          rotulo={`Mapa com ${c.nome}`} />
        <div className="cartao-lugar">
          <Icone nome={ICONE_CATEGORIA[c.categoria] ?? 'lugar'} />
          <div>
            <strong>{c.nome}</strong>
            <span>{[c.endereco, c.horario && `horário: ${c.horario}`].filter(Boolean).join(' · ') || 'Endereço não informado no mapa aberto'}</span>
          </div>
        </div>
      </div>
      {outros.length > 0 && (
        <details>
          <summary className="link-simples">Ver outros lugares parecidos</summary>
          <div className="lista-simples" style={{ marginTop: 10 }}>
            {resultado.candidatos.map((o, i) => i !== indice && (
              <button key={o.id} type="button" className="item-ajuste" onClick={() => setIndice(i)}>
                <Icone nome={ICONE_CATEGORIA[o.categoria] ?? 'lugar'} />
                <div><strong>{o.nome}</strong>{o.distancia_m != null && <span>{formatarDistancia(o.distancia_m)}</span>}</div>
              </button>
            ))}
          </div>
        </details>
      )}
      <div className="empurra" />
      <Rodape>
        <Botao icone="ok" onClick={() => aoSim(c)}>Sim, quero ir</Botao>
        <Botao icone="mic" variante="secundario" onClick={aoNao}>Não, falar de novo</Botao>
      </Rodape>
    </Tela>
  );
}

export { Marca };
