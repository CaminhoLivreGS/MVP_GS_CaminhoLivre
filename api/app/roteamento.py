"""Roteamento a pé por perfil de mobilidade.

Ideia: o custo de cada trecho é o comprimento multiplicado por fatores que
dependem do perfil (escada, piso, inclinação, falta de calçada, relatos de
problemas, alagamento com chuva). O A* encontra o menor custo. A rota
"comum" (só distância) é calculada junto para explicar cada desvio.

Decisões críticas ficam aqui, no código, auditáveis. A IA generativa só
reescreve as falas (ver assistente/).
"""
from __future__ import annotations

import heapq
import math
from dataclasses import dataclass, field

from .grafo import (F_ALAGA, F_GUIA_ELEV, F_GUIA_REB, F_SEMAFORO, F_SONORO, F_TATIL, F_TRAVESSIA,
                    VIAS_GRANDES, Grafo, dist_ponto_segmento, distancia_m, rumo)

PERFIS = ("bengala", "cadeira", "muletas", "baixa_visao", "sem_apoio")
VELOCIDADE_MS = {"cadeira": 0.85, "bengala": 0.75, "muletas": 0.7, "baixa_visao": 0.85, "sem_apoio": 1.2}
# Preferências que valem para qualquer perfil (pitch: "restrição a escadas, caminhos planos e iluminados").
PREFERENCIAS = ("sem_escada", "plano", "iluminado")

# Fatores multiplicativos por perfil. Com vários perfis, vale o maior fator.
FATOR = {
    "escada":          {"cadeira": math.inf, "bengala": 15.0, "muletas": 20.0, "baixa_visao": 2.0, "sem_apoio": 1.1},
    "sup_irregular":   {"cadeira": 2.5, "bengala": 1.8, "muletas": 2.0, "baixa_visao": 1.4, "sem_apoio": 1.05},
    "sup_ruim":        {"cadeira": 6.0, "bengala": 3.0, "muletas": 3.5, "baixa_visao": 2.0, "sem_apoio": 1.2},
    "sem_calcada":     {"cadeira": 2.0, "bengala": 1.6, "muletas": 1.6, "baixa_visao": 1.8, "sem_apoio": 1.2},
    "sem_calcada_via_grande": {"cadeira": 3.0, "bengala": 2.5, "muletas": 2.5, "baixa_visao": 3.0, "sem_apoio": 1.5},
    "relato_confirmado": {"cadeira": 40.0, "bengala": 30.0, "muletas": 30.0, "baixa_visao": 30.0, "sem_apoio": 8.0},
    "relato_verificacao": {"cadeira": 1.6, "bengala": 1.5, "muletas": 1.5, "baixa_visao": 1.5, "sem_apoio": 1.1},
    "escuro_noite":    {"cadeira": 1.3, "bengala": 1.4, "muletas": 1.4, "baixa_visao": 1.2, "sem_apoio": 1.3},
}
# Penalidade (em metros equivalentes) ao passar por uma travessia.
TRAVESSIA_SEM_SEMAFORO_M = {"cadeira": 25, "bengala": 35, "muletas": 35, "baixa_visao": 120, "sem_apoio": 5}
GUIA_ELEVADA_M = {"cadeira": 400, "bengala": 30, "muletas": 40, "baixa_visao": 0, "sem_apoio": 0}
# Preferência "ruas iluminadas": vale de dia também (a pessoa pode voltar à noite).
FATOR_ESCURO_PREFERENCIA = {"nao": 1.8, "sem_dado": 1.15}

CATEGORIAS_BARREIRA = {"buraco", "calcada_irregular", "obstaculo", "sem_rampa", "alagamento", "obra"}
NOMES_RELATO = {
    "buraco": "um buraco na calçada", "calcada_irregular": "calçada irregular", "obstaculo": "um obstáculo na calçada",
    "sem_rampa": "falta de rampa", "alagamento": "alagamento", "luz_apagada": "iluminação apagada", "obra": "obra na calçada",
}
RAIO_RELATO_M = 14.0
RAIO_ALERTA_M = 18.0


class SemRota(Exception):
    pass


