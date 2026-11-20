import { useCallback, useEffect, useMemo, useState } from 'react';
import { BarrasHorizontais, LinhasTempo } from './graficos.jsx';
import { COR_STATUS, MapaAdm, RAMPA } from './MapaAdm.jsx';
import { Marca } from '../app/componentes/Icone.jsx';
import './adm.css';

/**
 * Painel Administrativo (ADM) para a gestão pública (pitch, seção 3):
 * distribuição das ocorrências, dashboards, registros, regiões com mais problemas,
 * filtro por região e exportação das fotos organizadas por área.
 *
 * Acesso: token de administração (CL_ADMIN_TOKEN). MOCK: em ambiente local sem token
 * configurado, a API aceita "adm-demo". Produção: login da prefeitura (SSO).
 */
const CHAVE_TOKEN = 'caminhoLivre.adm.token';
const PERIODOS = [['', 'Todo o período'], ['7', 'Últimos 7 dias'], ['30', 'Últimos 30 dias'], ['90', 'Últimos 90 dias']];
const NOME_PERFIL = { cadeira: 'Cadeira de rodas', bengala: 'Bengala/andador', muletas: 'Muletas', baixa_visao: 'Baixa visão',
  sem_apoio: 'Sem apoio' };
const nomePerfil = (p) => p.split('+').map((x) => NOME_PERFIL[x] ?? x).join(' + ');

function lerToken() {
  try { return sessionStorage.getItem(CHAVE_TOKEN) ?? ''; } catch { return ''; }
}
function gravarToken(t) {
  try { if (t) sessionStorage.setItem(CHAVE_TOKEN, t); else sessionStorage.removeItem(CHAVE_TOKEN); } catch { /* só memória */ }
}

