import { useEffect, useRef, useState } from 'react';
import { Aviso, Botao, Cabecalho, CaixaFala, Carregando, Progresso, Rodape, Tela, Titulo } from '../componentes/base.jsx';
import { Icone, Marca } from '../componentes/Icone.jsx';
import { AnalisadorVisao } from '../../vision/AnalisadorVisao.js';
import { canvasParaBlob } from '../../vision/VisionPipeline.js';
import { CONFIG_VISAO, lerHashes, salvarHash } from '../configuracao.js';
import { api } from '../servicos/api.js';
import { falar, vibrar, VIBRA } from '../servicos/voz.js';

// Um analisador para o app inteiro: o OpenCV (~10 MB) é baixado uma vez,
// sob demanda, num Web Worker (a interface não trava).
let analisador = null;
const obterAnalisador = () => (analisador ??= new AnalisadorVisao({ config: CONFIG_VISAO }));

export const TIPOS_AVISO = [
  { id: 'buraco', icone: 'buraco', nome: 'Buraco', falar: 'um buraco' },
  { id: 'obstaculo', icone: 'obstaculo', nome: 'Obstáculo', falar: 'um obstáculo' },
  { id: 'alagamento', icone: 'alagamento', nome: 'Alagamento', falar: 'alagamento' },
  { id: 'sem_rampa', icone: 'semRampa', nome: 'Sem rampa', falar: 'falta de rampa ou degrau' },
  { id: 'luz_apagada', icone: 'luzApagada', nome: 'Luz apagada', falar: 'luz apagada' },
  { id: 'entrada', icone: 'porta', nome: 'Entrada de lugar', falar: 'como é esta entrada' },
  { id: 'outro', icone: 'outro', nome: 'Outro', falar: 'outro problema' },
];

/** Perguntas por ícone quando o aviso é sobre a ENTRADA de um lugar (alimenta a escolha de entradas). */
const PERGUNTAS_ENTRADA = [
  { id: 'degrau', nome: 'Tem degrau' }, { id: 'rampa', nome: 'Tem rampa' },
  { id: 'porta_automatica', nome: 'Porta abre sozinha' }, { id: 'porta_giratoria', nome: 'Porta giratória' },
];

/** Evidência do pipeline clássico -> categoria sugerida na tela. */
// TODO: integrar com o repositório de visão quando ele ganhar categorias próprias para rampa e iluminação
// (hoje só ACESSIBILIDADE, OBSTACULO e ALAGAMENTO; "Luz apagada" e "Outro" ficam sem sugestão automática).
const EVIDENCIA_PARA_TIPO = {
  BURACO_OU_QUEBRA: 'buraco', RACHADURA: 'buraco', DEGRAUS: 'sem_rampa', TATIL_INTERROMPIDO: 'outro',
  PASSAGEM_INTERROMPIDA: 'obstaculo', SINALIZACAO: 'obstaculo', OBSTRUCAO: 'obstaculo', AGUA: 'alagamento',
};

