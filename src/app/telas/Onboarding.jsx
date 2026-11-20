import { useState } from 'react';
import { AvisoSemVoz, Botao, Cabecalho, CaixaFala, Progresso, Rodape, Tela, Titulo, BotaoSom, VozContexto } from '../componentes/base.jsx';
import { useContext } from 'react';
import { Icone, Marca } from '../componentes/Icone.jsx';
import { calar, falar } from '../servicos/voz.js';

const EXPLICACAO = 'O Caminho Livre mostra o caminho a pé mais seguro para o seu jeito de andar. '
  + 'Ele desvia de buracos, escadas e calçadas quebradas que os vizinhos avisaram. Eu falo cada passo com você. Não precisa ler nada.';

/** Página 1 do guia: boas-vindas. */
export function BoasVindas({ aoComecar }) {
  const fala = 'Caminho Livre. O caminho mais seguro para o seu jeito de andar. Eu falo cada passo com você. Não precisa ler nada. Toque em Começar.';
  return (
    <Tela fala={fala} fixa>
      <div className="area-flex">
      <div className="boas-vindas-arte" aria-hidden="true">
        <div className="arte-braille">{Array.from({ length: 16 }, (_, i) => <i key={i} />)}</div>
        <div className="arte-caminho">
          <svg viewBox="0 0 60 100"><path d="M14 85V58a12 12 0 0 1 12-12h10a8 8 0 0 0 8-8V20" fill="none" stroke="var(--amarelo)" strokeWidth="8" strokeLinecap="round" /><circle cx="44" cy="17" r="9" fill="var(--amarelo)" /></svg>
        </div>
      </div>
      </div>
      <p className="marca-linha"><Marca tamanho={56} /> Caminho Livre</p>
      <Titulo>O caminho mais seguro para o seu jeito de andar.</Titulo>
      <p className="sub">Eu falo cada passo com você. Não precisa ler nada.</p>
      <AvisoSemVoz />
      <InterruptorSom />
      <Rodape>
        <Botao icone="seta" onClick={aoComecar}>Começar</Botao>
        <Botao icone="som" variante="secundario" onClick={() => falar(EXPLICACAO, { forcar: true })}>Ouvir explicação</Botao>
      </Rodape>
    </Tela>
  );
}

/** Escolha explícita logo no início: com ou sem som. */
function InterruptorSom() {
  const { ativa, alternar } = useContext(VozContexto);
  return (
    <div className="preferencia">
      <Icone nome={ativa ? 'som' : 'somMudo'} />
      <div className="preferencia-texto"><strong>Falar em voz alta</strong><span>{ativa ? 'Ligado: eu leio cada tela' : 'Desligado: só texto e vibração'}</span></div>
      <button type="button" role="switch" aria-checked={ativa} aria-label="Falar em voz alta" className="chave"
        onClick={() => { if (ativa) calar(); alternar(!ativa); if (!ativa) falar('Som ligado.', { forcar: true }); }} />
    </div>
  );
}

/**
 * Escolha do modo de uso (pitch: "o usuário pode escolher entre dois modos: fala ou digitação").
 * Fala: a voz conduz (microfone em destaque, tudo narrado). Digitar: telas com texto, sem
 * narração automática; o microfone continua à mão para quem quiser usar comandos de voz.
 */
export function Modo({ atual, aoEscolher, aoVoltar, aoPular, passo = 1, total = 4 }) {
  const fala = 'Como você prefere usar o app? Quero falar: você diz o destino e eu leio tudo em voz alta. Quero digitar: você navega pelas telas e usa a voz quando quiser.';
  const opcoes = [
    { id: 'fala', icone: 'mic', titulo: 'Quero falar', sub: 'Aperto um botão e digo o destino. O app lê tudo em voz alta.' },
    { id: 'digitar', icone: 'teclado', titulo: 'Quero digitar', sub: 'Navego pelas telas e escrevo. Uso a voz quando quiser.' },
  ];
  return (
    <Tela fala={fala} fixa>
      <Cabecalho titulo="Modo de uso" aoVoltar={aoVoltar} fala={fala} />
      {passo && <Progresso passo={passo} total={total} />}
      <CaixaFala titulo={<Titulo className="titulo-fala">Como você prefere usar o app?</Titulo>}>Dá para trocar depois em Ajustes.</CaixaFala>
      <div className="opcoes opcoes-modo" role="radiogroup" aria-label="Modo de uso">
        {opcoes.map((o) => (
          <button key={o.id} type="button" role="radio" aria-checked={atual === o.id} className="opcao opcao-modo" onClick={() => aoEscolher(o.id)}>
            <Icone nome={o.icone} />
            <span><strong>{o.titulo}</strong><small>{o.sub}</small></span>
            {atual === o.id && <span className="opcao-check"><Icone nome="check" /></span>}
          </button>
        ))}
      </div>
      <div className="empurra" />
      {aoPular && <button type="button" className="link-simples" onClick={aoPular}>Pular e configurar depois</button>}
    </Tela>
  );
}

