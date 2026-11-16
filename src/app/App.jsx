import { useCallback, useEffect, useState } from 'react';
import { BoasVindas, Perfil, Preferencias } from './telas/Onboarding.jsx';
import { ConfirmarDestino, Home, Ouvindo } from './telas/Destino.jsx';
import { Chegada, Navegacao, PreviaRota } from './telas/Rota.jsx';
import { AvisoEnviado, CameraAviso, TipoAviso } from './telas/Avisar.jsx';
import { Ajuda, Ajustes, MeusAvisos, Novidade, Privacidade } from './telas/Conta.jsx';
import { Aviso, Botao, Cabecalho, Carregando, Tela, Titulo, VozContexto } from './componentes/base.jsx';
import { carregar, salvar } from './servicos/preferencias.js';
import { Celular } from './componentes/Celular.jsx';
import { api, definirDispositivo, guardarRota } from './servicos/api.js';
import { configurarVibracao, configurarVoz, falar, temVozPortugues } from './servicos/voz.js';
import { FonteGPS } from '../localizacao/fontes.js';

const params = new URLSearchParams(location.search);
// Demonstração reproduzível: ?chuva=simular força chuva forte; ?chuva=nao ignora a previsão real.
const SIMULAR_CHUVA = params.get('chuva') === 'simular';
const SEM_CHUVA = params.get('chuva') === 'nao';

