/**
 * Ícones do guia visual (traço 2, cantos arredondados). Sempre decorativos:
 * o nome acessível vem do texto do botão ou de aria-label.
 */
const P = {
  som: <><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" /><path d="M15.5 9a4 4 0 0 1 0 6" /><path d="M18 6.5a7.5 7.5 0 0 1 0 11" /></>,
  somMudo: <><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" /><path d="M16 9.5l5 5M21 9.5l-5 5" /></>,
  voltar: <path d="M15 5l-7 7 7 7" />,
  seta: <><path d="M4 12h15" /><path d="M13 6l6 6-6 6" /></>,
  setaCima: <><path d="M12 20V5" /><path d="M6 11l6-6 6 6" /></>,
  setaEsq: <><path d="M20 12H5" /><path d="M11 6l-6 6 6 6" /></>,
  retorno: <><path d="M8 20V9a4 4 0 0 1 8 0v4" /><path d="M12.5 10.5L16 14l3.5-3.5" /></>,
  fechar: <><path d="M6 6l12 12" /><path d="M18 6L6 18" /></>,
  mic: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0" /><path d="M12 17.5V21" /></>,
  casa: <><path d="M4 11l8-7 8 7" /><path d="M6 9.5V20h12V9.5" /></>,
  ubs: <><rect x="4" y="4" width="16" height="16" rx="3.5" /><path d="M12 8v8M8 12h8" /></>,
  estacao: <><rect x="6" y="3" width="12" height="13" rx="3" /><path d="M6 10h12" /><circle cx="9.5" cy="13" r=".6" /><circle cx="14.5" cy="13" r=".6" /><path d="M8.5 16L6.5 20M15.5 16l2 4" /></>,
  onibus: <><rect x="5" y="3" width="14" height="15" rx="3" /><path d="M5 11h14" /><circle cx="8.5" cy="14.5" r=".6" /><circle cx="15.5" cy="14.5" r=".6" /><path d="M8 18v2.5M16 18v2.5M9 6.5h6" /></>,
  carro: <><path d="M4 16v-4l2-5h12l2 5v4z" /><path d="M4 12h16" /><circle cx="7.5" cy="14" r=".6" /><circle cx="16.5" cy="14" r=".6" /><path d="M6 16v3M18 16v3" /></>,
  lugar: <><path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z" /><circle cx="12" cy="10" r="2.4" /></>,
  chuva: <><path d="M7 15a4 4 0 0 1-.5-8A5.5 5.5 0 0 1 17 7.5a3.5 3.5 0 0 1 0 7.5z" /><path d="M8.5 18l-1 2.5M12.5 18l-1 2.5M16.5 18l-1 2.5" /></>,
  muleta: <><path d="M8 3l3 18" /><path d="M16 3l-3 18" /><path d="M6 3h4" /><path d="M14 3h4" /><path d="M8.6 10h3" /><path d="M12.4 10h3" /></>,
  escada: <><path d="M3 20h5v-5h5v-5h5V5h3" /><path d="M3 20h18" /></>,
  plano: <><path d="M3 16h18" /><path d="M3 20h18" opacity=".5" /><circle cx="12" cy="9" r="3" /></>,
  grafico: <><path d="M4 20V10" /><path d="M10 20V4" /><path d="M16 20v-7" /><path d="M2 20h20" /></>,
  bengala: <><circle cx="11" cy="4" r="1.8" /><path d="M11 7v6l-2.5 7" /><path d="M11 13l2.5 7" /><path d="M11 9l3.5 2.5V20" /></>,
  cadeira: <><circle cx="10" cy="4" r="1.8" /><path d="M10 7v6h5.5l2.5 5" /><path d="M10 10h5" /><path d="M7.5 10.5a5.5 5.5 0 1 0 7 7" /></>,
  olho: <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="3" /></>,
  caminho: <><circle cx="6" cy="18" r="2.2" /><circle cx="18" cy="6" r="2.2" /><path d="M8.2 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.8" /></>,
  ok: <><circle cx="12" cy="12" r="9" /><path d="M7.8 12.3l2.8 2.8 5.6-5.8" /></>,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  mapa: <><path d="M3.5 6.5l5-2 7 2.5 5-2v13l-5 2-7-2.5-5 2z" /><path d="M8.5 4.5v13M15.5 7v13" /></>,
  repetir: <><path d="M4.5 11a7.5 7.5 0 0 1 13-4.3L19.5 9" /><path d="M19.5 4v5h-5" /><path d="M19.5 13a7.5 7.5 0 0 1-13 4.3L4.5 15" /><path d="M4.5 20v-5h5" /></>,
  alerta: <><path d="M12 3.5l9.5 16.5h-19z" /><path d="M12 10v4.5" /><circle cx="12" cy="17.3" r=".4" /></>,
  buraco: <><path d="M3 14h4M17 14h4" /><ellipse cx="12" cy="14" rx="5" ry="2.6" /><path d="M12 8.5V5.5M9.3 9.2L8 7M14.7 9.2L16 7" /></>,
  obstaculo: <><path d="M10 4h4l5 15H5z" /><path d="M7.6 12h8.8" /><path d="M3.5 19.5h17" /></>,
  alagamento: <><path d="M12 3s-3 3.6-3 5.6a3 3 0 0 0 6 0C15 6.6 12 3 12 3z" /><path d="M4 14.5c2.7 0 2.7-1.5 5.3-1.5s2.7 1.5 5.4 1.5 2.6-1.5 5.3-1.5" /><path d="M4 19c2.7 0 2.7-1.5 5.3-1.5s2.7 1.5 5.4 1.5 2.6-1.5 5.3-1.5" /></>,
  semRampa: <><path d="M3.5 18.5h5v-5h6" /><path d="M16 5l4 4M20 5l-4 4" /></>,
  luzApagada: <><path d="M7 20V5h7.5" /><path d="M12 5l3 3h4l-1.5-3" /><path d="M4 4l15 16" /></>,
  outro: <><rect x="3.5" y="6" width="17" height="5" rx="1" /><path d="M7 6l-3 5M12 6l-3 5M17 6l-3 5M20.5 6l-3 5" /><path d="M6.5 11v8M17.5 11v8" /></>,
  camera: <><path d="M3.5 8.5h3.5l2-3h6l2 3h3.5v11h-17z" /><circle cx="12" cy="13.5" r="3.5" /></>,
  galeria: <><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><circle cx="9" cy="10" r="1.6" /><path d="M20.5 16l-5-5-9 8.5" /></>,
  bom: <><path d="M7 11v9H4v-9z" /><path d="M7 11l4-7a2 2 0 0 1 2.8 2.3L13 10h5.5a2 2 0 0 1 2 2.4l-1.4 6A2 2 0 0 1 17.2 20H7" /></>,
  ruim: <><path d="M7 13V4H4v9z" /><path d="M7 13l4 7a2 2 0 0 0 2.8-2.3L13 14h5.5a2 2 0 0 0 2-2.4l-1.4-6A2 2 0 0 0 17.2 4H7" /></>,
  sino: <><path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15z" /><path d="M10 20.5a2 2 0 0 0 4 0" /></>,
  letra: <><path d="M4 18L9 6l5 12M5.8 14h6.4" /><path d="M15 18v-5.5a2.5 2.5 0 0 1 5 0V18M15 15h5" /></>,
  pessoa: <><circle cx="12" cy="8" r="3.8" /><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0" /></>,
  lista: <><path d="M9 6h11M9 12h11M9 18h11" /><circle cx="4.5" cy="6" r=".8" /><circle cx="4.5" cy="12" r=".8" /><circle cx="4.5" cy="18" r=".8" /></>,
  ajustes: <><circle cx="12" cy="12" r="3" /><path d="M12 2.8v2.4M12 18.8v2.4M21.2 12h-2.4M5.2 12H2.8M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7M18.5 18.5l-1.7-1.7M7.2 7.2L5.5 5.5" /></>,
  pausa: <><path d="M8 5v14M16 5v14" /></>,
  play: <path d="M7 4.5v15l12-7.5z" />,
  ajuda: <><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.6v.6" /><circle cx="12" cy="17" r=".4" /></>,
  porta: <><path d="M6 21V3.5h11V21" /><path d="M3.5 21h17" /><circle cx="13.6" cy="12.5" r=".8" /></>,
  saida: <><path d="M10 4H5v16h5" /><path d="M14 8l4 4-4 4" /><path d="M18 12H9" /></>,
  qr: <><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><path d="M14 14h2.5v2.5H14zM17.5 17.5H20V20h-2.5zM14 19.5h1.5M19.5 14v1.5" /></>,
  compartilhar: <><circle cx="17.5" cy="5.5" r="2.3" /><circle cx="6.5" cy="12" r="2.3" /><circle cx="17.5" cy="18.5" r="2.3" /><path d="M8.5 10.8l7-4M8.5 13.2l7 4" /></>,
  sol: <><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8" /></>,
  teclado: <><rect x="2.5" y="6" width="19" height="12" rx="2" /><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" /></>,
};

export function Icone({ nome, className = '', titulo }) {
  return (
    <svg className={`icone ${className}`.trim()} viewBox="0 0 24 24" aria-hidden={titulo ? undefined : 'true'}
      role={titulo ? 'img' : undefined} aria-label={titulo} focusable="false">
      {P[nome] ?? P.outro}
    </svg>
  );
}

/** Marca: 4 pontos (Braille) + caminho. */
export function Marca({ tamanho = 44 }) {
  return (
    <svg className="marca-icone" width={tamanho} height={tamanho} viewBox="0 0 48 48" aria-hidden="true">
      <rect width="48" height="48" rx="12" fill="var(--amarelo)" />
      <g fill="var(--escuro)">
        <circle cx="12" cy="31" r="2.3" /><circle cx="18" cy="31" r="2.3" /><circle cx="12" cy="37" r="2.3" /><circle cx="18" cy="37" r="2.3" />
      </g>
      <path d="M22 37h2.5a4.5 4.5 0 0 0 4.5-4.5V20a5 5 0 0 1 5-5" fill="none" stroke="var(--escuro)" strokeWidth="5" strokeLinecap="round" />
      <circle cx="35" cy="14" r="5" fill="var(--escuro)" />
    </svg>
  );
}