/** Página 13: câmera com captura automática quando a imagem fica firme. */
export function CameraAviso({ aoFoto, aoVoltar }) {
  const video = useRef(null);
  const [estado, setEstado] = useState('abrindo'); // abrindo | mirando | firme | sem_camera
  const fala = 'Aponte a câmera para o problema. Eu tiro a foto sozinho quando a imagem ficar firme.';

  useEffect(() => {
    obterAnalisador().preparar().catch(() => {});
    let stream;
    let timer;
    let vivo = true;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1600 } }, audio: false });
        if (!vivo) return;
        video.current.srcObject = stream;
        await video.current.play();
        setEstado('mirando');
        // Estabilidade: diferença média entre quadros pequenos (64x48, cinza).
        const c = document.createElement('canvas');
        c.width = 64; c.height = 48;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        let anterior = null;
        let firmes = 0;
        timer = setInterval(() => {
          if (!video.current?.videoWidth) return;
          ctx.drawImage(video.current, 0, 0, 64, 48);
          const px = ctx.getImageData(0, 0, 64, 48).data;
          const cinza = new Float32Array(64 * 48);
          let brilho = 0;
          for (let i = 0; i < cinza.length; i++) { cinza[i] = (px[i * 4] + px[i * 4 + 1] + px[i * 4 + 2]) / 3; brilho += cinza[i]; }
          brilho /= cinza.length;
          if (anterior) {
            let dif = 0;
            for (let i = 0; i < cinza.length; i++) dif += Math.abs(cinza[i] - anterior[i]);
            dif /= cinza.length;
            firmes = dif < 5 && brilho > 35 ? firmes + 1 : 0;
            setEstado(firmes >= 3 ? 'firme' : 'mirando');
            if (firmes >= 6) { clearInterval(timer); capturar(); }
          }
          anterior = cinza;
        }, 250);
      } catch {
        if (vivo) setEstado('sem_camera');
      }
    })();
    return () => { vivo = false; clearInterval(timer); stream?.getTracks().forEach((t) => t.stop()); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function capturar() {
    const v = video.current;
    if (!v?.videoWidth) return;
    const c = document.createElement('canvas');
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    vibrar(VIBRA.manobra);
    falar('Foto tirada.');
    c.toBlob((b) => b && aoFoto(b), 'image/jpeg', 0.92);
  }

  return (
    <Tela fala={fala}>
      <Cabecalho titulo="Avisar problema" aoVoltar={aoVoltar} fala={fala} />
      <Progresso passo={1} />
      <Titulo className="so-leitor">Tirar foto do problema</Titulo>
      {estado === 'sem_camera' ? (
        <Aviso tipo="info" icone="camera">A câmera não abriu. Você pode escolher uma foto da galeria.</Aviso>
      ) : (
        <div className="camera">
          <video ref={video} playsInline muted aria-hidden="true" />
          <CaixaFala titulo="Aponte a câmera para o problema." escura />
          <div className="camera-moldura" aria-hidden="true" />
          <p className="camera-status" role="status">
            <Icone nome="camera" />
            {estado === 'firme' ? 'Imagem firme · tirando a foto' : estado === 'abrindo' ? 'Abrindo a câmera…' : 'Segure o celular parado'}
          </p>
        </div>
      )}
      {estado === 'sem_camera' && <div className="empurra" />}
      <div className="camera-acoes">
        <label className="botao-icone camera-galeria" aria-label="Escolher foto da galeria">
          <Icone nome="galeria" />
          <input type="file" accept="image/*" className="so-leitor" onChange={(e) => e.target.files?.[0] && aoFoto(e.target.files[0])} />
        </label>
        {estado !== 'sem_camera' && (
          <button type="button" className="botao-obturador" onClick={capturar} aria-label="Tirar foto agora"><Icone nome="camera" /></button>
        )}
        <span className="espaco-icone" />
      </div>
    </Tela>
  );
}

function carregarImagem(blob) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(blob);
  });
}