@dataclass
class Contexto:
    perfis: tuple[str, ...]
    chuva_forte: bool = False
    noite: bool = False
    relatos: list[dict] = field(default_factory=list)
    preferencias: tuple[str, ...] = ()
    _perigo: dict[int, list[dict]] = field(default_factory=dict)

    def fator(self, chave: str) -> float:
        tabela = FATOR[chave]
        if chave == "escada" and "sem_escada" in self.preferencias:
            return math.inf
        return max((tabela[p] for p in self.perfis), default=1.0)

    def quer(self, preferencia: str) -> bool:
        return preferencia in self.preferencias

    def metros(self, tabela: dict) -> float:
        return max((tabela[p] for p in self.perfis), default=0.0)


def indexar_relatos(g: Grafo, ctx: Contexto) -> None:
    """Associa cada relato ativo às arestas a até RAIO_RELATO_M."""
    ctx._perigo = {}
    for r in ctx.relatos:
        if r["status"] not in ("confirmado", "em_verificacao"):
            continue
        for i, _d, _t in g.arestas_perto(r["lat"], r["lon"], RAIO_RELATO_M):
            ctx._perigo.setdefault(i, []).append(r)


def custo_aresta(g: Grafo, i: int, ctx: Contexto) -> float:
    e = g.arestas[i]
    if not ctx.perfis:  # rota comum: só distância
        return e.comp
    f = 1.0
    if e.escada:
        f = max(f, ctx.fator("escada"))
        if math.isinf(f):
            return math.inf
    if e.sup == "irregular":
        f *= ctx.fator("sup_irregular")
    elif e.sup == "ruim":
        f *= ctx.fator("sup_ruim")
    if e.calc == "nao":
        f *= ctx.fator("sem_calcada_via_grande" if e.tipo in VIAS_GRANDES else "sem_calcada")
    s = e.inc
    if "cadeira" in ctx.perfis:
        f *= 25.0 if s > 12 else 6.0 if s > 8 else 2.0 if s > 5 else 1.0
    if "bengala" in ctx.perfis or "muletas" in ctx.perfis:
        f *= 1.0 + 0.06 * max(0.0, s - 3)
    if ctx.quer("plano"):
        f *= 1.0 + 0.15 * max(0.0, s - 2)
    if ctx.noite and e.ilum == "nao":
        f *= ctx.fator("escuro_noite")
    if ctx.quer("iluminado"):
        f *= FATOR_ESCURO_PREFERENCIA.get(e.ilum, 1.0)
    if e.tipo in ("footway", "pedestrian", "living_street"):
        f *= 0.9
    for r in ctx._perigo.get(i, ()):
        if r["categoria"] == "luz_apagada":
            if ctx.noite or ctx.quer("iluminado"):
                f *= ctx.fator("escuro_noite")
            continue
        if r["categoria"] == "alagamento" and not ctx.chuva_forte and r["status"] != "confirmado":
            continue
        f *= ctx.fator("relato_confirmado" if r["status"] == "confirmado" else "relato_verificacao")
    if ctx.chuva_forte and (g.flags[e.u] & F_ALAGA or g.flags[e.v] & F_ALAGA):
        f *= 6.0
    return e.comp * f


def custo_no(g: Grafo, n: int, ctx: Contexto) -> float:
    if not ctx.perfis:
        return 0.0
    fl = g.flags[n]
    extra = 0.0
    if fl & F_TRAVESSIA and not fl & F_SEMAFORO:
        extra += ctx.metros(TRAVESSIA_SEM_SEMAFORO_M)
    if fl & F_GUIA_ELEV:
        extra += ctx.metros(GUIA_ELEVADA_M)
    return extra


