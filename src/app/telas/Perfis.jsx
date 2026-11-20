import { Botao, Cabecalho, CaixaFala, Rodape, Tela, Titulo } from '../componentes/base.jsx';
import { Icone } from '../componentes/Icone.jsx';
import { resumoPerfil } from '../servicos/preferencias.js';
import { falar } from '../servicos/voz.js';

const ICONE_PERFIL = { cadeira: 'cadeira', muletas: 'muleta', bengala: 'bengala', baixa_visao: 'olho', sem_apoio: 'caminho' };

/**
 * Perfis de caminhada salvos neste celular. Útil para quem planeja a rota de outra pessoa
 * (filho que leva a mãe, cuidador). Tocar num perfil passa a usar ele nas rotas.
 */
export function Perfis({ prefs, aoUsar, aoEditar, aoNovo, aoApagar, aoVoltar }) {
  const lista = prefs.perfisSalvos ?? [];
  const ativo = lista.find((p) => p.id === prefs.perfilAtivo);
  const fala = lista.length
    ? `Perfis de caminhada. ${ativo ? `Agora as rotas são para ${ativo.nome}.` : ''} Toque em um perfil para usar, ou cadastre outro.`
    : 'Você ainda não tem perfil. Cadastre o seu para receber rotas sob medida.';
  return (
    <Tela fala={fala}>
      <Cabecalho titulo="Perfis" aoVoltar={aoVoltar} fala={fala} />
      <CaixaFala titulo={<Titulo className="titulo-fala">Para quem é a rota?</Titulo>}>
        Os perfis ficam só neste celular. Dá para ter um para você e outro para quem você acompanha.
      </CaixaFala>
      {lista.length === 0 && <p className="sub">Nenhum perfil cadastrado ainda.</p>}
      <ul className="lista-perfis">
        {lista.map((p) => {
          const usando = p.id === prefs.perfilAtivo;
          return (
            <li key={p.id} className={`cartao-perfil ${usando ? 'ativo' : ''}`}>
              <button type="button" className="cartao-perfil-usar" aria-pressed={usando}
                onClick={() => { aoUsar(p.id); falar(`Rotas para ${p.nome}.`); }}>
                <span className="avatar-perfil" aria-hidden="true"><Icone nome={ICONE_PERFIL[p.perfis?.[0]] ?? 'pessoa'} /></span>
                <span className="cartao-perfil-texto">
                  <strong>{p.nome}</strong>
                  <span>{resumoPerfil(p)}</span>
                </span>
                {usando && <span className="selo-usando"><Icone nome="check" />Em uso</span>}
              </button>
              <div className="cartao-perfil-acoes">
                <button type="button" className="link-simples" onClick={() => aoEditar(p.id)}>Editar</button>
                {lista.length > 1 && (
                  <button type="button" className="link-simples" onClick={() => {
                    if (window.confirm(`Apagar o perfil "${p.nome}"?`)) aoApagar(p.id);
                  }}>Apagar</button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <div className="empurra" />
      <Rodape fixo>
        <Botao icone="pessoa" variante={lista.length ? 'secundario' : 'primario'} onClick={aoNovo}>
          {lista.length ? 'Cadastrar outro perfil' : 'Cadastrar meu perfil'}
        </Botao>
      </Rodape>
    </Tela>
  );
}

export { ICONE_PERFIL };