/** Página 14: a IA sugere, a pessoa decide. */
export function TipoAviso({ foto, posicao, aoEnviado, aoVoltar, aoRefazer }) {
  const [fase, setFase] = useState('analisando'); // analisando | pronto | rejeitado | enviando
  const [sugestao, setSugestao] = useState(null);
  const [escolha, setEscolha] = useState(null);
  const [mensagem, setMensagem] = useState('');
  const [erro, setErro] = useState(null);
  const [detalhes, setDetalhes] = useState({});
  const resultado = useRef(null);
  const miniatura = useRef(null);

  useEffect(() => {
    let vivo = true;
    falar('Estou olhando a foto. Já te digo o que parece.');
    (async () => {
      try {
        const img = await carregarImagem(foto);
        const a = obterAnalisador();
        const hashes = lerHashes();
        const r1 = await a.analisar(img, 'ACESSIBILIDADE', { hashesAnteriores: hashes });
        if (!vivo) return;
        if (r1.status === 'REJEITADO' && !r1.motivos.includes('FORA_DE_CONTEXTO')) {
          resultado.current = r1;
          setMensagem(r1.mensagem);
          setFase('rejeitado');
          falar(r1.mensagem);
          return;
        }
        const r2 = await a.analisar(img, 'OBSTACULO', { hashesAnteriores: hashes });
        const r3 = await a.analisar(img, 'ALAGAMENTO', { hashesAnteriores: hashes });
        if (!vivo) return;
        const confirmados = [r1, r3, r2].filter((r) => r.status === 'CONFIRMADO');
        const melhor = confirmados[0];
        let tipo = null;
        if (melhor) {
          const ev = melhor.detalhes.evidencias?.[0]?.tipo;
          tipo = EVIDENCIA_PARA_TIPO[ev] ?? { ACESSIBILIDADE: 'buraco', OBSTACULO: 'obstaculo', ALAGAMENTO: 'alagamento' }[melhor.detalhes.categoria];
        }
        resultado.current = melhor ?? [r1, r2, r3].find((r) => r.status !== 'REJEITADO') ?? r1;
        setSugestao(tipo);
        setEscolha(tipo);
        setFase('pronto');
        const t = TIPOS_AVISO.find((x) => x.id === tipo);
        falar(t ? `Parece ${t.falar}. Está certo? A inteligência artificial só sugere. Você decide.` : 'Não consegui reconhecer o problema na foto. Escolha o tipo do problema.');
        if (miniatura.current && resultado.current.processedCanvas) {
          const c = resultado.current.processedCanvas;
          const ctx = miniatura.current.getContext('2d');
          miniatura.current.width = 192; miniatura.current.height = 192;
          const lado = Math.min(c.width, c.height);
          ctx.drawImage(c, (c.width - lado) / 2, (c.height - lado) / 2, lado, lado, 0, 0, 192, 192);
        }
      } catch (e) {
        if (!vivo) return;
        // Sem visão (celular antigo, sem WebAssembly): segue sem foto, a pessoa escolhe.
        resultado.current = null;
        setFase('pronto');
        setMensagem('Não consegui analisar a foto neste celular. Escolha o tipo do problema; a foto não será enviada.');
      }
    })();
    return () => { vivo = false; };
  }, [foto]);

  async function enviar() {
    setFase('enviando');
    setErro(null);
    try {
      const form = new FormData();
      form.set('categoria', escolha);
      form.set('lat', String(posicao.lat));
      form.set('lon', String(posicao.lon));
      if (escolha === 'entrada') form.set('detalhes', JSON.stringify(detalhes));
      const r = resultado.current;
      if (r) {
        form.set('hash_foto', r.hash);
        form.set('validacao', JSON.stringify({ status: r.status, motivos: r.motivos, evidencias: (r.detalhes.evidencias ?? []).map((e) => e.tipo),
          rostos_borrados: (r.detalhes.anonimizacao?.regioes ?? []).filter((x) => x.tipo?.startsWith('ROSTO')).length,
          placas_borradas: (r.detalhes.anonimizacao?.regioes ?? []).filter((x) => x.tipo === 'PLACA').length }));
        // Só a imagem ANONIMIZADA sai do aparelho (sem EXIF: é um canvas).
        form.set('foto', await canvasParaBlob(r.processedCanvas, 'image/jpeg', 0.85), 'aviso.jpg');
      }
      const criado = await api.criarRelato(form);
      if (r?.hash) salvarHash(r.hash);
      aoEnviado(criado, escolha);
    } catch (e) {
      setErro(e.message);
      falar(e.message);
      setFase('pronto');
    }
  }

  const t = TIPOS_AVISO.find((x) => x.id === sugestao);
  const fala = t ? `Parece ${t.falar}. Está certo?` : 'Qual é o problema?';
  return (
    <Tela>
      <Cabecalho titulo="Avisar problema" aoVoltar={aoVoltar} fala={fala} />
      <Progresso passo={2} />
      {fase === 'analisando' && (<><Titulo className="so-leitor">Analisando a foto</Titulo><Carregando texto="Olhando a foto e borrando rostos e placas…" /></>)}
      {fase === 'rejeitado' && (
        <>
          <CaixaFala titulo={<Titulo>Vamos tirar outra foto?</Titulo>}>{mensagem}</CaixaFala>
          <div className="empurra" />
          <Botao icone="camera" onClick={aoRefazer}>Tirar outra foto</Botao>
        </>
      )}
      {(fase === 'pronto' || fase === 'enviando') && (
        <>
          <CaixaFala titulo={<Titulo>{t ? `Parece ${t.falar}. Está certo?` : 'Qual é o problema?'}</Titulo>}>
            A inteligência artificial só sugere. Você decide.
          </CaixaFala>
          {mensagem && <Aviso tipo="info">{mensagem}</Aviso>}
          <div className="grade-opcoes" role="radiogroup" aria-label="Tipo do problema">
            {TIPOS_AVISO.map((x) => (
              <button key={x.id} type="button" role="radio" aria-checked={escolha === x.id} className="opcao" onClick={() => { setEscolha(x.id); falar(x.nome); }}>
                <Icone nome={x.icone} /><span>{x.nome}</span>
              </button>
            ))}
          </div>
          {escolha === 'entrada' && (
            <fieldset className="perguntas-entrada">
              <legend>Como é esta entrada? Toque no que for verdade.</legend>
              <div className="chips">
                {PERGUNTAS_ENTRADA.map((q) => (
                  <button key={q.id} type="button" className="chip" aria-pressed={Boolean(detalhes[q.id])}
                    onClick={() => setDetalhes((d) => ({ ...d, [q.id]: !d[q.id] }))}>
                    {detalhes[q.id] && <Icone nome="check" />}{q.nome}
                  </button>
                ))}
              </div>
            </fieldset>
          )}
          {resultado.current && !erro && (
            <div className="miniatura"><canvas ref={miniatura} aria-hidden="true" /><span>Esta é a foto que será enviada. Rostos e placas de carro são borrados automaticamente.</span></div>
          )}
          {erro && <Aviso tipo="erro">{erro}</Aviso>}
          <div className="empurra" />
          <Botao icone="alerta" variante="alerta" disabled={!escolha || fase === 'enviando'} onClick={enviar}>
            {fase === 'enviando' ? 'Enviando…' : 'Enviar aviso'}
          </Botao>
        </>
      )}
    </Tela>
  );
}