def a_estrela(g: Grafo, origem: int, destino: int, ctx: Contexto) -> tuple[list[int], list[int]]:
    lat_d, lon_d = g.lat[destino], g.lon[destino]
    h = lambda n: 0.9 * distancia_m(g.lat[n], g.lon[n], lat_d, lon_d)  # noqa: E731 (0.9 = menor fator)
    dist = {origem: 0.0}
    veio: dict[int, tuple[int, int]] = {}
    fila = [(h(origem), 0.0, origem)]
    fechados = set()
    while fila:
        _, d, n = heapq.heappop(fila)
        if n == destino:
            break
        if n in fechados:
            continue
        fechados.add(n)
        for viz, ai in g.adj[n]:
            if viz in fechados:
                continue
            c = custo_aresta(g, ai, ctx)
            if math.isinf(c):
                continue
            nd = d + c + custo_no(g, viz, ctx)
            if nd < dist.get(viz, math.inf):
                dist[viz] = nd
                veio[viz] = (n, ai)
                heapq.heappush(fila, (nd + h(viz), nd, viz))
    if destino not in dist:
        raise SemRota("Não encontrei um caminho possível para esse perfil.")
    nos, arestas = [destino], []
    while nos[-1] != origem:
        ant, ai = veio[nos[-1]]
        arestas.append(ai)
        nos.append(ant)
    return nos[::-1], arestas[::-1]


# ---------------------------------------------------------------------------
# Montagem da resposta
# ---------------------------------------------------------------------------
def _arred(m: float) -> int:
    return int(round(m / 10.0) * 10) if m >= 30 else int(round(m))


def falar_distancia(m: float) -> str:
    if m >= 1000:
        km = f"{round(m / 100) / 10:.1f}".replace(".", ",").replace(",0", "")
        return f"{km} quilômetro" + ("s" if m >= 2000 else "")
    if m >= 100:
        return f"{int(round(m / 50) * 50)} metros"
    return f"{_arred(m)} metros"


def _nome_rua(nome: str) -> str:
    return nome or "calçada"


def _rumo_em(coords, acum, alvo_m, para_frente: bool, janela=15.0):
    """Rumo do trecho de ~janela metros antes/depois da distância alvo_m."""
    import bisect
    k = bisect.bisect_left(acum, alvo_m)
    k = min(max(k, 0), len(coords) - 1)
    if para_frente:
        j = k
        while j < len(coords) - 1 and acum[j] - acum[k] < janela:
            j += 1
        a, b = coords[k], coords[j]
    else:
        j = k
        while j > 0 and acum[k] - acum[j] < janela:
            j -= 1
        a, b = coords[j], coords[k]
    if a == b:
        return None
    return rumo(a[0], a[1], b[0], b[1])


def _virada(r_in, r_out) -> str:
    if r_in is None or r_out is None:
        return "siga"
    d = (r_out - r_in + 540) % 360 - 180
    if abs(d) < 35:
        return "siga"
    if abs(d) > 150:
        return "volte"
    return "vire_direita" if d > 0 else "vire_esquerda"


def _predominante(pares) -> str:
    soma: dict[str, float] = {}
    for valor, peso in pares:
        soma[valor] = soma.get(valor, 0) + peso
    return max(soma, key=soma.get) if soma else "sem_dado"


