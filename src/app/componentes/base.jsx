import { createContext, useContext, useEffect, useRef } from 'react';
import { Icone, Marca } from './Icone.jsx';
import { calar, falar } from '../servicos/voz.js';

/** Som ligado/desligado (preferência vozAlta), compartilhado por todas as telas. */
export const VozContexto = createContext({ ativa: true, alternar: () => {}, semVozPt: false });

/**
 * Tela: ao abrir, leva o foco ao título (leitor de tela começa por ele)
 * e fala o texto principal (`fala`), se a voz estiver ligada.
 */
export function Tela({ children, fala, className = '', rotulo }) {
  const ref = useRef(null);
  useEffect(() => {
    window.scrollTo({ top: 0 });
    document.querySelector('.app')?.scrollTo({ top: 0 }); // moldura de celular no computador
    const h = ref.current?.querySelector('h1');
    h?.focus({ preventScroll: true });
    if (fala) falar(fala);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <main ref={ref} className={`tela ${className}`.trim()} aria-label={rotulo}>
      {children}
    </main>
  );
}

export function Titulo({ children, className = '' }) {
  return <h1 tabIndex={-1} className={className}>{children}</h1>;
}

/**
 * Interruptor de som (o alto-falante do guia visual). Ligado: toque desliga
 * e cala na hora. Desligado: toque liga e lê a tela atual. A vibração e o
 * texto na tela continuam funcionando com o som desligado.
 */
export function BotaoSom({ fala, claro = false }) {
  const { ativa, alternar } = useContext(VozContexto);
  const aoTocar = () => {
    if (ativa) {
      calar();
      alternar(false);
    } else {
      alternar(true);
      falar(`Som ligado. ${fala ?? ''}`, { forcar: true });
    }
  };
  return (
    <button type="button" className={`botao-icone botao-som ${claro ? 'claro' : ''} ${ativa ? '' : 'mudo'}`} onClick={aoTocar}
      aria-pressed={ativa} aria-label={ativa ? 'Som ligado. Toque para desligar' : 'Som desligado. Toque para ligar e ouvir esta tela'}>
      <Icone nome={ativa ? 'som' : 'somMudo'} />
    </button>
  );
}

/** Aviso quando o aparelho não tem voz em português (melhor calar do que falar em inglês). */
export function AvisoSemVoz() {
  const { semVozPt } = useContext(VozContexto);
  if (!semVozPt) return null;
  return (
    <div className="aviso aviso-info" role="status">
      <Icone nome="somMudo" />
      <div>Este aparelho não tem voz em português instalada, então o app não vai falar. Para ouvir, instale a voz
        "Português (Brasil)" nas configurações do celular (Acessibilidade &gt; Conversão de texto em voz). Tudo continua escrito na tela.</div>
    </div>
  );
}

/** Cabeçalho com Voltar, título curto e alto-falante (padrão do guia). */
export function Cabecalho({ titulo, aoVoltar, fala, marca = false, extra }) {
  return (
    <header className="cabecalho">
      {aoVoltar ? (
        <button type="button" className="botao-icone" onClick={aoVoltar} aria-label="Voltar">
          <Icone nome="voltar" />
        </button>
      ) : marca ? <Marca /> : <span className="espaco-icone" />}
      {titulo ? <p className="cabecalho-titulo">{titulo}</p> : <span />}
      <div className="cabecalho-dir">
        {extra}
        {fala !== undefined && <BotaoSom fala={fala} />}
      </div>
    </header>
  );
}

export function Progresso({ passo, total = 3 }) {
  return (
    <div className="progresso" role="progressbar" aria-valuemin={1} aria-valuemax={total} aria-valuenow={passo}
      aria-label={`Passo ${passo} de ${total}`}>
      {Array.from({ length: total }, (_, i) => <span key={i} className={i < passo ? 'feito' : ''} />)}
    </div>
  );
}

/** Caixa bege com alto-falante: o que o app está dizendo. */
export function CaixaFala({ titulo, children, escura = false, id }) {
  return (
    <section className={`caixa-fala ${escura ? 'escura' : ''}`} aria-live="polite" id={id}>
      <Icone nome="som" className="caixa-fala-icone" />
      <div>
        <div className="caixa-fala-titulo">{titulo}</div>
        {children && <div className="caixa-fala-texto">{children}</div>}
      </div>
    </section>
  );
}

export function Botao({ children, icone, variante = 'primario', className = '', ...props }) {
  return (
    <button type="button" className={`botao ${variante} ${className}`.trim()} {...props}>
      {icone && <Icone nome={icone} />}
      <span>{children}</span>
    </button>
  );
}

export function Rodape({ children }) {
  return <div className="rodape-acoes">{children}</div>;
}

export function Carregando({ texto = 'Carregando…' }) {
  return (
    <div className="carregando" role="status">
      <span className="carregando-pontos" aria-hidden="true"><i /><i /><i /></span>
      <span>{texto}</span>
    </div>
  );
}

export function Aviso({ children, tipo = 'info', icone = 'alerta' }) {
  return (
    <div className={`aviso aviso-${tipo}`} role={tipo === 'erro' ? 'alert' : 'status'}>
      <Icone nome={icone} />
      <div>{children}</div>
    </div>
  );
}
