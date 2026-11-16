import { useEffect, useState } from 'react';
import { Aviso, Botao, Cabecalho, CaixaFala, Carregando, Rodape, Tela, Titulo } from '../componentes/base.jsx';
import { Icone } from '../componentes/Icone.jsx';
import { BarraNav } from '../componentes/BarraNav.jsx';
import { api } from '../servicos/api.js';
import { escutaDisponivel, escutar, falar } from '../servicos/voz.js';
import { NOMES_PERFIL } from '../servicos/preferencias.js';
import { ICONE_RELATO } from './Rota.jsx';

const NOME_RELATO = { buraco: 'Buraco', calcada_irregular: 'Calçada irregular', obstaculo: 'Obstáculo', sem_rampa: 'Sem rampa',
  alagamento: 'Alagamento', luz_apagada: 'Luz apagada', obra: 'Obra', outro: 'Outro problema' };
const STATUS = {
  em_verificacao: ['Em verificação', 'olho'], confirmado: ['Confirmado', 'ok'], encaminhado: ['Encaminhado', 'caminho'],
  resolvido: ['Resolvido', 'ok'], descartado: ['Descartado', 'fechar'],
};

function quando(iso) {
  const d = new Date(iso);
  const dias = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (dias <= 0) return 'hoje';
  if (dias === 1) return 'ontem';
  return d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' }).replace('.', '');
}