const PERFIS = [
  { id: 'cadeira', icone: 'cadeira', titulo: 'Cadeira de rodas' },
  { id: 'muletas', icone: 'muleta', titulo: 'Muletas' },
  { id: 'bengala', icone: 'bengala', titulo: 'Bengala ou andador' },
  { id: 'baixa_visao', icone: 'olho', titulo: 'Enxergo pouco' },
  { id: 'sem_apoio', icone: 'caminho', titulo: 'Ando sem apoio' },
];

/** Preferências que valem para qualquer perfil (o roteamento usa todas juntas). */
const PREFERENCIAS_ROTA = [
  { id: 'sem_escada', icone: 'escada', titulo: 'Sem escadas' },
  { id: 'plano', icone: 'plano', titulo: 'Caminho plano' },
  { id: 'iluminado', icone: 'sol', titulo: 'Rua iluminada' },
];

/**
 * Página 2: como você anda na rua (vários) + o que evitar no caminho. Cabe numa tela:
 * perfis em grade 2 x 3 e preferências como fichas. comNome: cadastro de outro perfil
 * ("Minha mãe"), com campo de nome. aoPular: deixa para cadastrar depois.
 */
export function Perfil({ perfis, preferencias = [], nome = '', comNome = false, aoMudar, aoVoltar, aoContinuar, aoPular,
  passo = 1, total = 4, rotuloContinuar = 'Continuar' }) {
  const [sel, setSel] = useState(perfis.length ? perfis : []);
  const [prefs, setPrefs] = useState(preferencias);
  const [apelido, setApelido] = useState(nome);
  const fala = (comNome ? 'Dê um nome para este perfil. ' : '') + 'Como você anda na rua? Pode escolher mais de um. '
    + PERFIS.map((p) => p.titulo).join('. ') + '. No caminho, você quer: ' + PREFERENCIAS_ROTA.map((p) => p.titulo).join('. ') + '.';
  const alternar = (id) => {
    let novo = sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id];
    if (id === 'sem_apoio' && novo.includes('sem_apoio')) novo = ['sem_apoio'];
    else novo = novo.filter((x) => x !== 'sem_apoio' || id === 'sem_apoio');
    setSel(novo);
    const p = PERFIS.find((x) => x.id === id);
    falar(`${p.titulo}: ${novo.includes(id) ? 'escolhido' : 'tirado'}.`);
  };
  const alternarPref = (id) => {
    const novo = prefs.includes(id) ? prefs.filter((x) => x !== id) : [...prefs, id];
    setPrefs(novo);
    const p = PREFERENCIAS_ROTA.find((x) => x.id === id);
    falar(`${p.titulo}: ${novo.includes(id) ? 'escolhido' : 'tirado'}.`);
  };
  const pronto = sel.length > 0 && (!comNome || apelido.trim());
  return (
    <Tela fala={fala} fixa className="tela-perfil">
      <Cabecalho titulo={comNome ? 'Novo perfil' : 'Seu perfil'} aoVoltar={aoVoltar} fala={fala} />
      {passo && <Progresso passo={passo} total={total} />}
      {comNome && (
        <div className="campo campo-nome">
          <label htmlFor="nome-perfil"><strong>Nome do perfil</strong></label>
          <input id="nome-perfil" value={apelido} maxLength={24} onChange={(e) => setApelido(e.target.value)} placeholder="Ex.: Minha mãe" autoComplete="off" />
        </div>
      )}
      <Titulo className="titulo-secao">Como {comNome ? 'essa pessoa anda' : 'você anda'} na rua?</Titulo>
      <div className="grade-perfis" role="group" aria-label="Como anda na rua (pode escolher mais de um)">
        {PERFIS.map((p) => (
          <button key={p.id} type="button" className="ficha-perfil" aria-pressed={sel.includes(p.id)} onClick={() => alternar(p.id)}>
            <Icone nome={p.icone} />
            <span>{p.titulo}</span>
            {sel.includes(p.id) && <span className="ficha-check" aria-hidden="true"><Icone nome="check" /></span>}
          </button>
        ))}
      </div>
      <h2 id="titulo-pref-rota" className="titulo-secao-2">No caminho, eu quero</h2>
      <div className="fichas-pref" role="group" aria-labelledby="titulo-pref-rota">
        {PREFERENCIAS_ROTA.map((p) => (
          <button key={p.id} type="button" className="ficha-pref" aria-pressed={prefs.includes(p.id)} onClick={() => alternarPref(p.id)}>
            <Icone nome={prefs.includes(p.id) ? 'check' : p.icone} />{p.titulo}
          </button>
        ))}
      </div>
      <div className="empurra" />
      <Botao icone="seta" disabled={!pronto} onClick={() => { aoMudar(sel, prefs, apelido.trim()); aoContinuar(); }}>{rotuloContinuar}</Botao>
      {aoPular && <button type="button" className="link-simples link-pular" onClick={aoPular}>Pular, cadastro meu perfil depois</button>}
    </Tela>
  );
}

