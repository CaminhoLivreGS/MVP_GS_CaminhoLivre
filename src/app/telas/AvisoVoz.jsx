import { useEffect, useRef, useState } from 'react';
import { Aviso, Botao, Cabecalho, CaixaFala, Carregando, Progresso, Tela, Titulo } from '../componentes/base.jsx';
import { Icone } from '../componentes/Icone.jsx';
import { api } from '../servicos/api.js';
import { escutaDisponivel, escutar, falar } from '../servicos/voz.js';
import { TIPOS_AVISO } from './Avisar.jsx';

// No relato por voz entram também as categorias que a foto não distingue bem.
const TIPOS_VOZ = [
  ...TIPOS_AVISO.filter((t) => !['entrada', 'outro'].includes(t.id)),
  { id: 'calcada_irregular', icone: 'buraco', nome: 'Calçada quebrada', falar: 'calçada quebrada' },
  { id: 'obra', icone: 'obstaculo', nome: 'Obra', falar: 'obra na calçada' },
  { id: 'outro', icone: 'outro', nome: 'Outro', falar: 'outro problema' },
];

/** Avisar: escolher entre foto e voz (pitch: "enviando uma fotografia ou descrevendo a situação por meio de voz"). */
export function EscolherAviso({ aoFoto, aoVoz, aoVoltar }) {
  const fala = 'Como você quer avisar o problema? Tirar uma foto, ou descrever falando.';
  return (
    <Tela fala={fala} fixa>
      <Cabecalho titulo="Avisar problema" aoVoltar={aoVoltar} fala={fala} />
      <CaixaFala titulo={<Titulo className="titulo-fala">Como você quer avisar?</Titulo>}>
        O aviso vai para o mapa e ajuda outras pessoas a desviar.
      </CaixaFala>
      <div className="opcoes opcoes-modo">
        <button type="button" className="opcao opcao-modo" onClick={aoFoto}>
          <Icone nome="camera" /><span><strong>Tirar foto</strong><small>A câmera ajuda a identificar o problema. Rostos e placas são borrados.</small></span>
        </button>
        <button type="button" className="opcao opcao-modo" onClick={aoVoz}>
          <Icone nome="mic" /><span><strong>Descrever falando</strong><small>Conte o que tem no caminho. Não precisa de foto.</small></span>
        </button>
      </div>
      <div className="empurra" />
    </Tela>
  );
}

/**
 * Relato por voz: a pessoa fala (ou digita), a IA sugere a categoria e a pessoa confirma.
 * Vai sem foto, com a localização atual. Entra "em verificação" como qualquer aviso.
 */