/** Página 16. */
export function MeusAvisos({ aoVoltar, aoMenu }) {
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState(null);
  useEffect(() => { api.meus().then(setDados).catch((e) => setErro(e.message)); }, []);
  const fala = dados ? `Você fez ${dados.total} ${dados.total === 1 ? 'aviso' : 'avisos'}. ${dados.consertados} já ${dados.consertados === 1 ? 'foi consertado' : 'foram consertados'}.` : 'Meus avisos.';
  return (
    <Tela fala={dados ? fala : undefined}>
      <Cabecalho titulo="Meus avisos" aoVoltar={aoVoltar} fala={fala} />
      <Titulo className="so-leitor">Meus avisos</Titulo>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {!dados && !erro && <Carregando />}
      {dados && (
        <>
          <div className="placar">
            <div className="amarelo"><strong>{dados.total}</strong>{dados.total === 1 ? 'aviso seu' : 'avisos seus'}</div>
            <div className="verde"><strong>{dados.consertados}</strong>já consertados</div>
          </div>
          {dados.total === 0 && <p className="sub">Você ainda não avisou nenhum problema. Quando avisar, ele aparece aqui.</p>}
          <ul className="lista-simples" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {dados.relatos.map((r) => {
              const [rotulo, icone] = STATUS[r.status] ?? [r.status, 'olho'];
              return (
                <li key={r.id} className="item-aviso">
                  <span className="item-aviso-icone"><Icone nome={ICONE_RELATO[r.categoria] ?? 'outro'} /></span>
                  <div>
                    <strong>{NOME_RELATO[r.categoria] ?? r.categoria}</strong>
                    <p>{r.rua || 'Local marcado no mapa'} · {quando(r.criado_em)}</p>
                    <span className={`chip chip-${r.status}`}><Icone nome={icone} />{rotulo}</span>
                    {r.protocolo && <p className="nota" style={{ margin: '8px 0 0' }}>Protocolo da prefeitura: {r.protocolo}</p>}
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
      <div className="empurra" />
      {aoMenu && <BarraNav atual="meus" aoIr={aoMenu} />}
    </Tela>
  );
}

/** Página 17. */
export function Novidade({ relato, aoVerMapa, aoFechar }) {
  const dias = relato.resolvido_em ? Math.max(1, Math.round((new Date(relato.resolvido_em) - new Date(relato.criado_em)) / 86400000)) : null;
  const oQue = (NOME_RELATO[relato.categoria] ?? 'O problema').toLowerCase();
  const titulo = `O ${oQue} que você mostrou foi consertado.`;
  const fala = `${titulo} Obrigado por ajudar. Esse trecho voltou para as rotas de todo mundo.`;
  return (
    <Tela fala={fala}>
      <Cabecalho titulo="Novidade" aoVoltar={aoFechar} fala={fala} />
      <section className="cartao-novidade">
        <span className="selo"><Icone nome="ok" /></span>
        <Titulo>{titulo}</Titulo>
        <p>{relato.rua || 'Local do seu aviso'}{dias ? ` · consertado em ${dias} ${dias === 1 ? 'dia' : 'dias'}` : ''}</p>
        <span className="chip chip-resolvido"><Icone nome="ok" />Resolvido</span>
      </section>
      <CaixaFala titulo="Obrigado por ajudar. Esse trecho voltou para as rotas de todo mundo." />
      <div className="empurra" />
      <Rodape>
        <Botao icone="mapa" onClick={aoVerMapa}>Ver no mapa</Botao>
        <Botao icone="fechar" variante="secundario" onClick={aoFechar}>Fechar</Botao>
      </Rodape>
    </Tela>
  );
}

/** Página 18. */
export function Ajustes({ prefs, aoMudar, aoVoltar, ir, aoMenu }) {
  const fala = 'Ajustes. Cores da tela, perfil, voz, tamanho da letra, acompanhante e meus avisos.';
  const [acomp, setAcomp] = useState(prefs.acompanhante);
  const [editando, setEditando] = useState(false);
  const item = (icone, titulo, sub, acao) => (
    <button type="button" className="item-ajuste" onClick={acao}>
      <Icone nome={icone} /><div><strong>{titulo}</strong><span>{sub}</span></div><Icone nome="seta" />
    </button>
  );
  return (
    <Tela fala={fala}>
      <Cabecalho titulo="Ajustes" aoVoltar={aoVoltar} fala={fala} />
      <Titulo className="so-leitor">Ajustes</Titulo>
      <h2 id="rotulo-cores">Cores da tela</h2>
      <div className="temas" role="radiogroup" aria-labelledby="rotulo-cores">
        {[['claro', 'Claro'], ['escuro', 'Escuro'], ['contraste', 'Contraste']].map(([id, nome]) => (
          <button key={id} type="button" role="radio" aria-checked={prefs.tema === id} className={`tema tema-${id}`}
            onClick={() => { aoMudar({ tema: id }); falar(`Cores: ${nome}.`); }}><b aria-hidden="true">Aa</b>{nome}</button>
        ))}
      </div>
      {item('bengala', 'Meu perfil', [prefs.perfis.map((p) => NOMES_PERFIL[p]).join(', '), prefs.vozDevagar && 'voz devagar'].filter(Boolean).join(' · '), () => ir('perfil'))}
      {item('som', 'Voz e letra', `${prefs.vozAlta ? 'Falar tudo' : 'Mudo'} · voz ${prefs.vozDevagar ? 'lenta' : 'normal'} · letra ${{ pequena: 'pequena', media: 'média', grande: 'grande' }[prefs.letra]}`, () => ir('preferencias'))}
      {editando ? (
        <form className="cartao" style={{ padding: 18 }} onSubmit={(e) => { e.preventDefault(); aoMudar({ acompanhante: acomp.trim().slice(0, 40) }); setEditando(false); }}>
          <div className="campo">
            <label htmlFor="acomp"><strong>Quem avisar ao chegar?</strong></label>
            <input id="acomp" value={acomp} onChange={(e) => setAcomp(e.target.value)} placeholder="Ex.: minha filha" />
            <span className="nota">Fica só no seu celular. Ao chegar, o app abre uma mensagem pronta para você enviar.</span>
          </div>
          <Botao className="" type="submit" style={{ marginTop: 12 }}>Salvar</Botao>
        </form>
      ) : item('pessoa', 'Acompanhante', prefs.acompanhante ? `Avisar ${prefs.acompanhante} ao chegar` : 'Ninguém para avisar', () => setEditando(true))}
      {!editando && item('ajuda', 'Ajuda', 'Pergunte como o app funciona', () => ir('ajuda'))}
      {!editando && item('olho', 'Privacidade', 'O que fica no seu celular', () => ir('privacidade'))}
      <div className="empurra" />
      {aoMenu && <BarraNav atual="ajustes" aoIr={aoMenu} />}
    </Tela>
  );
}

/** Ajuda por voz ou texto: assistente de IA ancorado na base de conhecimento. */
export function Ajuda({ aoVoltar }) {
  const [pergunta, setPergunta] = useState('');
  const [resp, setResp] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const perguntar = async (q) => {
    if (!q.trim()) return;
    setCarregando(true);
    try {
      const r = await api.ajuda(q);
      setResp(r);
      falar(r.resposta, { forcar: true });
    } catch (e) {
      setResp({ resposta: e.message });
    } finally {
      setCarregando(false);
    }
  };
  const ouvir = () => {
    const e = escutar(setPergunta);
    e.pronto.then((t) => { setPergunta(t); perguntar(t); }).catch(() => {});
  };
  const sugestoes = ['Por que o caminho ficou mais longo?', 'O que acontece depois que eu aviso um buraco?', 'Meus dados ficam guardados?'];
  return (
    <Tela fala="Ajuda. Faça uma pergunta sobre o app.">
      <Cabecalho titulo="Ajuda" aoVoltar={aoVoltar} fala="Faça uma pergunta sobre o app." />
      <Titulo>Como posso ajudar?</Titulo>
      <form className="digitar" onSubmit={(e) => { e.preventDefault(); perguntar(pergunta); }}>
        <label htmlFor="pergunta" className="so-leitor">Sua pergunta</label>
        <input id="pergunta" value={pergunta} onChange={(e) => setPergunta(e.target.value)} placeholder="Escreva sua pergunta" maxLength={400} />
        {escutaDisponivel() && <button type="button" className="botao-icone" onClick={ouvir} aria-label="Perguntar falando"><Icone nome="mic" /></button>}
      </form>
      <div className="lista-simples">
        {sugestoes.map((s) => <button key={s} type="button" className="item-ajuste" onClick={() => { setPergunta(s); perguntar(s); }}><Icone nome="ajuda" /><div><strong style={{ fontSize: 'inherit' }}>{s}</strong></div></button>)}
      </div>
      {carregando && <Carregando texto="Pensando…" />}
      {resp && <CaixaFala titulo={resp.resposta}>{resp.fonte && resp.fonte !== 'regras' ? 'Resposta gerada por IA a partir do manual do app.' : 'Resposta do manual do app.'}</CaixaFala>}
      <div className="empurra" />
      <a className="botao secundario" href="tel:192"><Icone nome="alerta" /><span>Emergência: ligar 192</span></a>
    </Tela>
  );
}

/** Transparência LGPD em linguagem simples. */
export function Privacidade({ aoVoltar, aoApagar }) {
  const texto = 'Seu perfil e seus ajustes ficam só neste celular. Quando você avisa um problema, enviamos o local, o tipo e a foto com rostos e placas borrados. Não pedimos nome, telefone nem e-mail. Sua posição é usada para calcular a rota e, se você sair do caminho, recalcular. O servidor não guarda o seu trajeto.';
  return (
    <Tela fala={texto}>
      <Cabecalho titulo="Privacidade" aoVoltar={aoVoltar} fala={texto} />
      <Titulo className="so-leitor">O que acontece com seus dados</Titulo>
      <CaixaFala titulo="Fica só no seu celular">Seu perfil, os ajustes de voz e letra e o nome do acompanhante.</CaixaFala>
      <CaixaFala titulo="Vai quando você avisa">Local, tipo do problema e a foto com rostos e placas borrados. Sem nome, telefone ou e-mail.</CaixaFala>
      <CaixaFala titulo="Sua posição">Serve para calcular a rota. O servidor não guarda o seu trajeto.</CaixaFala>
      <div className="empurra" />
      <Botao variante="secundario" icone="fechar" onClick={aoApagar}>Apagar meus dados deste celular</Botao>
    </Tela>
  );
}
