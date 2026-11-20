/**
 * Destino longe para ir a pé: o app explica a distância e o tempo, pergunta se
 * a pessoa quer mesmo ir a pé e oferece alternativas: ônibus (com o caminho
 * acessível até o ponto), carro, ou carro por aplicativo (o app que a pessoa
 * cadastrou: Uber, 99, inDrive).
 */
import { useEffect, useState } from 'react';
import { Aviso, Botao, CaixaFala, Cabecalho, Tela, Titulo } from '../componentes/base.jsx';
import { Icone } from '../componentes/Icone.jsx';
import { api } from '../servicos/api.js';
import { falar } from '../servicos/voz.js';
import {
  APPS_CORRIDA, MAXIMO_A_PE_M, appCorrida, avaliarDistancia, enderecoParaColar, formatarKm, formatarTempo, links,
} from '../servicos/transporte.js';

function LinkExterno({ href, icone, children, variante = 'secundario', onClick }) {
  return (
    <a className={`botao ${variante}`} href={href} target="_blank" rel="noopener noreferrer" onClick={onClick}>
      {icone && <Icone nome={icone} />}
      <span>{children}</span>
    </a>
  );
}

async function copiar(texto) {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    return false;
  }
}

export function DestinoLonge({ destino, origem, prefs, aoAPe, aoPontoOnibus, aoEscolherApp, aoVoltar }) {
  const a = avaliarDistancia(origem, destino, prefs.perfis, prefs.vozDevagar);
  const app = appCorrida(prefs.appCorrida);
  const [ponto, setPonto] = useState(undefined); // undefined = procurando; null = nenhum perto
  const [aviso, setAviso] = useState(null);

  useEffect(() => {
    let vivo = true;
    api.lugares('', origem, 'ponto_onibus')
      .then((r) => vivo && setPonto(r.lugares.find((l) => l.distancia_m == null || l.distancia_m <= 1500) ?? null))
      .catch(() => vivo && setPonto(null));
    return () => { vivo = false; };
  }, [origem]);

  const resumo = `${destino.nome} fica a ${formatarKm(a.caminho)}. A pé, levaria uns ${formatarTempo(a.minutos)}.`;
  const pergunta = a.aPePossivel
    ? 'Quer mesmo ir a pé? Se não, você pode ir de ônibus, de carro ou chamar um carro por aplicativo.'
    : 'É longe demais para ir a pé. Você pode ir de ônibus, de carro ou chamar um carro por aplicativo.';

  const pedirCarro = async () => {
    if (app.comDestino) return; // o link já leva o destino
    const ok = await copiar(enderecoParaColar(destino));
    const msg = ok ? `Copiei o endereço. No ${app.nome}, toque em "Para onde?" e cole.`
      : `No ${app.nome}, digite o destino: ${enderecoParaColar(destino)}.`;
    setAviso(msg);
    falar(msg);
  };

  return (
    <Tela fala={`${resumo} ${pergunta}`}>
      <Cabecalho titulo="Destino longe" aoVoltar={aoVoltar} fala={`${resumo} ${pergunta}`} />
      <CaixaFala titulo={<Titulo>{a.aPePossivel ? 'É longe para ir a pé' : 'Longe demais para ir a pé'}</Titulo>}>
        {resumo} {pergunta}
      </CaixaFala>

      <section className="secao-transporte" aria-labelledby="t-onibus">
        <h2 id="t-onibus"><Icone nome="onibus" /> De ônibus</h2>
        {ponto === undefined && <p className="nota">Procurando o ponto de ônibus mais perto…</p>}
        {ponto && (
          <Botao icone="caminho" onClick={() => aoPontoOnibus(ponto)}>
            Caminho acessível até o ponto
          </Botao>
        )}
        {ponto && <p className="nota">{ponto.nome || 'Ponto de ônibus'}{ponto.distancia_m != null ? `, a ${formatarKm(ponto.distancia_m)}` : ''}. Depois, veja a linha:</p>}
        <LinkExterno href={links.onibusGoogle(origem, destino)} icone="onibus">Ver linhas no Google Maps</LinkExterno>
        <a className="link-simples" href={links.onibusMoovit(origem, destino)} target="_blank" rel="noopener noreferrer">Ver no Moovit</a>
      </section>

      <section className="secao-transporte" aria-labelledby="t-app">
        <h2 id="t-app"><Icone nome="carro" /> Carro por aplicativo</h2>
        {app ? (
          <>
            <LinkExterno href={app.link(origem, destino)} icone="carro" variante="primario" onClick={pedirCarro}>
              Pedir carro no {app.nome}
            </LinkExterno>
            {!app.comDestino && <p className="nota">O {app.nome} abre e o endereço fica copiado para você colar.</p>}
            <button type="button" className="link-simples" onClick={aoEscolherApp}>Trocar de aplicativo</button>
          </>
        ) : (
          <Botao icone="carro" onClick={aoEscolherApp}>Escolher meu app de corrida</Botao>
        )}
        {aviso && <Aviso icone="ok">{aviso}</Aviso>}
      </section>

      <section className="secao-transporte" aria-labelledby="t-carro">
        <h2 id="t-carro"><Icone nome="carro" /> De carro</h2>
        <LinkExterno href={links.carroGoogle(origem, destino)} icone="mapa">Rota de carro no Google Maps</LinkExterno>
        <a className="link-simples" href={links.carroWaze(origem, destino)} target="_blank" rel="noopener noreferrer">Abrir no Waze</a>
      </section>

      <div className="empurra" />
      {a.aPePossivel
        ? <Botao icone="caminho" variante="secundario" onClick={aoAPe}>Quero ir a pé mesmo</Botao>
        : <p className="nota">A pé, o app calcula rotas de até {MAXIMO_A_PE_M / 1000} km.</p>}
    </Tela>
  );
}

/** Cadastrar o app de corrida preferido (fica só no aparelho, em Ajustes). */
export function EscolherAppCorrida({ atual, aoSalvar, aoVoltar }) {
  const [escolha, setEscolha] = useState(atual ?? null);
  const fala = 'Qual aplicativo de corrida você usa? Ele abre quando o destino for longe.';
  const opcoes = [...APPS_CORRIDA, { id: null, nome: 'Nenhum', sub: 'Não quero pedir carro por aplicativo' }];
  return (
    <Tela fala={fala} fixa>
      <Cabecalho titulo="App de corrida" aoVoltar={aoVoltar} fala={fala} />
      <CaixaFala titulo={<Titulo className="titulo-fala">Qual app de corrida você usa?</Titulo>}>
        Fica só no seu celular. Dá para trocar depois em Ajustes.
      </CaixaFala>
      <div className="opcoes" role="radiogroup" aria-label="App de corrida">
        {opcoes.map((o) => (
          <button key={o.id ?? 'nenhum'} type="button" role="radio" aria-checked={escolha === o.id} className="opcao opcao-modo"
            onClick={() => { setEscolha(o.id); falar(o.nome); }}>
            <Icone nome={o.id ? 'carro' : 'fechar'} />
            <span><strong>{o.nome}</strong><small>{o.sub ?? (o.comDestino ? 'Abre já com o destino' : 'Abre o app e copia o endereço')}</small></span>
            {escolha === o.id && <span className="opcao-check"><Icone nome="check" /></span>}
          </button>
        ))}
      </div>
      <div className="empurra" />
      <Botao icone="ok" onClick={() => aoSalvar(escolha)}>Salvar</Botao>
    </Tela>
  );
}