def montar_rota(g: Grafo, nos: list[int], arestas: list[int], ctx: Contexto,
                origem: dict, destino: dict) -> dict:
    coords = [[g.lat[n], g.lon[n]] for n in nos]
    acum = [0.0]
    for e_i in arestas:
        acum.append(acum[-1] + g.arestas[e_i].comp)
    total = acum[-1]

    # 1) Trechos: arestas consecutivas com o mesmo nome de rua.
    pernas = []
    for k, ai in enumerate(arestas):
        e = g.arestas[ai]
        if pernas and pernas[-1]["nome"] == e.nome and pernas[-1]["travessia"] == e.travessia:
            pernas[-1]["fim"] = k + 1
            pernas[-1]["arestas"].append(ai)
        else:
            pernas.append({"nome": e.nome, "travessia": e.travessia, "ini": k, "fim": k + 1, "arestas": [ai]})
    # Funde trechos curtos (< 15 m) sem nome no anterior (ruído de mapeamento).
    fundidas = []
    for p in pernas:
        comp = acum[p["fim"]] - acum[p["ini"]]
        if fundidas and not p["travessia"] and (comp < 15 or (not p["nome"] and comp < 30)):
            fundidas[-1]["fim"] = p["fim"]
            fundidas[-1]["arestas"] += p["arestas"]
        else:
            fundidas.append(p)
    pernas = fundidas

    nos_rota = set(nos)
    manobras, trechos = [], []
    for ordem, p in enumerate(pernas):
        ini_m, fim_m = acum[p["ini"]], acum[p["fim"]]
        comp = fim_m - ini_m
        no_ini = nos[p["ini"]]
        es = [g.arestas[a] for a in p["arestas"]]
        nos_perna = nos[p["ini"]:p["fim"] + 1]
        semaforo = any(g.flags[n] & F_SEMAFORO for n in nos_perna)
        sonoro = any(g.flags[n] & F_SONORO for n in nos_perna)
        rua = _nome_rua(p["nome"])
        if p["travessia"]:
            tipo = "atravesse"
            fala = ("Atravesse na faixa com semáforo sonoro." if sonoro else
                    "Atravesse na faixa com semáforo." if semaforo else
                    "Atravesse na faixa com atenção. Não há semáforo registrado.")
        elif ordem == 0:
            tipo = "inicio"
            fala = (f"Siga pela {rua} por {falar_distancia(comp)}." if p["nome"]
                    else f"Siga em frente pela calçada por {falar_distancia(comp)}.")
        else:
            tipo = _virada(_rumo_em(coords, acum, ini_m, False), _rumo_em(coords, acum, ini_m, True))
            na = f" na {rua}" if p["nome"] else ""
            fala = {"siga": f"Continue em frente pela {rua}." if p["nome"] else "Continue em frente.",
                    "vire_direita": f"Vire à direita{na}.",
                    "vire_esquerda": f"Vire à esquerda{na}.",
                    "volte": "Faça o retorno."}[tipo]
            if comp >= 40:
                fala += f" Siga por {falar_distancia(comp)}."
        manobras.append({"tipo": tipo, "rua": rua, "fala": fala, "lat": g.lat[no_ini], "lon": g.lon[no_ini],
                         "acumulado_m": round(ini_m, 1), "distancia_m": round(comp, 1),
                         "semaforo": semaforo, "sonoro": sonoro})
        trecho = {
            "ordem": ordem + 1, "instrucao": tipo, "rua": rua, "distancia_m": round(comp),
            "superficie": _predominante((e.sup, e.comp) for e in es),
            "calcada": _predominante((e.calc, e.comp) for e in es),
            "inclinacao_pct": round(max(e.inc for e in es), 1),
            "iluminacao": _predominante((e.ilum, e.comp) for e in es),
            "escada": any(e.escada for e in es),
        }
        if p["travessia"]:
            trecho["travessia"] = {"semaforo": semaforo, "sonoro": sonoro,
                                   "guia_rebaixada": any(g.flags[n] & F_GUIA_REB for n in nos_perna),
                                   "piso_tatil": any(g.flags[n] & F_TATIL for n in nos_perna)}
        trechos.append(trecho)

        # Travessia de via grande no meio da perna (seguindo reto no cruzamento).
        for k in range(p["ini"] + 1, p["fim"]):
            n = nos[k]
            for viz, ai in g.adj[n]:
                ea = g.arestas[ai]
                if viz in nos_rota or not ea.nome or ea.nome == p["nome"]:
                    continue
                if ea.tipo in VIAS_GRANDES or ea.tipo == "tertiary" or g.flags[n] & F_TRAVESSIA:
                    if ea.tipo in ("footway", "path", "steps", "service"):
                        continue
                    sem = bool(g.flags[n] & F_SEMAFORO)
                    son = bool(g.flags[n] & F_SONORO)
                    manobras.append({
                        "tipo": "atravesse", "rua": ea.nome, "lat": g.lat[n], "lon": g.lon[n],
                        "acumulado_m": round(acum[k], 1), "distancia_m": 0.0, "semaforo": sem, "sonoro": son,
                        "fala": (f"Atravesse a {ea.nome} na faixa com semáforo sonoro." if son else
                                 f"Atravesse a {ea.nome} na faixa com semáforo." if sem else
                                 f"Atravesse a {ea.nome} com atenção. Não há semáforo registrado."),
                    })
                    break
    # "Continue em frente" sem nome de rua não orienta ninguém: some.
    manobras = [m for m in manobras if not (m["tipo"] == "siga" and m["rua"] == "calçada")]
    manobras.sort(key=lambda m: m["acumulado_m"])
    # remove travessias duplicadas da mesma rua muito próximas
    limpas = []
    for m in manobras:
        if limpas and m["tipo"] == "atravesse" and limpas[-1]["tipo"] == "atravesse" \
                and m["rua"] == limpas[-1]["rua"] and m["acumulado_m"] - limpas[-1]["acumulado_m"] < 40:
            continue
        limpas.append(m)
    manobras = limpas
    manobras.append({"tipo": "chegada", "rua": destino.get("nome", "destino"), "lat": coords[-1][0], "lon": coords[-1][1],
                     "acumulado_m": round(total, 1), "distancia_m": 0.0, "semaforo": False, "sonoro": False,
                     "fala": f"Você chegou em {destino.get('nome', 'seu destino')}."})

    # 2) Alertas: relatos ativos perto do caminho, na ordem em que aparecem.
    alertas = []
    for r in ctx.relatos:
        if r["status"] not in ("confirmado", "em_verificacao"):
            continue
        melhor = None
        for k in range(len(coords) - 1):
            d, t = dist_ponto_segmento(r["lat"], r["lon"], *coords[k], *coords[k + 1])
            if d <= RAIO_ALERTA_M and (melhor is None or d < melhor[0]):
                melhor = (d, acum[k] + t * (acum[k + 1] - acum[k]))
        if melhor:
            alertas.append({"id": r["id"], "rua": r.get("rua") or "", "tipo": r["categoria"],
                            "descricao": NOMES_RELATO.get(r["categoria"], r["categoria"]),
                            "status_relato": r["status"], "confirmacoes": r.get("confirmacoes", 0),
                            "lado_seguro": r.get("lado_seguro"), "lat": r["lat"], "lon": r["lon"],
                            "acumulado_m": round(melhor[1], 1)})
    alertas.sort(key=lambda a: a["acumulado_m"])

    # 3) Trechos sem dado de calçada nem piso.
    sem_dado: dict[str, float] = {}
    for ai in arestas:
        e = g.arestas[ai]
        if e.sup == "sem_dado" and e.calc == "sem_dado" and e.nome:
            sem_dado[e.nome] = sem_dado.get(e.nome, 0) + e.comp
    sem_dado_lista = [n for n, c in sorted(sem_dado.items(), key=lambda x: -x[1]) if c >= 60][:3]
    cobertura = sum(g.arestas[a].comp for a in arestas if g.arestas[a].sup != "sem_dado" or g.arestas[a].calc != "sem_dado")

    vel = min((VELOCIDADE_MS[p] for p in ctx.perfis), default=1.1)
    return {
        "origem": origem, "destino": destino, "perfil": list(ctx.perfis), "preferencias": list(ctx.preferencias),
        "distancia_m": round(total), "duracao_min": max(1, round(total / vel / 60)),
        "escadas": sum(1 for a in arestas if g.arestas[a].escada),
        "trechos": trechos, "manobras": manobras, "alertas_no_caminho": alertas,
        "trechos_sem_dado": sem_dado_lista,
        "cobertura_dados_pct": round(cobertura / total * 100) if total else 0,
        "geometria": {"coords": [[round(a, 7), round(b, 7)] for a, b in coords], "acumulado_m": [round(x, 1) for x in acum]},
        "_nos": nos, "_arestas": arestas,
    }


