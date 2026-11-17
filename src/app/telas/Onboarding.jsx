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
    <Tela fala={fala}>
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

const PERFIS = [
  { id: 'bengala', icone: 'bengala', titulo: 'Uso bengala ou andador' },
  { id: 'cadeira', icone: 'cadeira', titulo: 'Uso cadeira de rodas' },
  { id: 'baixa_visao', icone: 'olho', titulo: 'Enxergo pouco' },
  { id: 'sem_apoio', icone: 'caminho', titulo: 'Ando sem apoio' },
];

/** Página 2: como você anda na rua (vários). */
export function Perfil({ perfis, aoMudar, aoVoltar, aoContinuar, passo = 1 }) {
  const [sel, setSel] = useState(perfis.length ? perfis : []);
  const fala = 'Como você anda na rua? Pode escolher mais de um. ' + PERFIS.map((p) => p.titulo).join('. ') + '.';
  const alternar = (id) => {
    let novo = sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id];
    if (id === 'sem_apoio' && novo.includes('sem_apoio')) novo = ['sem_apoio'];
    else novo = novo.filter((x) => x !== 'sem_apoio' || id === 'sem_apoio');
    setSel(novo);
    const p = PERFIS.find((x) => x.id === id);
    falar(`${p.titulo}: ${novo.includes(id) ? 'escolhido' : 'tirado'}.`);
  };
  return (
    <Tela fala={fala}>
      <Cabecalho titulo="Seu perfil" aoVoltar={aoVoltar} fala={fala} />
      <Progresso passo={passo} />
      <CaixaFala titulo={<Titulo className="titulo-fala">Como você anda na rua?</Titulo>}>Pode escolher mais de um.</CaixaFala>
      <div className="opcoes" role="group" aria-label="Como você anda na rua">
        {PERFIS.map((p) => (
          <button key={p.id} type="button" className="opcao" aria-pressed={sel.includes(p.id)} onClick={() => alternar(p.id)}>
            <Icone nome={p.icone} />
            <span>{p.titulo}</span>
            {sel.includes(p.id) && <span className="opcao-check"><Icone nome="check" /></span>}
          </button>
        ))}
      </div>
      <div className="empurra" />
      <Botao icone="seta" disabled={!sel.length} onClick={() => { aoMudar(sel); aoContinuar(); }}>Continuar</Botao>
    </Tela>
  );
}

function Chave({ ligada, aoMudar, rotulo }) {
  return <button type="button" role="switch" aria-checked={ligada} aria-label={rotulo} className="chave" onClick={() => aoMudar(!ligada)} />;
}

/** Página 3: como prefere receber as instruções. */
export function Preferencias({ prefs, aoMudar, aoVoltar, aoContinuar, passo = 2, rotuloContinuar = 'Continuar' }) {
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
      {passo && <Progresso passo={passo} />}
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
      <Botao icone="seta" onClick={aoContinuar}>{rotuloContinuar}</Botao>
    </Tela>
  );
}