async function chamarAdm(token, caminho, { metodo = 'GET', corpo, binario = false } = {}) {
  const r = await fetch(`/api${caminho}`, {
    method: metodo,
    headers: { Authorization: `Bearer ${token}`, ...(corpo ? { 'Content-Type': 'application/json' } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  if (r.status === 401) throw Object.assign(new Error('Token inválido.'), { status: 401 });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail ?? 'Erro na API.');
  return binario ? r : r.json();
}

const fmtData = (iso) => (iso ? new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—');
const fmtNum = (v, suf = '') => (v == null ? '—' : `${String(v).replace('.', ',')}${suf}`);

export function Painel() {
  const [token, setToken] = useState(lerToken);
  const [sessao, setSessao] = useState(null);
  const [erroLogin, setErroLogin] = useState(null);
  const sair = useCallback(() => { gravarToken(''); setToken(''); setSessao(null); }, []);

  useEffect(() => {
    document.title = 'Caminho Livre · Painel ADM';
    if (!token) return;
    chamarAdm(token, '/adm/sessao').then(setSessao).catch((e) => {
      setErroLogin(e.status === 401 ? 'Token inválido.' : e.message);
      setToken('');
      gravarToken('');
    });
  }, [token]);

  if (!token || !sessao) {
    return <Login erro={erroLogin} carregando={Boolean(token)} aoEntrar={(t) => { setErroLogin(null); gravarToken(t); setToken(t); }} />;
  }
  return <Conteudo token={token} sessao={sessao} aoSair={sair} />;
}

function Login({ aoEntrar, erro, carregando }) {
  const [t, setT] = useState('');
  return (
    <div className="adm adm-login">
      <form className="adm-cartao login-cartao" onSubmit={(e) => { e.preventDefault(); if (t.trim()) aoEntrar(t.trim()); }}>
        <div className="marca"><Marca tamanho={40} /> <span>Caminho Livre</span></div>
        <h1>Painel Administrativo</h1>
        <p className="sec">Acompanhamento das condições de acessibilidade urbana para a gestão pública.</p>
        <label htmlFor="token">Token de acesso</label>
        <input id="token" type="password" value={t} onChange={(e) => setT(e.target.value)} autoComplete="current-password" autoFocus />
        {erro && <p className="erro" role="alert">{erro}</p>}
        <button type="submit" className="btn primario" disabled={carregando}>{carregando ? 'Entrando…' : 'Entrar'}</button>
        <p className="nota">Demonstração local (sem CL_ADMIN_TOKEN configurado): use <code>adm-demo</code>. No Render, o token
          fica nas variáveis de ambiente do serviço.</p>
      </form>
    </div>
  );
}

function Conteudo({ token, sessao, aoSair }) {
  const [aba, setAba] = useState('geral');
  const [filtros, setFiltros] = useState({ regiao: '', categoria: '', status: '', dias: '' });
  const [resumo, setResumo] = useState(null);
  const [relatos, setRelatos] = useState([]);
  const [erro, setErro] = useState(null);
  const [selecionado, setSelecionado] = useState(null);
  const [exportando, setExportando] = useState(false);
  const qs = useMemo(() => {
    const p = new URLSearchParams();
    Object.entries(filtros).forEach(([k, v]) => v && p.set(k, v));
    return p.toString() ? `?${p}` : '';
  }, [filtros]);

  const carregar = useCallback(async () => {
    try {
      const [r, l] = await Promise.all([chamarAdm(token, `/adm/resumo${qs}`), chamarAdm(token, `/adm/relatos${qs}`)]);
      setResumo(r);
      setRelatos(l.relatos);
      setErro(null);
    } catch (e) {
      if (e.status === 401) aoSair(); else setErro(e.message);
    }
  }, [token, qs, aoSair]);
  useEffect(() => { carregar(); }, [carregar]);

  const mudarStatus = async (r, status) => {
    let protocolo;
    if (status === 'encaminhado') {
      protocolo = window.prompt('Número do protocolo na prefeitura (opcional):', r.protocolo ?? '') ?? undefined;
    }
    try {
      const novo = await chamarAdm(token, `/adm/relatos/${encodeURIComponent(r.id)}/status`, { metodo: 'POST', corpo: { status, protocolo: protocolo || null } });
      setRelatos((lista) => lista.map((x) => (x.id === r.id ? novo : x)));
      if (selecionado?.id === r.id) setSelecionado(novo);
      carregar();
    } catch (e) {
      setErro(e.message);
    }
  };

  const exportar = async () => {
    setExportando(true);
    try {
      const r = await chamarAdm(token, `/adm/exportar${qs}`, { binario: true });
      const blob = await r.blob();
      const nome = /filename="([^"]+)"/.exec(r.headers.get('Content-Disposition') ?? '')?.[1] ?? 'caminho-livre-registros.zip';
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: nome });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } catch (e) {
      setErro(e.message);
    } finally {
      setExportando(false);
    }
  };

  const filtro = (chave, rotulo, opcoes) => (
    <label className="filtro">
      <span>{rotulo}</span>
      <select value={filtros[chave]} onChange={(e) => setFiltros((f) => ({ ...f, [chave]: e.target.value }))}>
        {opcoes.map(([v, n]) => <option key={v} value={v}>{n}</option>)}
      </select>
    </label>
  );

  return (
    <div className="adm">
      <header className="adm-topo">
        <div className="marca"><Marca tamanho={36} /><div><strong>Caminho Livre · Painel ADM</strong><span>{sessao.territorio.nome}</span></div></div>
        <nav className="abas" aria-label="Seções do painel">
          {[['geral', 'Visão geral'], ['ocorrencias', 'Ocorrências'], ['moderacao', 'Moderação'], ['instituicoes', 'Instituições']].map(([id, nome]) => (
            <button key={id} type="button" aria-current={aba === id ? 'page' : undefined} onClick={() => setAba(id)}>
              {nome}{id === 'moderacao' && resumo?.fila_moderacao ? <span className="contador">{resumo.fila_moderacao}</span> : null}
            </button>
          ))}
        </nav>
        <div className="topo-acoes">
          <button type="button" className="btn" onClick={exportar} disabled={exportando}>{exportando ? 'Gerando ZIP…' : 'Exportar fotos por região'}</button>
          <button type="button" className="btn fantasma" onClick={aoSair}>Sair</button>
        </div>
      </header>

      {(aba === 'geral' || aba === 'ocorrencias') && (
        <div className="filtros" role="group" aria-label="Filtros">
          {filtro('regiao', 'Região', [['', 'Todas as regiões'], ...sessao.regioes.map((r) => [r.nome, r.nome]), ['Fora do piloto', 'Fora do piloto']])}
          {filtro('categoria', 'Categoria', [['', 'Todas'], ...Object.entries(sessao.categorias).filter(([k]) => k !== 'entrada')])}
          {filtro('status', 'Status', [['', 'Todos'], ...Object.entries(sessao.status)])}
          {filtro('dias', 'Período', PERIODOS)}
          {Object.values(filtros).some(Boolean) && (
            <button type="button" className="btn fantasma" onClick={() => setFiltros({ regiao: '', categoria: '', status: '', dias: '' })}>Limpar filtros</button>
          )}
          <span className="sec filtros-info">A exportação usa os mesmos filtros.</span>
        </div>
      )}
      {erro && <p className="erro faixa" role="alert">{erro}</p>}
      {resumo?.simulados > 0 && (aba === 'geral' || aba === 'ocorrencias') && (
        <p className="faixa aviso-simulado">{resumo.simulados} de {resumo.total} registros nesta seleção são <strong>dados simulados</strong> de
          demonstração (origem <code>simulado_demo</code>); as fotos deles são ilustrativas, de domínio público.</p>
      )}

      <main className="adm-corpo">
        {aba === 'geral' && resumo && (
          <VisaoGeral resumo={resumo} relatos={relatos} sessao={sessao} filtros={filtros}
            aoRegiao={(r) => setFiltros((f) => ({ ...f, regiao: f.regiao === r ? '' : r }))} aoSelecionar={setSelecionado} />
        )}
        {aba === 'ocorrencias' && <Ocorrencias relatos={relatos} sessao={sessao} aoMudar={mudarStatus} aoSelecionar={setSelecionado} />}
        {aba === 'moderacao' && <Moderacao token={token} sessao={sessao} aoMudou={carregar} />}
        {aba === 'instituicoes' && <Instituicoes />}
      </main>
      {selecionado && <Detalhe relato={selecionado} sessao={sessao} aoFechar={() => setSelecionado(null)} aoMudar={mudarStatus} />}
    </div>
  );
}