def comparar_desvios(g: Grafo, segura: dict, comum: dict, ctx: Contexto) -> list[dict]:
    """Explica o que a rota segura evita em relação à rota mais curta."""
    a_seg, a_com = set(segura["_arestas"]), set(comum["_arestas"])
    if a_seg == a_com:
        return []
    so_comum = a_com - a_seg
    desvios, vistos = [], set()

    def add(rua, motivo, status=None, conf=None, extra=None):
        chave = (rua, motivo)
        if chave in vistos:
            return
        vistos.add(chave)
        d = {"rua": rua or "", "motivo": motivo, "status_relato": status, "confirmacoes": conf}
        if extra:
            d.update(extra)
        desvios.append(d)

    ids_alerta_seg = {a["id"] for a in segura["alertas_no_caminho"]}
    for ai in so_comum:
        for r in ctx._perigo.get(ai, ()):
            if r["status"] == "confirmado" and r["id"] not in ids_alerta_seg and r["categoria"] in CATEGORIAS_BARREIRA:
                add(r.get("rua") or g.arestas[ai].nome, r["categoria"], r["status"], r.get("confirmacoes"),
                    {"lat": r["lat"], "lon": r["lon"], "relato_id": r["id"]})
    if any(p in ctx.perfis for p in ("cadeira", "bengala", "muletas", "baixa_visao")) or ctx.quer("sem_escada"):
        for ai in so_comum:
            e = g.arestas[ai]
            if e.escada:
                add(e.nome, "escada", "dado_osm")
    if any(p in ctx.perfis for p in ("cadeira", "bengala", "muletas")) or ctx.quer("plano"):
        limite = 5 if ctx.quer("plano") else 8 if "cadeira" in ctx.perfis else 10
        ladeira: dict[str, float] = {}
        for ai in so_comum:
            e = g.arestas[ai]
            if e.inc > limite:
                ladeira[e.nome] = ladeira.get(e.nome, 0) + e.comp
        for nome, comp in ladeira.items():
            if comp >= 25:
                add(nome, "subida_forte", "dado_relevo")
    if ctx.quer("iluminado"):
        escuro: dict[str, float] = {}
        for ai in so_comum:
            e = g.arestas[ai]
            if e.ilum == "nao" and e.nome:
                escuro[e.nome] = escuro.get(e.nome, 0) + e.comp
        for nome, comp in escuro.items():
            if comp >= 40:
                add(nome, "rua_escura", "dado_osm")
    if ctx.chuva_forte:
        for ai in so_comum:
            e = g.arestas[ai]
            if g.flags[e.u] & F_ALAGA or g.flags[e.v] & F_ALAGA:
                add(e.nome, "risco_alagamento", "previsao_chuva")
    return desvios[:4]