function Chave({ ligada, aoMudar, rotulo }) {
  return <button type="button" role="switch" aria-checked={ligada} aria-label={rotulo} className="chave" onClick={() => aoMudar(!ligada)} />;
}

/** Página 3: como prefere receber as instruções. */
export function Preferencias({ prefs, aoMudar, aoVoltar, aoContinuar, passo = 2, total = 4, rotuloContinuar = 'Continuar' }) {
  const fala = 'Como prefere receber as instruções? Falar tudo em voz alta. Voz mais devagar. Vibrar nos avisos. E o tamanho da letra.';
  const item = (chave, icone, titulo, sub) => (
    <div className="preferencia">
      <Icone nome={icone} />
      <div className="preferencia-texto"><strong>{titulo}</strong><span>{sub}</span></div>
      <Chave ligada={prefs[chave]} rotulo={titulo} aoMudar={(v) => {
        if (chave === 'vozAlta' && !v) calar(); // desligou a voz: silêncio na hora, sem anunciar
        aoMudar({ [chave]: v });
        if (chave !== 'vozAlta' || v) falar(`${titulo}: ${v ? 'ligado' : 'desligado'}.`, { forcar: chave === 'vozAlta' });
      }} />
    </div>
  );
  return (
    <Tela fala={fala}>
      <Cabecalho titulo="Seu perfil" aoVoltar={aoVoltar} fala={fala} />
      {passo && <Progresso passo={passo} total={total} />}
      <CaixaFala titulo={<Titulo className="titulo-fala">Como prefere receber as instruções?</Titulo>} />
      <AvisoSemVoz />
      {item('vozAlta', 'som', 'Falar tudo em voz alta', 'Recomendado')}
      {item('vozDevagar', 'repetir', 'Voz mais devagar', 'Para ouvir com calma')}
      {item('vibrar', 'sino', 'Vibrar nos avisos', 'Sente no bolso')}
      <div className="preferencia" style={{ display: 'block' }}>
        <strong id="rotulo-letra" style={{ fontSize: 'calc(1.25rem * var(--escala))' }}>Tamanho da letra</strong>
        <div className="tamanhos" role="radiogroup" aria-labelledby="rotulo-letra">
          {[['pequena', 'Pequena', 18], ['media', 'Média', 26], ['grande', 'Grande', 34]].map(([v, nome, px]) => (
            <button key={v} type="button" role="radio" aria-checked={prefs.letra === v} className="tamanho"
              aria-label={`Letra ${nome}`} onClick={() => aoMudar({ letra: v })} style={{ fontSize: px }}>Aa</button>
          ))}
        </div>
      </div>
      <div className="empurra" />
      <Rodape fixo><Botao icone="seta" onClick={aoContinuar}>{rotuloContinuar}</Botao></Rodape>
    </Tela>
  );
}