function Kpi({ valor, rotulo, sub }) {
  return (
    <div className="kpi">
      <strong>{valor}</strong>
      <span>{rotulo}</span>
      {sub && <small>{sub}</small>}
    </div>
  );
}

function VisaoGeral({ resumo, relatos, sessao, filtros, aoRegiao, aoSelecionar }) {
  const st = resumo.por_status;
  const confirmadas = (st.confirmado ?? 0) + (st.encaminhado ?? 0) + (st.resolvido ?? 0);
  const cats = Object.entries(resumo.por_categoria).map(([k, v]) => ({ nome: sessao.categorias[k] ?? k, valor: v }));
  const imp = resumo.impacto;
  const rotasPerfil = (imp.rotas_adaptadas_por_perfil ?? []).map((r) => ({
    nome: nomePerfil(r.perfil), valor: r.n, extra: `${r.com_desvio ?? 0} com desvio de barreira`,
  }));
  const totalRotas = rotasPerfil.reduce((a, b) => a + b.valor, 0);
  const visiveis = relatos.filter((r) => r.categoria !== 'entrada');
  return (
    <>
      <section className="kpis" aria-label="Indicadores">
        <Kpi valor={resumo.total} rotulo="Ocorrências" sub={filtros.regiao || 'todas as regiões'} />
        <Kpi valor={resumo.ativos} rotulo="Ativas no mapa" sub="em verificação, confirmadas ou encaminhadas" />
        <Kpi valor={confirmadas} rotulo="Confirmadas pela comunidade" sub="3 pessoas ou equipe" />
        <Kpi valor={st.resolvido ?? 0} rotulo="Resolvidas" />
        <Kpi valor={fmtNum(resumo.dias_medios_resposta, ' dias')} rotulo="Tempo médio de resposta" sub="da confirmação ao conserto" />
        <Kpi valor={fmtNum(resumo.horas_medias_confirmacao, ' h')} rotulo="Tempo até confirmar" sub="do aviso à confirmação" />
      </section>

      <div className="grade-2">
        <section className="adm-cartao">
          <div className="cartao-topo">
            <h2>Distribuição das ocorrências</h2>
            <p className="sec">Setores mais escuros concentram mais problemas ativos. Clique numa ocorrência para ver a foto.</p>
          </div>
          <MapaAdm relatos={visiveis} regioes={sessao.regioes} porRegiao={resumo.por_regiao} regiaoSel={filtros.regiao}
            nomesStatus={sessao.status} nomesCategoria={sessao.categorias} aoSelecionar={aoSelecionar} />
          <div className="legenda legenda-mapa-adm">
            {Object.entries(sessao.status).map(([k, n]) => <span key={k}><i className="amostra-ponto" style={{ background: COR_STATUS[k] }} />{n}</span>)}
            <span className="rampa-legenda" aria-hidden="true">menos {RAMPA.map((c) => <i key={c} style={{ background: c }} />)} mais ativos</span>
          </div>
        </section>

        <section className="adm-cartao">
          <div className="cartao-topo">
            <h2>Regiões com mais problemas</h2>
            <p className="sec">Clique numa região para filtrar o painel.</p>
          </div>
          <table className="tabela">
            <thead><tr><th scope="col">Região</th><th scope="col" className="num">Ativas</th><th scope="col" className="num">Resolvidas</th><th scope="col" className="num">Total</th></tr></thead>
            <tbody>
              {resumo.por_regiao.map((r) => (
                <tr key={r.regiao} className={filtros.regiao === r.regiao ? 'sel' : ''}>
                  <td><button type="button" className="link" onClick={() => aoRegiao(r.regiao)}>{r.regiao}</button></td>
                  <td className="num">{r.ativos}</td><td className="num">{r.resolvidos}</td><td className="num">{r.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {resumo.ruas_mais_problemas.length > 0 && (
            <>
              <h3>Ruas com mais problemas ativos</h3>
              <ol className="ruas">
                {resumo.ruas_mais_problemas.map((r) => <li key={r.rua}><span>{r.rua}</span><strong>{r.ativos}</strong></li>)}
              </ol>
            </>
          )}
        </section>
      </div>

      <div className="grade-2">
        <section className="adm-cartao">
          <div className="cartao-topo"><h2>Novas ocorrências e resoluções por dia</h2><p className="sec">Últimos 45 dias</p></div>
          <LinhasTempo pontos={resumo.serie_diaria} rotulo="Novas ocorrências e resoluções por dia nos últimos 45 dias"
            series={[{ chave: 'novos', nome: 'Novas', classe: 's1' }, { chave: 'resolvidos', nome: 'Resolvidas', classe: 's2' }]} />
        </section>
        <section className="adm-cartao">
          <div className="cartao-topo"><h2>Ocorrências por categoria</h2></div>
          <BarrasHorizontais dados={cats} total={resumo.total} rotulo="Ocorrências por categoria" />
          <h3>Como chegaram</h3>
          <p className="sec canais">
            {Object.entries(resumo.por_canal).map(([k, v]) => `${{ foto: 'Foto', voz: 'Voz', texto: 'Texto' }[k] ?? k}: ${v}`).join(' · ')}
          </p>
        </section>
      </div>

      <section className="adm-cartao">
        <div className="cartao-topo">
          <h2>Impacto</h2>
          <p className="sec">Indicadores do pitch: obstáculos identificados, ocorrências confirmadas, rotas adaptadas por perfil e tempo de resposta dos responsáveis. Base inteira, sem filtros.</p>
        </div>
        <div className="grade-2 sem-margem">
          <div className="kpis kpis-compactos">
            <Kpi valor={imp.obstaculos_identificados} rotulo="Obstáculos identificados" />
            <Kpi valor={imp.ocorrencias_confirmadas} rotulo="Ocorrências confirmadas" />
            <Kpi valor={totalRotas} rotulo="Rotas adaptadas por perfil" />
            <Kpi valor={fmtNum(imp.dias_medios_resposta_responsavel, ' dias')} rotulo="Resposta dos responsáveis" />
          </div>
          <div>
            <h3>Rotas adaptadas por perfil</h3>
            <BarrasHorizontais dados={rotasPerfil} total={totalRotas} rotulo="Rotas calculadas por perfil de mobilidade" />
            <p className="nota">Inclui histórico simulado de demonstração; rotas reais pedidas no app somam aqui.</p>
          </div>
        </div>
      </section>
    </>
  );
}

function SeletorStatus({ relato, sessao, aoMudar }) {
  return (
    <select aria-label={`Status de ${relato.id}`} value={relato.status} onChange={(e) => aoMudar(relato, e.target.value)}>
      {Object.entries(sessao.status).map(([k, n]) => <option key={k} value={k}>{n}</option>)}
    </select>
  );
}

function Status({ status, sessao }) {
  return <span className="status"><i style={{ background: COR_STATUS[status] }} />{sessao.status[status] ?? status}</span>;
}

function Ocorrencias({ relatos, sessao, aoMudar, aoSelecionar }) {
  const lista = relatos.filter((r) => r.categoria !== 'entrada');
  return (
    <section className="adm-cartao">
      <div className="cartao-topo"><h2>Registros ({lista.length})</h2><p className="sec">Mude o status direto na tabela. Clique na foto para ampliar.</p></div>
      <div className="tabela-rolagem">
        <table className="tabela tabela-registros">
          <thead>
            <tr><th scope="col">Foto</th><th scope="col">Categoria</th><th scope="col">Região / rua</th><th scope="col">Status</th>
              <th scope="col" className="num">Confirmações</th><th scope="col">Criado</th><th scope="col">Canal</th><th scope="col">Protocolo</th></tr>
          </thead>
          <tbody>
            {lista.map((r) => (
              <tr key={r.id}>
                <td>
                  {r.tem_foto ? (
                    <button type="button" className="miniatura" onClick={() => aoSelecionar(r)} aria-label={`Ver foto e detalhes de ${r.id}`}>
                      <img src={`/api/relatos/${encodeURIComponent(r.id)}/foto`} alt="" loading="lazy" />
                    </button>
                  ) : <button type="button" className="miniatura vazia" onClick={() => aoSelecionar(r)} aria-label={`Ver detalhes de ${r.id}`}>sem foto</button>}
                </td>
                <td>{sessao.categorias[r.categoria] ?? r.categoria}{r.origem?.startsWith('simulado') && <span className="etiqueta">simulado</span>}</td>
                <td><strong>{r.regiao}</strong><br /><span className="sec">{r.rua ?? '—'}</span></td>
                <td><Status status={r.status} sessao={sessao} /><SeletorStatus relato={r} sessao={sessao} aoMudar={aoMudar} /></td>
                <td className="num">{r.confirmacoes}</td>
                <td>{fmtData(r.criado_em)}</td>
                <td>{{ foto: 'Foto', voz: 'Voz', texto: 'Texto' }[r.canal] ?? 'Foto'}{r.descricao && <><br /><span className="sec">“{r.descricao}”</span></>}</td>
                <td>{r.protocolo ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Moderacao({ token, sessao, aoMudou }) {
  const [fila, setFila] = useState(null);
  const [erro, setErro] = useState(null);
  const carregar = useCallback(() => chamarAdm(token, '/moderacao').then((r) => setFila(r.relatos)).catch((e) => setErro(e.message)), [token]);
  useEffect(() => { carregar(); }, [carregar]);
  const decidir = async (r, decisao) => {
    try {
      await chamarAdm(token, `/moderacao/${encodeURIComponent(r.id)}`, { metodo: 'POST', corpo: { decisao } });
      carregar();
      aoMudou();
    } catch (e) { setErro(e.message); }
  };
  return (
    <section className="adm-cartao">
      <div className="cartao-topo">
        <h2>Fila de moderação</h2>
        <p className="sec">Fotos em que a visão computacional não teve certeza (INCONCLUSIVO). Uma pessoa da equipe decide antes de valer.</p>
      </div>
      {erro && <p className="erro">{erro}</p>}
      {fila && fila.length === 0 && <p className="vazio">Nenhum aviso esperando moderação.</p>}
      <div className="cartoes-moderacao">
        {(fila ?? []).map((r) => (
          <article key={r.id} className="item-moderacao">
            {r.tem_foto && <img src={`/api/relatos/${encodeURIComponent(r.id)}/foto`} alt={`Foto do aviso ${r.id}`} />}
            <div>
              <strong>{sessao.categorias[r.categoria] ?? r.categoria}</strong>
              <p className="sec">{r.rua ?? 'sem rua'} · {fmtData(r.criado_em)}</p>
              {r.validacao_visao?.motivos?.length > 0 && <p className="sec">Visão: {r.validacao_visao.motivos.join('; ')}</p>}
              <div className="botoes">
                <button type="button" className="btn primario" onClick={() => decidir(r, 'aprovar')}>Aprovar</button>
                <button type="button" className="btn" onClick={() => decidir(r, 'rejeitar')}>Rejeitar</button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function Instituicoes() {
  const [lista, setLista] = useState(null);
  const [copiado, setCopiado] = useState(null);
  useEffect(() => { fetch('/api/instituicoes').then((r) => r.json()).then((d) => setLista(d.instituicoes)).catch(() => setLista([])); }, []);
  const codigo = (id, nome) => `<iframe src="${location.origin}/embed/${id}" title="Como chegar com acessibilidade: ${nome}" width="380" height="560" style="border:0;border-radius:16px" loading="lazy"></iframe>`;
  return (
    <section className="adm-cartao">
      <div className="cartao-topo">
        <h2>Instituições parceiras</h2>
        <p className="sec">Shoppings, hospitais e universidades com entradas mapeadas publicam no próprio site o widget
          “Como chegar com acessibilidade” (modelo de negócio do pitch). Copie o código e cole na página da instituição.</p>
      </div>
      {lista?.length === 0 && <p className="vazio">Nenhum lugar com entradas levantadas.</p>}
      <div className="cartoes-inst">
        {(lista ?? []).map((l) => (
          <article key={l.id} className="item-inst">
            <div className="item-inst-info">
              <h3>{l.nome}</h3>
              <p className="sec">{l.endereco}</p>
              <p>{l.entradas} entradas mapeadas · {l.entradas_acessiveis} acessíveis {l.dados_exemplo && <span className="etiqueta">dados de exemplo</span>}</p>
              <label className="codigo">
                <span>Código para o site</span>
                <textarea readOnly rows={4} value={codigo(l.id, l.nome)} onFocus={(e) => e.target.select()} />
              </label>
              <div className="botoes">
                <button type="button" className="btn primario" onClick={() => {
                  navigator.clipboard?.writeText(codigo(l.id, l.nome)).then(() => { setCopiado(l.id); setTimeout(() => setCopiado(null), 2000); });
                }}>{copiado === l.id ? 'Copiado!' : 'Copiar código'}</button>
                <a className="btn" href={`/embed/${l.id}`} target="_blank" rel="noopener noreferrer">Abrir o widget</a>
              </div>
            </div>
            <iframe src={`/embed/${l.id}`} title={`Prévia do widget de ${l.nome}`} className="previa-widget" loading="lazy" />
          </article>
        ))}
      </div>
    </section>
  );
}

function Detalhe({ relato: r, sessao, aoFechar, aoMudar }) {
  useEffect(() => {
    const esc = (e) => e.key === 'Escape' && aoFechar();
    addEventListener('keydown', esc);
    return () => removeEventListener('keydown', esc);
  }, [aoFechar]);
  return (
    <div className="modal-fundo" onClick={aoFechar}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="titulo-detalhe-adm" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="fechar" onClick={aoFechar} aria-label="Fechar">×</button>
        {r.tem_foto && <img src={`/api/relatos/${encodeURIComponent(r.id)}/foto`} alt={`Foto da ocorrência ${r.id}`} />}
        {r.foto_ilustrativa && <p className="nota">Foto ilustrativa (registro simulado de demonstração).</p>}
        <h2 id="titulo-detalhe-adm">{sessao.categorias[r.categoria] ?? r.categoria} <span className="sec">#{r.id}</span></h2>
        <dl>
          <dt>Status</dt><dd><Status status={r.status} sessao={sessao} /></dd>
          <dt>Região</dt><dd>{r.regiao}</dd>
          <dt>Rua</dt><dd>{r.rua ?? '—'}</dd>
          <dt>Coordenadas</dt><dd>{r.lat.toFixed(5)}, {r.lon.toFixed(5)}</dd>
          <dt>Confirmações</dt><dd>{r.confirmacoes} sim · {r.negacoes} não</dd>
          <dt>Criado</dt><dd>{fmtData(r.criado_em)}</dd>
          <dt>Confirmado</dt><dd>{fmtData(r.confirmado_em)}</dd>
          <dt>Resolvido</dt><dd>{fmtData(r.resolvido_em)}</dd>
          {r.descricao && <><dt>Descrição (voz)</dt><dd>“{r.descricao}”</dd></>}
          {r.protocolo && <><dt>Protocolo</dt><dd>{r.protocolo}</dd></>}
        </dl>
        <div className="botoes">
          <SeletorStatus relato={r} sessao={sessao} aoMudar={aoMudar} />
          <a className="btn" href={`https://www.openstreetmap.org/?mlat=${r.lat}&mlon=${r.lon}#map=19/${r.lat}/${r.lon}`} target="_blank" rel="noopener noreferrer">Ver no OpenStreetMap</a>
        </div>
      </div>
    </div>
  );
}