MOTIVO_FALA = {
    "buraco": "tem um buraco na calçada", "calcada_irregular": "a calçada está irregular",
    "obstaculo": "tem um obstáculo na calçada", "sem_rampa": "falta rampa", "alagamento": "está alagada",
    "obra": "tem obra na calçada", "escada": "tem escada", "subida_forte": "tem uma subida forte",
    "risco_alagamento": "pode alagar com a chuva", "rua_escura": "não tem iluminação",
}
NOMES_PREFERENCIA = {"sem_escada": "sem escadas", "plano": "trecho mais plano", "iluminado": "ruas iluminadas"}


def criterios_rota(rota: dict, preferencias=()) -> list[str]:
    """O que foi levado em conta, em frases curtas para a tela da rota."""
    out = []
    if rota.get("escadas", 0) == 0 and ("sem_escada" in preferencias or any(
            p in rota.get("perfil", []) for p in ("cadeira", "bengala", "muletas"))):
        out.append("Sem escadas")
    for p in preferencias:
        if p != "sem_escada":
            out.append(NOMES_PREFERENCIA[p].capitalize())
    return out


def fala_resumo(rota: dict) -> dict:
    """Falas determinísticas (sempre fiéis aos dados). A IA pode reescrevê-las."""
    resumo = f"São {falar_distancia(rota['distancia_m'])}, cerca de {rota['duracao_min']} minutos a pé."
    if rota["escadas"] == 0 and (any(p in rota["perfil"] for p in ("cadeira", "bengala", "muletas"))
                                 or "sem_escada" in rota.get("preferencias", [])):
        resumo += " O caminho não tem escadas."
    motivos = []
    ruas_rota = {t["rua"] for t in rota["trechos"]}
    for d in rota["desvios"]:
        if d["rua"] and d["rua"] in ruas_rota:
            # a rota usa a mesma rua, mas passa longe do ponto do problema
            f = f"Na {d['rua']}, vou passar longe de um ponto que {MOTIVO_FALA.get(d['motivo'], d['motivo'])}."
        else:
            onde = f"a {d['rua']}" if d["rua"] else "um trecho do caminho mais curto"
            f = f"Vou evitar {onde} porque {MOTIVO_FALA.get(d['motivo'], d['motivo'])}."
        if d.get("confirmacoes"):
            f += f" Confirmado por {d['confirmacoes']} pessoas."
        motivos.append(f)
    avisos = []
    for a in rota["alertas_no_caminho"]:
        verbo = "pode ter" if a["status_relato"] == "em_verificacao" else "tem"
        f = f"A {a['rua']} {verbo} {a['descricao']}." if a["rua"] else f"Um trecho do caminho {verbo} {a['descricao']}."
        if a.get("lado_seguro"):
            f += f" Siga pela {a['lado_seguro']}."
        avisos.append(f)
    for rua in rota["trechos_sem_dado"]:
        avisos.append(f"Na {rua} não tenho informação confirmada sobre a calçada.")
    avisos.append("O app ajuda, mas não substitui sua atenção, bengala ou acompanhante.")
    return {"resumo_voz": resumo, "motivos_desvio": motivos, "avisos": avisos,
            "instrucoes": [m["fala"] for m in rota["manobras"]], "fonte": "regras"}


