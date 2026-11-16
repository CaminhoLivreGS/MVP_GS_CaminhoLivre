import { Icone } from './Icone.jsx';

/** Barra inferior das telas principais (como em apps de mapa). */
const ITENS = [
  { id: 'home', nome: 'Início', icone: 'casa' },
  { id: 'avisar', nome: 'Avisar', icone: 'alerta', classe: 'nav-avisar' },
  { id: 'meus', nome: 'Meus avisos', icone: 'lista' },
  { id: 'ajustes', nome: 'Ajustes', icone: 'ajustes' },
];

export function BarraNav({ atual, aoIr }) {
  return (
    <nav className="barra-nav" aria-label="Menu principal">
      {ITENS.map((i) => (
        <button key={i.id} type="button" className={i.classe} aria-current={atual === i.id ? 'page' : undefined} onClick={() => aoIr(i.id)}>
          <Icone nome={i.icone} />{i.nome}
        </button>
      ))}
    </nav>
  );
}
