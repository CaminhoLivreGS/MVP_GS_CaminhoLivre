import { useCallback, useEffect, useRef, useState } from 'react';
import { BoasVindas, Modo, Perfil, Preferencias } from './telas/Onboarding.jsx';
import { MapaBarreiras } from './telas/MapaBarreiras.jsx';
import { AvisoVoz, EscolherAviso } from './telas/AvisoVoz.jsx';
import { ConfirmarDestino, Home, Ouvindo } from './telas/Destino.jsx';
import { Chegada, Navegacao, PreviaRota } from './telas/Rota.jsx';
import { AvisoEnviado, CameraAviso, TipoAviso } from './telas/Avisar.jsx';
import { Ajuda, Ajustes, MeusAvisos, Novidade, Privacidade } from './telas/Conta.jsx';
import { Saindo, lerCodigoLocal } from './telas/Local.jsx';
import { Aviso, Botao, Cabecalho, Carregando, Tela, Titulo, VozContexto } from './componentes/base.jsx';
import { apagarPerfil, carregar, salvar, salvarPerfil, usarPerfil } from './servicos/preferencias.js';
import { Perfis } from './telas/Perfis.jsx';
import { DestinoLonge, EscolherAppCorrida } from './telas/Longe.jsx';
import { avaliarDistancia } from './servicos/transporte.js';
import { distancia } from '../localizacao/geo.js';
import { Celular } from './componentes/Celular.jsx';
import { aoMudarModoDemo, api, definirDispositivo, emModoDemo, guardarRota } from './servicos/api.js';
import { configurarVibracao, configurarVoz, falar, temVozPortugues } from './servicos/voz.js';
import { FonteGPS } from '../localizacao/fontes.js';

const params = new URLSearchParams(location.search);
// Demonstração reproduzível: ?chuva=simular força chuva forte; ?chuva=nao ignora a previsão real.
const SIMULAR_CHUVA = params.get('chuva') === 'simular';
const SEM_CHUVA = params.get('chuva') === 'nao';
// ?hora=15:00 simula o horário de funcionamento dos lugares (demo à noite com o shopping "aberto").
const HORA_DEMO = /^([01]\d|2[0-3]):[0-5]\d$/.test(params.get('hora') ?? '') ? params.get('hora') : null;
// QR code do ponto interno (ou link): ?saindo=<lugar>&ponto=<ponto> abre direto o "Estou saindo".
const CODIGO_INICIAL = lerCodigoLocal(location.href);
if (CODIGO_INICIAL) {
  const u = new URL(location.href);
  u.searchParams.delete('saindo');
  u.searchParams.delete('ponto');
  history.replaceState(null, '', u);
}
// Widget das instituições ("Como chegar com acessibilidade"): ?destino=<id do lugar> abre a rota direto.
const DESTINO_INICIAL = /^[a-z0-9-]{2,80}$/.test(params.get('destino') ?? '') ? params.get('destino') : null;
if (DESTINO_INICIAL) {
  const u = new URL(location.href);
  u.searchParams.delete('destino');
  history.replaceState(null, '', u);
}
// Lugares sem "porta" (o destino já é o ponto): não procura entrada.
const SEM_ENTRADA = new Set(['ponto_onibus', 'parque', 'casa']);
const comPrazo = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('prazo')), ms))]);