export function App() {
  const [prefs, setPrefsEstado] = useState(carregar);
  const [pilha, setPilha] = useState(() => [prefs.onboardingFeito ? 'home' : 'boas_vindas']);
  const tela = pilha[pilha.length - 1];
  const [territorio, setTerritorio] = useState(null);
  const [origem, setOrigem] = useState(null);
  const [avisoOrigem, setAvisoOrigem] = useState(null);
  const [clima, setClima] = useState(null);
  const [salvos, setSalvos] = useState([]);
  const [busca, setBusca] = useState({ carregando: false });
  const [rotaEstado, setRotaEstado] = useState({ carregando: false });
  const [nav, setNav] = useState(null);
  const [chegada, setChegada] = useState(null);
  const [aviso, setAviso] = useState({});
  const [novidade, setNovidade] = useState(null);
  const [digitar, setDigitar] = useState(false);
  const [ouvirChave, setOuvirChave] = useState(0);
  const [semVozPt, setSemVozPt] = useState(false);
  const [local, setLocal] = useState(null);
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
    if (tela !== 'home' || origem) return;
    let vivo = true;
    (async () => {
      let t = territorio;
      try {
        t = t ?? await api.territorio();
        if (vivo) setTerritorio(t);
      } catch {
        if (vivo) setAvisoOrigem('Sem conexão com o servidor. Verifique a internet.');
        return;
      }
      // Mock deliberado (só sem GPS): partida de demonstração na Vila Yara (gold do pipeline).
      const casa = t.demo?.casa ?? { nome: 'Casa', lat: t.centro[0], lon: t.centro[1] };
      let o = null;
      try {
        const p = await FonteGPS.obterUmaVez({ timeout: 10000 });
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
  }, [tela, origem, territorio]);

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
  }, [origem]); // eslint-disable-line react-hooks/exhaustive-deps

  const buscarDestino = useCallback(async (texto) => {
    ir('destino');
    setBusca({ carregando: true });
    try {
      setBusca({ carregando: false, resultado: await api.destino(texto, origem) });
    } catch (e) {
      setBusca({ carregando: false, erro: e.message });
    }
  }, [ir, origem]);

  const calcularRota = useCallback(async (destino) => {
    ir('rota');
    const pedido = {
      origem: { lat: origem.lat, lon: origem.lon, nome: origem.nome },
      destino: { lat: destino.lat, lon: destino.lon, nome: destino.nome, id: destino.id },
      perfis: prefs.perfis.length ? prefs.perfis : ['sem_apoio'],
      idoso: prefs.vozDevagar,
      chuva: SIMULAR_CHUVA ? 'simular' : SEM_CHUVA ? 'nao' : 'auto',
    };
    setRotaEstado({ carregando: true, pedido });
    try {
      const r = await api.rota(pedido);
      guardarRota(r);
      setRotaEstado({ carregando: false, rota: r, pedido });
    } catch (e) {
      setRotaEstado({ carregando: false, erro: e.message, pedido });
      falar(e.message);
    }
  }, [ir, origem, prefs]);

  // Barra inferior: Início / Avisar / Meus avisos / Ajustes (voltar sempre leva ao Início).
  const menu = (id) => {
    if (id === 'home') irRaiz('home');
    else if (id === 'avisar') { setAviso({ posicao: origem }); setPilha(['home', 'camera']); }
    else setPilha(['home', id]);
  };

  const terminarOnboarding = () => {
    setPrefs({ onboardingFeito: true });
    irRaiz('home');
  };

  // ---- telas ---------------------------------------------------------------
  let conteudo = null;
  switch (tela) {
    case 'boas_vindas':
      conteudo = <BoasVindas aoComecar={() => ir('perfil')} />;
      break;
    case 'perfil':
      conteudo = <Perfil perfis={prefs.perfis} aoMudar={(perfis) => setPrefs({ perfis })} aoVoltar={voltar}
        aoContinuar={() => (prefs.onboardingFeito ? voltar() : ir('preferencias'))} passo={prefs.onboardingFeito ? null : 1} />;
      break;
    case 'preferencias':
      conteudo = <Preferencias prefs={prefs} aoMudar={setPrefs} aoVoltar={voltar} passo={prefs.onboardingFeito ? null : 2}
        rotuloContinuar={prefs.onboardingFeito ? 'Salvar' : 'Continuar'} aoContinuar={() => (prefs.onboardingFeito ? voltar() : terminarOnboarding())} />;
      break;
    case 'home':
      conteudo = !origem ? (
        <Tela fala="Procurando onde você está."><Cabecalho marca /><Titulo>Procurando onde você está…</Titulo>
          <Carregando texto="Pedindo sua localização" />
          <p className="sub">O app pergunta antes de usar sua localização. Se não quiser, tudo bem: usamos um ponto de partida de demonstração.</p></Tela>
      ) : (
        <Home key={digitar ? 'd' : 'n'} clima={clima} salvos={salvos} origem={origem} local={local} avisoOrigem={avisoOrigem} aoMenu={menu}
          aoFalar={() => ir('ouvindo')} aoDigitar={buscarDestino} aoEscolher={calcularRota}
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
        aoSim={(c) => { setPilha((p) => p.slice(0, -1)); calcularRota(c); }} />;
      break;
    case 'rota':
      conteudo = rotaEstado.carregando ? (
        <Tela fala="Calculando o caminho mais seguro."><Cabecalho titulo="Sua rota" aoVoltar={voltar} /><Titulo>Calculando o caminho mais seguro…</Titulo><Carregando texto="Olhando escadas, calçadas e avisos" /></Tela>
      ) : rotaEstado.erro ? (
        <Tela><Cabecalho titulo="Sua rota" aoVoltar={voltar} /><Titulo>Não encontrei um caminho</Titulo><Aviso tipo="erro">{rotaEstado.erro}</Aviso>
          <div className="empurra" /><Botao variante="secundario" onClick={voltar}>Voltar</Botao></Tela>
      ) : (
        <PreviaRota rota={rotaEstado.rota} origem={origem} aoVoltar={voltar}
          aoComecar={({ simular }) => { setNav({ rota: rotaEstado.rota, simular, pedido: rotaEstado.pedido, chave: Date.now() }); irRaiz('navegacao'); }} />
      );
      break;
    case 'chegada':
      conteudo = <Chegada resumo={chegada} prefs={prefs} aoFim={() => irRaiz('home')} />;
      break;
    case 'camera':
      conteudo = <CameraAviso aoVoltar={voltar} aoFoto={(foto) => { setAviso((a) => ({ ...a, foto })); ir('tipo_aviso'); }} />;
      break;
    case 'tipo_aviso':
      conteudo = <TipoAviso foto={aviso.foto} posicao={aviso.posicao ?? origem} aoVoltar={voltar} aoRefazer={voltar}
        aoEnviado={(criado, tipo) => { setAviso((a) => ({ ...a, criado, tipo })); setPilha((p) => [...p.filter((x) => !['camera', 'tipo_aviso'].includes(x)), 'aviso_enviado']); }} />;
      break;
    case 'aviso_enviado':
      conteudo = <AvisoEnviado tipo={aviso.tipo} navegando={Boolean(nav)} aoVoltar={() => irRaiz(nav ? 'navegacao' : 'home')}
        aoMeusAvisos={() => { setPilha((p) => [...p.slice(0, -1), 'meus']); }} />;
      break;
    case 'meus':
      conteudo = <MeusAvisos aoVoltar={voltar} aoMenu={menu} />;
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
    // TODO: integrar "Ver no mapa" com uma tela de mapa do relato (hoje só fecha a novidade).
    conteudo = <Novidade relato={novidade} aoFechar={() => setNovidade(null)} aoVerMapa={() => setNovidade(null)} />;
  }

  const voz = { ativa: prefs.vozAlta, alternar: (v) => setPrefs({ vozAlta: v }), semVozPt };
  return (
    <VozContexto.Provider value={voz}>
    <Celular>
    <div className="app">
      <a className="pular" href="#conteudo">Pular para o conteúdo</a>
      <div id="conteudo">
        {nav && (
          <Navegacao key={nav.chave} rotaInicial={nav.rota} prefs={prefs} simular={nav.simular} pedidoRota={nav.pedido}
            emSegundoPlano={tela !== 'navegacao'}
            aoChegar={(resumo) => { setChegada(resumo); setNav(null); irRaiz('chegada'); }}
            aoAvisar={(pos) => { setAviso({ posicao: pos }); ir('camera'); }}
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
