import { useEffect, useState } from 'react';

/**
 * Moldura de Samsung Galaxy S24 Ultra para ver o app no computador.
 * Em telas estreitas (celular de verdade) a moldura some via CSS
 * (display: contents / none) e o app ocupa a tela inteira. Só a tela rola;
 * o aparelho fica parado e é ajustado (zoom) para caber na janela.
 */
const LARGURA = 436 + 8; // 412 de tela (viewport real do S24 Ultra) + bordas + botões
const ALTURA = 916;      // 892 de tela + bordas

function horaAgora() {
  return new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export function Celular({ children }) {
  const [hora, setHora] = useState(horaAgora);
  useEffect(() => {
    const t = setInterval(() => setHora(horaAgora()), 20000);
    const ajustar = () => {
      const s = Math.min(1, (window.innerHeight - 70) / ALTURA, (window.innerWidth - 32) / LARGURA);
      document.documentElement.style.setProperty('--zoom-celular', String(Math.max(0.5, s)));
    };
    ajustar();
    window.addEventListener('resize', ajustar);
    return () => { clearInterval(t); window.removeEventListener('resize', ajustar); };
  }, []);
  return (
    <div className="celular">
      <div className="celular-tela">
        <div className="celular-status" aria-hidden="true">
          <span className="celular-hora">{hora}</span>
          <span className="celular-camera" />
          <span className="celular-icones">
            <svg viewBox="0 0 16 12" width="15" height="12"><path d="M8 11.5l2.4-2.9a3.6 3.6 0 0 0-4.8 0z" /><path d="M8 6.2a6 6 0 0 1 4.1 1.6l1.4-1.7A8.3 8.3 0 0 0 8 4a8.3 8.3 0 0 0-5.5 2.1l1.4 1.7A6 6 0 0 1 8 6.2z" /><path d="M8 1.8a10.5 10.5 0 0 1 6.9 2.6L16 3A12.6 12.6 0 0 0 8 0 12.6 12.6 0 0 0 0 3l1.1 1.4A10.5 10.5 0 0 1 8 1.8z" /></svg>
            <svg viewBox="0 0 12 12" width="12" height="12"><path d="M12 0v12H0z" /></svg>
            <span className="celular-bateria">87%</span>
            <svg viewBox="0 0 8 14" width="8" height="14"><rect x="2.5" y="0" width="3" height="1.5" rx=".5" /><rect x=".5" y="1.5" width="7" height="12" rx="1.5" fill="none" stroke="currentColor" /><rect x="1.8" y="3.5" width="4.4" height="8.8" rx=".8" /></svg>
          </span>
        </div>
        {children}
        <span className="celular-home" aria-hidden="true" />
      </div>
    </div>
  );
}