# Inclinação a partir da qual um trecho conta como "forte" para o perfil (mesmos limites
# usados para desviar em comparar_desvios). Referência: NBR 9050 limita rampas a 8,33%.
NBR9050_RAMPA_PCT = 8.33
FONTE_RELEVO = "Copernicus DEM GLO-90 (satélite, resolução de 90 m), via Open-Meteo"


def limite_inclinacao(ctx: Contexto) -> float:
    if ctx.quer("plano"):
        return 5.0
    if "cadeira" in ctx.perfis:
        return 8.0
    return 10.0


def _nome_perfil_limite(ctx: Contexto) -> str:
    if ctx.quer("plano"):
        return "para quem pediu caminho plano"
    if "cadeira" in ctx.perfis:
        return "para cadeira de rodas"
    if any(p in ctx.perfis for p in ("bengala", "muletas")):
        return "para bengala, andador ou muletas"
    return "para caminhar com conforto"


def _pct(v: float) -> str:
    return f"{v:.1f}".replace(".", ",").replace(",0", "")


def perfil_elevacao(g: Grafo, nos: list[int], arestas: list[int], ctx: Contexto, max_pontos: int = 120) -> dict:
    """Relevo do caminho no grafo (piloto ou OSM ao vivo), com a altitude real de cada ponto."""
    alt = getattr(g, "alt", None)
    tem_relevo = bool(alt) and g.meta.get("relevo", True) and any(alt[n] for n in nos)
    if not tem_relevo or len(nos) < 2:
        return {"disponivel": False, "fonte": FONTE_RELEVO}
    segs = [{"comp": g.arestas[ai].comp, "inc": g.arestas[ai].inc, "nome": g.arestas[ai].nome or ""} for ai in arestas]
    return montar_elevacao([float(alt[n]) for n in nos], segs, ctx, max_pontos)