/** Página 15: aviso enviado e o que acontece depois. */
export function AvisoEnviado({ tipo, navegando, aoVoltar, aoMeusAvisos }) {
  const t = TIPOS_AVISO.find((x) => x.id === tipo);
  const fala = `Obrigado por avisar! Vou perguntar a quem passar por aqui se ${t ? t.falar : 'o problema'} ainda está lá.`;
  const etapas = [
    ['Enviado', 'Agora', true], ['Confirmação', 'Precisa de 3 pessoas', false],
    ['Prefeitura', 'Abrimos o chamado por você', false], ['Consertado', 'Você recebe um aviso', false],
  ];
  return (
    <Tela fala={fala}>
      <Cabecalho titulo="Aviso enviado" marca fala={fala} />
      <Progresso passo={3} />
      <div className="circulo-ok"><Icone nome="ok" /></div>
      <Titulo>Obrigado por avisar!</Titulo>
      <p>Vou perguntar a quem passar por aqui se {t ? t.falar : 'o problema'} ainda está lá.</p>
      <ol className="linha-tempo cartao" aria-label="O que acontece agora">
        {etapas.map(([nome, sub, feito]) => (
          <li key={nome} className={feito ? 'feito' : ''}><span className="bolinha" aria-hidden="true" />
            <div><strong>{nome}{feito ? '' : <span className="so-leitor"> (próxima etapa)</span>}</strong><span>{sub}</span></div></li>
        ))}
      </ol>
      <div className="empurra" />
      <Rodape>
        <Botao icone="caminho" onClick={aoVoltar}>{navegando ? 'Voltar para a rota' : 'Voltar ao início'}</Botao>
        <Botao icone="lista" variante="secundario" onClick={aoMeusAvisos}>Ver meus avisos</Botao>
      </Rodape>
    </Tela>
  );
}

export { Marca };