export function AvisoVoz({ posicao, aoVoltar, aoEnviado }) {
  const temEscuta = escutaDisponivel();
  const [fase, setFase] = useState(temEscuta ? 'gravando' : 'editando'); // gravando | editando | classificando | confirmar | enviando
  const [texto, setTexto] = useState('');
  const [sugestao, setSugestao] = useState(null);
  const [escolha, setEscolha] = useState(null);
  const [erro, setErro] = useState(null);
  const [canal, setCanal] = useState(temEscuta ? 'voz' : 'texto');
  const escuta = useRef(null);
  const ativo = useRef(true);

  const gravar = (base = '') => {
    setErro(null);
    setFase('gravando');
    setCanal('voz');
    const juntar = (a, b) => [a, b].map((x) => (x ?? '').trim()).filter(Boolean).join(' ');
    escuta.current = escutar((p) => ativo.current && setTexto(juntar(base, p)), { continuo: true });
    escuta.current.pronto
      .then((t) => { if (ativo.current) { setTexto(juntar(base, t)); setFase('editando'); } })
      .catch((e) => {
        if (!ativo.current) return;
        const msg = e.message === 'PERMISSAO_NEGADA' ? 'O microfone não foi liberado. Você pode escrever.'
          : base ? null : 'Não ouvi nada. Toque em Gravar de novo ou escreva.';
        if (msg) { setErro(msg); falar(msg); }
        setFase('editando');
      });
  };

  useEffect(() => {
    ativo.current = true;
    if (temEscuta) {
      falar('Conte o que tem no caminho. Quando terminar, toque em Parar.');
      const t = setTimeout(() => gravar(), 2600);
      return () => { ativo.current = false; clearTimeout(t); escuta.current?.parar(); };
    }
    return () => { ativo.current = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const classificar = async () => {
    if (texto.trim().length < 3) { setErro('Conte um pouco mais sobre o problema.'); return; }
    setErro(null);
    setFase('classificando');
    try {
      const r = await api.classificarRelatoVoz(texto.trim());
      setSugestao(r);
      setEscolha(r.categoria);
      const t = TIPOS_VOZ.find((x) => x.id === r.categoria);
      falar(r.categoria !== 'outro' ? `Entendi: ${t?.falar ?? r.nome}. Está certo? Se não, escolha outro tipo.` : 'Qual é o tipo do problema? Escolha abaixo.');
    } catch {
      setSugestao(null);
      setEscolha(null);
      falar('Qual é o tipo do problema? Escolha abaixo.');
    }
    setFase('confirmar');
  };

  const enviar = async () => {
    if (!posicao) { setErro('Sem localização: não sei onde está o problema.'); return; }
    setFase('enviando');
    const form = new FormData();
    form.set('categoria', escolha);
    form.set('lat', String(posicao.lat));
    form.set('lon', String(posicao.lon));
    form.set('descricao', texto.trim().slice(0, 400));
    form.set('canal', canal);
    try {
      const criado = await api.criarRelato(form);
      aoEnviado(criado, escolha);
    } catch (e) {
      setErro(e.message);
      setFase('confirmar');
    }
  };

  const fala = 'Descreva o problema falando.';
  return (
    <Tela fala={temEscuta ? undefined : 'Escreva o que tem no caminho.'} fixa={fase !== 'confirmar' && fase !== 'enviando'}>
      <Cabecalho titulo="Avisar por voz" aoVoltar={aoVoltar} fala={fala} />
      <Progresso passo={fase === 'confirmar' || fase === 'enviando' ? 2 : 1} />
      {(fase === 'gravando' || fase === 'editando' || fase === 'classificando') && (
        <>
          <CaixaFala titulo={<Titulo className="titulo-fala">{fase === 'gravando' ? 'Estou ouvindo…' : 'O que tem no caminho?'}</Titulo>}>
            Ex.: “Tem um carro parado em cima da calçada na frente da padaria.”
          </CaixaFala>
          {fase === 'gravando' && (
            <div className="area-flex">
              <button type="button" className="botao-mic gravando" onClick={() => escuta.current?.parar()} aria-label="Parar de gravar">
                <Icone nome="pausa" />
              </button>
            </div>
          )}
          <div className="campo">
            <label htmlFor="texto-relato"><strong>{fase === 'gravando' ? 'O que eu entendi até agora' : 'Sua descrição (pode corrigir)'}</strong></label>
            <textarea id="texto-relato" rows={4} maxLength={400} value={texto} readOnly={fase === 'gravando'}
              onChange={(e) => { setTexto(e.target.value); if (canal === 'voz' && !temEscuta) setCanal('texto'); }}
              placeholder="Escreva aqui se preferir" />
          </div>
          {erro && <Aviso tipo="erro">{erro}</Aviso>}
          {fase === 'classificando' && <Carregando texto="Entendendo o tipo do problema" />}
          <div className="empurra" />
          {fase === 'editando' && (
            <>
              <Botao icone="seta" disabled={texto.trim().length < 3} onClick={classificar}>Continuar</Botao>
              {temEscuta && <Botao icone="mic" variante="secundario" onClick={() => gravar(texto)}>{texto ? 'Gravar mais' : 'Gravar de novo'}</Botao>}
            </>
          )}
          {fase === 'gravando' && <Botao icone="pausa" variante="secundario" onClick={() => escuta.current?.parar()}>Parar de gravar</Botao>}
        </>
      )}
      {(fase === 'confirmar' || fase === 'enviando') && (
        <>
          <CaixaFala titulo={<Titulo className="titulo-fala">{sugestao && sugestao.categoria !== 'outro'
            ? `Parece ${TIPOS_VOZ.find((x) => x.id === sugestao.categoria)?.falar ?? sugestao.nome}. Está certo?` : 'Qual é o tipo do problema?'}</Titulo>}>
            {sugestao?.fonte && sugestao.fonte !== 'regras' ? 'Sugestão da inteligência artificial. Você decide.' : 'Sugestão automática. Você decide.'}
          </CaixaFala>
          <p className="descricao-relato">“{texto.trim()}”</p>
          <div className="grade-opcoes" role="radiogroup" aria-label="Tipo do problema">
            {TIPOS_VOZ.map((x) => (
              <button key={x.id} type="button" role="radio" aria-checked={escolha === x.id} className="opcao" onClick={() => { setEscolha(x.id); falar(x.nome); }}>
                <Icone nome={x.icone} /><span>{x.nome}</span>
              </button>
            ))}
          </div>
          <p className="nota">Vai sem foto, com o local onde você está agora. Não enviamos seu nome nem sua voz, só o texto.</p>
          {erro && <Aviso tipo="erro">{erro}</Aviso>}
          <div className="empurra" />
          <Botao icone="alerta" variante="alerta" disabled={!escolha || fase === 'enviando'} onClick={enviar}>
            {fase === 'enviando' ? 'Enviando…' : 'Enviar aviso'}
          </Botao>
          <Botao variante="secundario" icone="voltar" onClick={() => setFase('editando')}>Corrigir o texto</Botao>
        </>
      )}
    </Tela>
  );
}

export { TIPOS_VOZ };