def montar_elevacao(alts: list[float], segs: list[dict], ctx: Contexto, max_pontos: int = 120) -> dict:
    """Relevo a partir das altitudes dos pontos do caminho e dos trechos entre eles.

    alts: altitude de cada ponto (len = len(segs) + 1); segs: {comp, inc, nome} de cada trecho.
    Devolve o perfil (distância x altitude) para o gráfico, quanto sobe e desce no total,
    o trecho mais íngreme e as subidas/descidas fortes para o perfil, com frases simples.
    """
    acum = [0.0]
    for sg in segs:
        acum.append(acum[-1] + sg["comp"])
    sobe = sum(max(0.0, b - a) for a, b in zip(alts, alts[1:]))
    desce = sum(max(0.0, a - b) for a, b in zip(alts, alts[1:]))

    # Perfil para o gráfico: no máximo max_pontos, sempre com o primeiro e o último.
    passo = max(1, len(alts) // max_pontos)
    idx = list(range(0, len(alts), passo))
    if idx[-1] != len(alts) - 1:
        idx.append(len(alts) - 1)
    perfil = [[round(acum[i]), round(alts[i], 1)] for i in idx]

    # Trechos fortes: trechos seguidos acima do limite, juntos por rua (ignora pedaços < 10 m, ruído do relevo).
    limite = limite_inclinacao(ctx)
    fortes: list[dict] = []
    for k, sg in enumerate(segs):
        if sg["inc"] <= limite or sg["comp"] < 10:
            continue
        sentido = "subida" if alts[k + 1] >= alts[k] else "descida"
        ult = fortes[-1] if fortes else None
        if ult and ult["rua"] == sg["nome"] and ult["sentido"] == sentido and acum[k] - ult["fim_m"] < 40:
            ult["fim_m"] = acum[k + 1]
            ult["inclinacao_pct"] = max(ult["inclinacao_pct"], sg["inc"])
        else:
            fortes.append({"rua": sg["nome"], "sentido": sentido, "inicio_m": acum[k], "fim_m": acum[k + 1],
                           "inclinacao_pct": sg["inc"]})
    fortes = [dict(f, inicio_m=round(f["inicio_m"]), fim_m=round(f["fim_m"]), comp_m=round(f["fim_m"] - f["inicio_m"]),
                   inclinacao_pct=round(f["inclinacao_pct"], 1))
              for f in fortes if f["fim_m"] - f["inicio_m"] >= 20]

    validos = [sg for sg in segs if sg["comp"] >= 10]
    maior = max(validos, key=lambda sg: sg["inc"], default=None)
    max_inc = round(maior["inc"], 1) if maior else 0.0

    quem = _nome_perfil_limite(ctx)
    falas = []
    for f in fortes[:4]:
        onde = f"Na {f['rua']}" if f["rua"] and f["rua"] != "calçada" else "Num trecho do caminho"
        falas.append(f"{onde} tem uma {f['sentido']} de {_pct(f['inclinacao_pct'])}% por {falar_distancia(f['comp_m'])}.")
    if len(fortes) > 4:
        n = len(fortes) - 4
        falas.append(f"E mais {n} {'trecho parecido, marcado' if n == 1 else 'trechos parecidos, marcados'} em laranja no gráfico.")
    if fortes:
        falas.append(f"O recomendado {quem} é até {_pct(limite)}%.")
    elif max_inc >= 3:
        falas.append(f"O caminho tem subidas leves: a mais íngreme tem {_pct(max_inc)}%, dentro do recomendado {quem} (até {_pct(limite)}%).")
    else:
        falas.append("O caminho é quase plano.")

    return {
        "disponivel": True,
        "fonte": FONTE_RELEVO,
        "perfil": perfil,
        "sobe_m": round(sobe),
        "desce_m": round(desce),
        "altitude_min_m": round(min(alts)),
        "altitude_max_m": round(max(alts)),
        "max_inclinacao_pct": max_inc,
        "rua_mais_ingreme": maior["nome"] if maior else "",
        "limite_pct": limite,
        "limite_para": quem,
        "nbr9050_pct": NBR9050_RAMPA_PCT,
        "fortes": fortes,
        "falas": falas,
    }


def calcular(g: Grafo, origem: dict, destino: dict, ctx: Contexto) -> dict:
    indexar_relatos(g, ctx)
    o = g.no_mais_proximo(origem["lat"], origem["lon"])
    d = g.no_mais_proximo(destino["lat"], destino["lon"])
    if o is None or d is None:
        raise SemRota("Esse ponto está fora da área atendida pelo piloto.")
    if o == d:
        raise SemRota("Você já está no destino.")
    nos, ars = a_estrela(g, o, d, ctx)
    segura = montar_rota(g, nos, ars, ctx, origem, destino)
    segura["elevacao"] = perfil_elevacao(g, nos, ars, ctx)
    ctx_comum = Contexto(perfis=(), relatos=ctx.relatos, chuva_forte=ctx.chuva_forte, noite=ctx.noite, _perigo=ctx._perigo)
    nos_c, ars_c = a_estrela(g, o, d, ctx_comum)
    comum = montar_rota(g, nos_c, ars_c, ctx_comum, origem, destino)
    segura["rota_comum_distancia_m"] = comum["distancia_m"]
    segura["rota_comum"] = {"coords": comum["geometria"]["coords"]}
    segura["desvios"] = comparar_desvios(g, segura, comum, ctx)
    segura["falas"] = fala_resumo(segura)
    segura["criterios"] = criterios_rota(segura, ctx.preferencias)
    for k in ("_nos", "_arestas"):
        segura.pop(k, None)
    return segura