export function App() {
  // A preferência de voz vale ANTES da primeira tela falar (os efeitos dos filhos rodam antes dos do App).
  const [prefs, setPrefsEstado] = useState(() => {
    const p = carregar();
    configurarVoz({ ativa: p.vozAlta, devagar: p.vozDevagar });
    return p;
  });
  const [pilha, setPilha] = useState(() => (prefs.onboardingFeito ? (CODIGO_INICIAL ? ['home', 'saindo'] : ['home']) : ['boas_vindas']));
  const [saidaInicial] = useState(CODIGO_INICIAL);
  const [locaisPerto, setLocaisPerto] = useState([]);
  const tela = pilha[pilha.length - 1];
  const [territorio, setTerritorio] = useState(null);
  const [origem, setOrigem] = useState(null);
  const [avisoOrigem, setAvisoOrigem] = useState(null);
  const [semServidor, setSemServidor] = useState(false);
  // Nenhuma API respondeu: o app mostra os dados de exemplo gravados (ver servicos/mock.js).
  const [modoDemo, setModoDemo] = useState(emModoDemo);
  useEffect(() => aoMudarModoDemo(setModoDemo), []);
  const [tentativa, setTentativa] = useState(0);
  const [clima, setClima] = useState(null);
  const [salvos, setSalvos] = useState([]);
  const [busca, setBusca] = useState({ carregando: false });
  const [rotaEstado, setRotaEstado] = useState({ carregando: false });
  const [destinoLonge, setDestinoLonge] = useState(null);
  const [nav, setNav] = useState(null);
  const [chegada, setChegada] = useState(null);
  const [aviso, setAviso] = useState({});
  const [novidade, setNovidade] = useState(null);
  const [digitar, setDigitar] = useState(false);
  const [ouvirChave, setOuvirChave] = useState(0);
  const [semVozPt, setSemVozPt] = useState(false);
  const [local, setLocal] = useState(null);
  const [mapaInicial, setMapaInicial] = useState(null); // relato aberto no mapa de barreiras (ex.: vindo da Novidade)
  const destinoPendente = useRef(DESTINO_INICIAL);
  const [barreiras, setBarreiras] = useState([]);          // relatos ativos perto (pinos da Home)
  const [editandoPerfil, setEditandoPerfil] = useState(null); // id do perfil em edição, 'novo' ou null (o ativo)
  useEffect(() => { temVozPortugues().then((ok) => setSemVozPt(ok === false)); }, []);

  const setPrefs = useCallback((mud) => setPrefsEstado((p) => {
    const n = { ...p, ...mud };
    configurarVoz({ ativa: n.vozAlta, devagar: n.vozDevagar });
    salvar(n);
    return n;
  }), []);

  const ir = useCallback((t) => setPilha((p) => [...p, t]), []);
  const voltar = useCallback(() => setPilha((p) => (p.length > 1 ? p.slice(0, -1) : p)), []);
  const irRaiz = useCallback((t) => setPilha([t]), []);

  // Preferências aplicadas no documento e nos serviços.
  useEffect(() => {
    document.documentElement.dataset.tema = prefs.tema;
    document.documentElement.dataset.letra = prefs.letra;
    document.querySelector('meta[name=theme-color]')?.setAttribute('content', prefs.tema === 'claro' ? '#f4f1ea' : '#000000');
    configurarVoz({ ativa: prefs.vozAlta, devagar: prefs.vozDevagar });
    configurarVibracao(prefs.vibrar);
    definirDispositivo(prefs.dispositivo);
    salvar(prefs);
  }, [prefs]);

  // Origem: a localização REAL da pessoa, em qualquer lugar (como Waze/Maps).
  // Só se o GPS for negado ou falhar usamos a partida de demonstração (Vila Yara).
  useEffect(() => {
    if (!['home', 'saindo', 'mapa'].includes(tela) || origem) return;
    let vivo = true;
    setSemServidor(false);
    (async () => {
      let t = territorio;
      try {
        t = t ?? await api.territorio();
        if (!t?.centro) throw new Error('resposta inválida');
        if (vivo) setTerritorio(t);
      } catch {
        // Sem servidor não há como seguir: sai do "carregando" e oferece tentar de novo.
        if (vivo) setSemServidor(true);
        return;
      }
      // Mock deliberado (só sem GPS): partida de demonstração na Vila Yara (gold do pipeline).
      const casa = t.demo?.casa ?? { nome: 'Casa', lat: t.centro[0], lon: t.centro[1] };
      let o = null;
      try {
        // O timeout do navegador não conta enquanto o pedido de permissão está aberto;
        // este limite garante que a tela nunca fica presa esperando a resposta.
        const p = await Promise.race([
          FonteGPS.obterUmaVez({ timeout: 10000 }),
          new Promise((_, rej) => setTimeout(() => rej({ codigo: 'DEMOROU' }), 15000)),
        ]);
        o = { ...p, nome: 'Você', fonte: 'gps' };
      } catch (err) {
        if (vivo) setAvisoOrigem(err?.codigo === 'PERMISSAO_NEGADA'
          ? 'Localização não liberada: partida de demonstração na Vila Yara.'
          : 'Sem localização: partida de demonstração na Vila Yara.');
      }
      if (!vivo) return;
      setOrigem(o ?? { ...casa, fonte: 'demo' });
    })();
    return () => { vivo = false; };
  }, [tela, origem, territorio, tentativa]);

  const usarDemonstracao = () => {
    if (!territorio) return;
    const casa = territorio.demo?.casa ?? { nome: 'Casa', lat: territorio.centro[0], lon: territorio.centro[1] };
    setAvisoOrigem('Partida de demonstração na Vila Yara.');
    setOrigem({ ...casa, fonte: 'demo' });
  };
  const esperandoOrigem = semServidor ? (
    <>
      <Aviso tipo="erro">Não consegui falar com o servidor. Verifique a internet e tente de novo.</Aviso>
      <Botao icone="repetir" onClick={() => setTentativa((n) => n + 1)}>Tentar de novo</Botao>
    </>
  ) : (
    <>
      <Carregando texto="Pedindo sua localização" />
      <p className="sub">O app pergunta antes de usar sua localização. Se não quiser, tudo bem: usamos um ponto de partida de demonstração.</p>
      {territorio && <Botao variante="secundario" onClick={usarDemonstracao}>Usar ponto de demonstração</Botao>}
    </>
  );

  // Clima, lugares salvos e novidades dependem da origem.
  useEffect(() => {
    if (!origem) return;
    if (SEM_CHUVA) setClima(null);
    else api.clima(origem.lat, origem.lon, SIMULAR_CHUVA).then(setClima).catch(() => setClima(null));
    if (origem.fonte === 'demo') setLocal('Vila Yara, Osasco');
    else api.ondeEstou(origem.lat, origem.lon).then((r) => setLocal(r.texto)).catch(() => setLocal(null));
    Promise.all([
      api.lugares('', origem, 'ubs').catch(() => ({ lugares: [] })),
      api.lugares('', origem, 'estacao').catch(() => ({ lugares: [] })),
    ]).then(([u, e]) => {
      const l = [];
      // TODO: integrar lugares salvos pelo próprio usuário (hoje: UBS, estação e farmácia mais próximas, do OSM).
      if (u.lugares[0]) l.push({ ...u.lugares[0], apelido: 'UBS' });
      if (e.lugares[0]) l.push({ ...e.lugares[0], apelido: 'Estação' });
      if (l.length < 3) api.lugares('', origem, 'farmacia').then((f) => f.lugares[0] && setSalvos([...l, { ...f.lugares[0], apelido: 'Farmácia' }])).catch(() => setSalvos(l));
      else setSalvos(l);
    });
    api.novidades(true).then((r) => r.novidades[0] && setNovidade(r.novidades[0])).catch(() => {});
    api.locaisPerto(origem.lat, origem.lon).then((r) => setLocaisPerto(r.locais)).catch(() => setLocaisPerto([]));
    api.relatos().then((r) => setBarreiras(r.relatos.filter((x) => x.categoria !== 'entrada')
      .map((x) => ({ ...x, distancia: distancia(origem, x) })).sort((a, b) => a.distancia - b.distancia))).catch(() => setBarreiras([]));
  }, [origem]); // eslint-disable-line react-hooks/exhaustive-deps

  // naMesmaTela: nova busca a partir da própria tela de destino (não empilha outra).
  const buscarDestino = useCallback(async (texto, { naMesmaTela = false } = {}) => {
    if (!naMesmaTela) ir('destino');
    setBusca({ carregando: true, consulta: texto });
    try {
      setBusca({ carregando: false, consulta: texto, resultado: await api.destino(texto, origem) });
    } catch (e) {
      setBusca({ carregando: false, consulta: texto, erro: e.message });
    }
  }, [ir, origem]);

  // opcoes.origem: partir de outro ponto (ex.: a saída escolhida no "Estou saindo").
  const calcularRota = useCallback(async (destino, opcoes = {}) => {
    ir('rota');
    const de = opcoes.origem ?? origem;
    const perfis = prefs.perfis.length ? prefs.perfis : ['sem_apoio'];
    let alvo = { lat: destino.lat, lon: destino.lon, nome: destino.nome, id: destino.id };
    let entrada = null;
    // Melhor entrada para o perfil: a rota termina NA PORTA certa, não no meio do prédio.
    if (!opcoes.semEntrada && !SEM_ENTRADA.has(destino.categoria)) {
      setRotaEstado({ carregando: true, etapa: 'entrada' });
      try {
        entrada = await comPrazo(api.entradas(destino, de, perfis, HORA_DEMO), 9000);
        if (entrada.escolhida) alvo = { ...alvo, lat: entrada.escolhida.lat, lon: entrada.escolhida.lon, nome: `${destino.nome} (${entrada.escolhida.nome})` };
        else entrada = entrada.descartadas?.length ? entrada : null;
      } catch {
        entrada = null; // sem dado de entradas: segue até o lugar, como antes
      }
    }
    const pedido = {
      origem: { lat: de.lat, lon: de.lon, nome: de.nome },
      destino: alvo,
      perfis,
      preferencias: prefs.preferenciasRota ?? [],
      idoso: prefs.vozDevagar,
      chuva: SIMULAR_CHUVA ? 'simular' : SEM_CHUVA ? 'nao' : 'auto',
    };
    setRotaEstado({ carregando: true, pedido });
    try {
      const r = await api.rota(pedido);
      if (entrada) r.entrada = entrada;
      if (opcoes.saida) r.saida = opcoes.saida;
      guardarRota(r);
      setRotaEstado({ carregando: false, rota: r, pedido });
    } catch (e) {
      setRotaEstado({ carregando: false, erro: e.message, pedido });
      falar(e.message);
    }
  }, [ir, origem, prefs]);

  // Destino escolhido pela pessoa: se for longe para ir a pé, explica e oferece ônibus, carro ou app de corrida.
  const irParaDestino = useCallback((destino) => {
    if (origem && avaliarDistancia(origem, destino, prefs.perfis, prefs.vozDevagar).longe) {
      setDestinoLonge(destino);
      ir('longe');
    } else {
      calcularRota(destino);
    }
  }, [origem, prefs, ir, calcularRota]);

  // Veio do widget de uma instituição: assim que souber onde a pessoa está, calcula a rota até o lugar.
  useEffect(() => {
    if (!origem || !destinoPendente.current || tela !== 'home') return;
    const id = destinoPendente.current;
    destinoPendente.current = null;
    api.local(id).then((l) => calcularRota({ ...l, categoria: 'local' })).catch(() => falar('Não encontrei esse lugar.'));
  }, [origem, tela, calcularRota]);

  // Barra inferior: Início / Mapa / Avisar / Avisos / Ajustes (voltar sempre leva ao Início).
  const menu = (id) => {
    if (id === 'home') irRaiz('home');
    else if (id === 'avisar') { setAviso({ posicao: origem }); setPilha(['home', 'escolher_aviso']); }
    else if (id === 'mapa') { setMapaInicial(null); setPilha(['home', 'mapa']); }
    else setPilha(['home', id]);
  };
  const aoEnviarAviso = (criado, tipo) => {
    setAviso((a) => ({ ...a, criado, tipo }));
    setPilha((p) => [...p.filter((x) => !['escolher_aviso', 'camera', 'tipo_aviso', 'aviso_voz'].includes(x)), 'aviso_enviado']);
  };

  const terminarOnboarding = () => {
    setPrefs({ onboardingFeito: true });
    irRaiz('home');
  };

  // ---- telas ---------------------------------------------------------------
  let conteudo = null;
  switch (tela) {
    case 'boas_vindas':
      conteudo = <BoasVindas aoComecar={() => ir('modo')} />;
      break;
    case 'modo':
      conteudo = <Modo atual={prefs.modo} aoVoltar={voltar} passo={prefs.onboardingFeito ? null : 1}
        aoEscolher={(modo) => {
          // Fala: o app narra tudo. Digitar: sem narração automática (o alto-falante liga quando quiser).
          setPrefs({ modo, vozAlta: modo === 'fala' });
          if (modo === 'fala') falar('Modo fala escolhido. Eu leio tudo em voz alta.', { forcar: true });
          setDigitar((d) => !d); // a Home troca de layout na hora
          if (prefs.onboardingFeito) voltar(); else ir('perfil');
        }}
        aoPular={prefs.onboardingFeito ? undefined : () => { setPrefs({ modo: 'fala', vozAlta: true }); terminarOnboarding(); }} />;
      break;
    case 'perfil': {
      // Sem editandoPerfil: o perfil ativo (ou o primeiro cadastro). 'novo': cadastrar outro, com nome.
      const novo = editandoPerfil === 'novo';
      const alvo = novo ? null : (prefs.perfisSalvos ?? []).find((p) => p.id === (editandoPerfil ?? prefs.perfilAtivo));
      conteudo = <Perfil key={editandoPerfil ?? 'ativo'} perfis={alvo?.perfis ?? (novo ? [] : prefs.perfis)}
        preferencias={alvo?.preferenciasRota ?? (novo ? [] : prefs.preferenciasRota ?? [])}
        nome={alvo?.nome ?? ''} comNome={novo || (prefs.perfisSalvos?.length ?? 0) > 1}
        aoMudar={(perfis, preferenciasRota, nome) => setPrefs(salvarPerfil(prefs, { id: alvo?.id, nome: nome || alvo?.nome || 'Eu', perfis, preferenciasRota }))}
        aoVoltar={() => { setEditandoPerfil(null); voltar(); }}
        aoContinuar={() => { setEditandoPerfil(null); if (prefs.onboardingFeito) voltar(); else ir('preferencias'); }}
        aoPular={prefs.onboardingFeito ? undefined : terminarOnboarding}
        rotuloContinuar={prefs.onboardingFeito ? 'Salvar perfil' : 'Continuar'}
        passo={prefs.onboardingFeito ? null : 2} />;
      break;
    }
    case 'perfis':
      conteudo = <Perfis prefs={prefs} aoVoltar={voltar}
        aoUsar={(id) => setPrefs(usarPerfil(prefs, id))}
        aoEditar={(id) => { setEditandoPerfil(id); ir('perfil'); }}
        aoNovo={() => { setEditandoPerfil(prefs.perfisSalvos?.length ? 'novo' : null); ir('perfil'); }}
        aoApagar={(id) => setPrefs(apagarPerfil(prefs, id))} />;
      break;
    case 'preferencias':
      conteudo = <Preferencias prefs={prefs} aoMudar={setPrefs} aoVoltar={voltar} passo={prefs.onboardingFeito ? null : 3}
        rotuloContinuar={prefs.onboardingFeito ? 'Salvar' : 'Continuar'} aoContinuar={() => (prefs.onboardingFeito ? voltar() : terminarOnboarding())} />;
      break;
    case 'home':
      conteudo = !origem ? (
        <Tela fala="Procurando onde você está." fixa><Cabecalho marca /><Titulo>Procurando onde você está…</Titulo>
          {esperandoOrigem}</Tela>
      ) : (
        <Home key={digitar ? 'd' : 'n'} clima={clima} salvos={salvos} origem={origem} local={local} avisoOrigem={avisoOrigem} aoMenu={menu}
          aoFalar={() => ir('ouvindo')} aoDigitar={buscarDestino} aoEscolher={irParaDestino}
          locaisPerto={locaisPerto} aoSaindo={() => ir('saindo')} modo={prefs.modo ?? 'fala'}
          perfil={(prefs.perfisSalvos ?? []).find((p) => p.id === prefs.perfilAtivo) ?? null} aoPerfis={() => ir('perfis')}
          barreiras={barreiras} aoBarreiras={(id) => { setMapaInicial(id ? barreiras.find((b) => b.id === id) ?? null : null); setPilha(['home', 'mapa']); }}
        />
      );
      break;
    case 'ouvindo':
      conteudo = <Ouvindo key={ouvirChave} aoResultado={(t) => { setPilha((p) => p.slice(0, -1)); buscarDestino(t); }}
        aoFechar={(modo) => {
          if (modo === 'falar') { setOuvirChave((k) => k + 1); return; }
          voltar();
          if (modo === 'digitar') setDigitar((d) => !d);
        }} />;
      break;
    case 'destino':
      conteudo = <ConfirmarDestino {...busca} aoVoltar={voltar} aoNao={() => { voltar(); ir('ouvindo'); }}
        aoBuscar={(t) => buscarDestino(t, { naMesmaTela: true })}
        aoSim={(c) => { setPilha((p) => p.slice(0, -1)); irParaDestino(c); }} />;
      break;
    case 'rota':
      conteudo = rotaEstado.carregando ? (
        <Tela fala={rotaEstado.etapa === 'entrada' ? 'Escolhendo a melhor entrada.' : 'Calculando o caminho mais seguro.'} fixa><Cabecalho titulo="Sua rota" aoVoltar={voltar} />
          <Titulo>{rotaEstado.etapa === 'entrada' ? 'Escolhendo a melhor entrada…' : 'Calculando o caminho mais seguro…'}</Titulo>
          <Carregando texto={rotaEstado.etapa === 'entrada' ? 'Olhando degraus, rampas e portas' : 'Olhando escadas, calçadas e avisos'} /></Tela>
      ) : rotaEstado.erro ? (
        <Tela fixa><Cabecalho titulo="Sua rota" aoVoltar={voltar} /><Titulo>Não encontrei um caminho</Titulo><Aviso tipo="erro">{rotaEstado.erro}</Aviso>
          <div className="empurra" /><Botao variante="secundario" onClick={voltar}>Voltar</Botao></Tela>
      ) : (
        <PreviaRota rota={rotaEstado.rota} origem={origem} aoVoltar={voltar}
          aoComecar={({ simular }) => { setNav({ rota: rotaEstado.rota, simular, pedido: rotaEstado.pedido, chave: Date.now() }); irRaiz('navegacao'); }} />
      );
      break;
    case 'saindo':
      conteudo = !origem ? (
        <Tela fala="Procurando onde você está."><Cabecalho titulo="Estou saindo" aoVoltar={voltar} />{esperandoOrigem}</Tela>
      ) : (
        <Saindo origem={origem} perfis={prefs.perfis.length ? prefs.perfis : ['sem_apoio']} salvos={salvos} inicial={saidaInicial}
          hora={HORA_DEMO} aoVoltar={voltar}
          aoRota={(de, para, info) => calcularRota(para, { origem: de, semEntrada: true, saida: info })} />
      );
      break;
    case 'chegada':
      conteudo = <Chegada resumo={chegada} prefs={prefs} aoFim={() => irRaiz('home')} />;
      break;
    case 'mapa':
      conteudo = !origem ? (
        <Tela fala="Procurando onde você está."><Cabecalho titulo="Mapa de barreiras" aoVoltar={voltar} />{esperandoOrigem}</Tela>
      ) : (
        <MapaBarreiras origem={origem} inicial={mapaInicial?.id ?? null} extra={mapaInicial} aoVoltar={voltar} aoMenu={menu}
          aoAvisar={() => { setAviso({ posicao: origem }); ir('escolher_aviso'); }} />
      );
      break;
    case 'escolher_aviso':
      conteudo = <EscolherAviso aoVoltar={voltar} aoFoto={() => ir('camera')} aoVoz={() => ir('aviso_voz')} />;
      break;
    case 'aviso_voz':
      conteudo = <AvisoVoz posicao={aviso.posicao ?? origem} aoVoltar={voltar} aoEnviado={aoEnviarAviso} />;
      break;
    case 'camera':
      conteudo = <CameraAviso aoVoltar={voltar} aoFoto={(foto) => { setAviso((a) => ({ ...a, foto })); ir('tipo_aviso'); }} />;
      break;
    case 'tipo_aviso':
      conteudo = <TipoAviso foto={aviso.foto} posicao={aviso.posicao ?? origem} aoVoltar={voltar} aoRefazer={voltar}
        aoEnviado={aoEnviarAviso} />;
      break;
    case 'aviso_enviado':
      conteudo = <AvisoEnviado tipo={aviso.tipo} navegando={Boolean(nav)} aoVoltar={() => irRaiz(nav ? 'navegacao' : 'home')}
        aoMeusAvisos={() => { setPilha((p) => [...p.slice(0, -1), 'meus']); }} />;
      break;
    case 'meus':
      conteudo = <MeusAvisos aoVoltar={voltar} aoMenu={menu} />;
      break;
    case 'longe':
      conteudo = destinoLonge && origem ? (
        <DestinoLonge destino={destinoLonge} origem={origem} prefs={prefs} aoVoltar={voltar}
          aoAPe={() => { setPilha((p) => p.slice(0, -1)); calcularRota(destinoLonge); }}
          aoPontoOnibus={(ponto) => { setPilha((p) => p.slice(0, -1)); calcularRota({ ...ponto, categoria: 'ponto_onibus' }); }}
          aoEscolherApp={() => ir('app_corrida')} />
      ) : null;
      break;
    case 'app_corrida':
      conteudo = <EscolherAppCorrida atual={prefs.appCorrida} aoVoltar={voltar}
        aoSalvar={(id) => { setPrefs({ appCorrida: id }); voltar(); }} />;
      break;
    case 'ajustes':
      conteudo = <Ajustes prefs={prefs} aoMudar={setPrefs} aoVoltar={voltar} ir={ir} aoMenu={menu} />;
      break;
    case 'ajuda':
      conteudo = <Ajuda aoVoltar={voltar} />;
      break;
    case 'privacidade':
      conteudo = <Privacidade aoVoltar={voltar} aoApagar={() => {
        try { localStorage.clear(); sessionStorage.clear(); } catch { /* nada */ }
        location.reload();
      }} />;
      break;
    default:
      conteudo = null;
  }
  if (novidade && tela === 'home') {
    conteudo = <Novidade relato={novidade} aoFechar={() => setNovidade(null)}
      aoVerMapa={() => { setMapaInicial(novidade); setNovidade(null); setPilha(['home', 'mapa']); }} />;
  }

  const voz = { ativa: prefs.vozAlta, alternar: (v) => setPrefs({ vozAlta: v }), semVozPt };
  return (
    <VozContexto.Provider value={voz}>
    <Celular>
    <div className="app">
      <a className="pular" href="#conteudo">Pular para o conteúdo</a>
      {modoDemo && (
        <div className="faixa-demo" role="status">Sem servidor: dados de exemplo (Vila Yara)</div>
      )}
      <div id="conteudo">
        {nav && (
          <Navegacao key={nav.chave} rotaInicial={nav.rota} prefs={prefs} simular={nav.simular} pedidoRota={nav.pedido}
            emSegundoPlano={tela !== 'navegacao'}
            aoChegar={(resumo) => { setChegada(resumo); setNav(null); irRaiz('chegada'); }}
            aoAvisar={(pos) => { setAviso({ posicao: pos }); ir('escolher_aviso'); }}
            aoSair={() => { setNav(null); falar('Rota encerrada.'); irRaiz('home'); }} />
        )}
        {tela !== 'navegacao' && conteudo}
      </div>
    </div>
    </Celular>
    <p className="moldura-legenda">Prévia em formato de celular. Para usar GPS, câmera e microfone de verdade, abra no celular.</p>
    </VozContexto.Provider>
  );
}
