"""Melhor entrada (chegando) e melhor saída (saindo) de um lugar.

Os apps de mapa levam até o "centro" do prédio. Para quem usa cadeira de
rodas, a diferença entre a entrada com escada e a lateral com rampa pode ser
uma volta inteira no quarteirão. Aqui:

1. Entradas do lugar, de três fontes (a mais confiável primeiro):
   - levantamento da equipe / cadastro do estabelecimento (locais_detalhados.json;
     hoje com dados de EXEMPLO, marcados como tal);
   - OpenStreetMap (nós `entrance=*` via Overpass, tags wheelchair, step_count,
     door, automatic_door, width, opening_hours, tactile_paving);
2. Filtro pelo perfil (degrau sem rampa, porta giratória, passagem estreita,
   fechada agora);
3. Custo do caminho até cada entrada numa chamada só (matriz do ORS) ou,
   sem ORS, estimativa pela distância em linha reta x 1,3;
4. Nota = custo + penalidades - qualidades; explicação citando a descartada.

Na saída o cálculo se inverte: ponto interno -> cada saída (distância interna
cadastrada) + saída -> destino lá fora (matriz do ORS).
"""
from __future__ import annotations

import json
import logging
import re
import unicodedata
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from . import config, ors, osm_ao_vivo
from .grafo import distancia_m

log = logging.getLogger("caminho_livre.entradas")
FATOR_RUA = 1.3            # sem ORS: a pé anda ~30% a mais que a linha reta
LARGURA_MIN_CADEIRA = 0.8  # NBR 9050: vão livre mínimo de 80 cm
DIAS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]
PORTA_TXT = {"automatica": "porta automática", "giratoria": "porta giratória", "comum": "porta comum",
             "deslizante": "porta de correr", None: "porta sem informação"}


def _norm(t: str) -> str:
    t = unicodedata.normalize("NFKD", (t or "").lower())
    return re.sub(r"[^a-z0-9 ]", " ", "".join(c for c in t if not unicodedata.combining(c))).strip()


class Locais:
    """Lugares com entradas e pontos internos levantados (ou de exemplo)."""

    def __init__(self, caminho: Path):
        self.itens = json.loads(Path(caminho).read_text(encoding="utf-8"))["locais"] if Path(caminho).exists() else []

    def por_id(self, lid: str) -> dict | None:
        return next((l for l in self.itens if l["id"] == lid), None)

    def perto(self, lat: float, lon: float, nome: str | None = None) -> dict | None:
        n = _norm(nome or "")
        for l in self.itens:
            if distancia_m(lat, lon, l["lat"], l["lon"]) <= l.get("raio_m", 300):
                return l
            if n and any(a in n for a in [_norm(l["nome"])] + l.get("apelidos", [])):
                return l
        return None

    def proximos(self, lat: float, lon: float, raio=3000) -> list[dict]:
        out = []
        for l in self.itens:
            d = distancia_m(lat, lon, l["lat"], l["lon"])
            if d <= raio:
                out.append({**resumo_local(l), "distancia_m": round(d)})
        return sorted(out, key=lambda x: x["distancia_m"])


def resumo_local(l: dict) -> dict:
    return {"id": l["id"], "nome": l["nome"], "lat": l["lat"], "lon": l["lon"], "endereco": l.get("endereco"),
            "fonte": l.get("fonte"), "dados_exemplo": l.get("fonte") == "exemplo",
            "pontos_internos": [{"id": p["id"], "nome": p["nome"]} for p in l.get("pontos_internos", [])]}


# --- horário (subconjunto do opening_hours do OSM: "Mo-Sa 10:00-22:00; Su,PH 14:00-20:00") ---
def _dias(expr: str) -> set[str]:
    out = set()
    for parte in expr.split(","):
        parte = parte.strip()
        if parte == "PH":
            continue
        if "-" in parte:
            a, b = parte.split("-")
            ia, ib = DIAS.index(a), DIAS.index(b)
            out.update(DIAS[ia:ib + 1] if ia <= ib else DIAS[ia:] + DIAS[:ib + 1])
        elif parte in DIAS:
            out.add(parte)
    return out


def aberta(horario: str | None, quando: datetime | None = None) -> bool | None:
    """True/False se der para saber; None se não houver horário ou o formato for desconhecido."""
    if not horario:
        return None
    if horario.strip() == "24/7":
        return True
    quando = quando or datetime.now(ZoneInfo(config.FUSO))
    dia, minuto = DIAS[quando.weekday()], quando.hour * 60 + quando.minute
    resultado = None
    try:
        for regra in horario.split(";"):
            regra = regra.strip()
            m = re.fullmatch(r"([A-Za-z,\- ]+?)\s+([\d:,\- ]+|off|closed)", regra)
            if not m:
                return None
            if dia not in _dias(m.group(1)):
                continue
            if m.group(2) in ("off", "closed"):
                resultado = False
                continue
            resultado = False
            for faixa in m.group(2).split(","):
                ini, fim = faixa.strip().split("-")
                h1, m1 = map(int, ini.split(":"))
                h2, m2 = map(int, fim.split(":"))
                if h1 * 60 + m1 <= minuto < h2 * 60 + m2:
                    resultado = True
    except (ValueError, IndexError):
        return None
    return resultado if resultado is not None else False


# --- entradas do OpenStreetMap ---------------------------------------------------
def _num(v) -> float | None:
    try:
        return float(str(v).replace(",", ".").replace("m", "").strip())
    except (TypeError, ValueError):
        return None


def normalizar_osm(e: dict) -> dict | None:
    t = e.get("tags", {})
    tipo = t.get("entrance", "yes")
    if tipo in ("emergency", "service", "exit", "staircase", "garage"):
        return None
    passos = _num(t.get("step_count"))
    cadeira = t.get("wheelchair")
    degraus = int(passos) if passos is not None else 0 if cadeira == "yes" else None
    porta_tag, auto = t.get("door"), t.get("automatic_door")
    porta = ("automatica" if auto in ("yes", "button", "motion", "floor", "continuous") or porta_tag == "automatic"
             else "giratoria" if porta_tag == "revolving" else "deslizante" if porta_tag == "sliding"
             else "comum" if porta_tag in ("hinged", "yes", "swinging") else None)
    rampa = t.get("ramp") == "yes" or t.get("ramp:wheelchair") == "yes"
    confianca = "alta" if (cadeira or passos is not None) else "media" if (porta_tag or t.get("width")) else "baixa"
    nome = t.get("name") or t.get("ref") or ("Entrada principal" if tipo == "main" else "Entrada")
    return {"id": f"osm-n{e['id']}", "nome": nome, "tipo": "principal" if tipo == "main" else "lateral",
            "lat": e["lat"], "lon": e["lon"], "degraus": degraus, "rampa": rampa, "elevador": False,
            "porta": porta, "largura_m": _num(t.get("width")), "piso_tatil": t.get("tactile_paving") == "yes",
            "coberta": t.get("covered") == "yes", "horario": t.get("opening_hours"), "wheelchair": cadeira,
            "fonte": "osm", "confianca": confianca}


def entradas_osm(lat: float, lon: float, raio=150) -> list[dict]:
    q = f'[out:json][timeout:15];node(around:{raio},{lat:.6f},{lon:.6f})["entrance"];out tags;'
    dados = osm_ao_vivo._overpass(q, timeout=5)  # curto: é complemento, não pode travar a tela
    return [x for x in (normalizar_osm(e) for e in dados.get("elements", [])) if x]


def entradas_do_local(locais: Locais, lat: float, lon: float, nome: str | None = None) -> tuple[dict | None, list[dict], list[str]]:
    """Local detalhado (se houver) + entradas, com a lista de fontes usadas."""
    local = locais.perto(lat, lon, nome)
    entradas: list[dict] = []
    fontes: list[str] = []
    if local:
        entradas = [{**e, "confianca": e.get("confianca") or ("exemplo" if e.get("fonte") == "exemplo" else "alta")}
                    for e in local["entradas"]]
        fontes.append(local.get("fonte", "levantamento"))
    if local:  # lugar levantado: os dados curados valem; não espera o Overpass
        return local, entradas, fontes
    try:
        for e in entradas_osm(lat, lon, raio=150):
            if not any(distancia_m(e["lat"], e["lon"], x["lat"], x["lon"]) < 15 for x in entradas):
                entradas.append(e)
                if "osm" not in fontes:
                    fontes.append("osm")
    except Exception as ex:  # Overpass fora do ar: segue com o que tiver
        log.warning(json.dumps({"entradas_osm": ex.__class__.__name__}))
    return local, entradas, fontes


# --- escolha --------------------------------------------------------------------
def avaliar(e: dict, perfis) -> tuple[str | None, float, list[str]]:
    """(motivo de descarte ou None, penalidade em metros equivalentes, qualidades). Não olha o horário."""
    perfis = set(perfis)
    sem_degrau = (e.get("degraus") == 0) or e.get("rampa") or e.get("elevador")
    qualidades, pen = [], 0.0
    if "cadeira" in perfis:
        if e.get("wheelchair") == "no":
            return "não é acessível para cadeira de rodas", 0, []
        if e.get("degraus") and not (e.get("rampa") or e.get("elevador")):
            return f"tem {e['degraus']} {'degrau' if e['degraus'] == 1 else 'degraus'} e não tem rampa", 0, []
        if e.get("porta") == "giratoria":
            return "tem porta giratória", 0, []
        if e.get("largura_m") is not None and e["largura_m"] < LARGURA_MIN_CADEIRA:
            return f"a passagem é estreita ({round(e['largura_m'] * 100)} cm)", 0, []
        if e.get("degraus") is None and not (e.get("rampa") or e.get("elevador")):
            pen += 150  # sem informação: só se não houver opção melhor
    if "bengala" in perfis:
        if e.get("degraus") and not (e.get("rampa") or e.get("elevador")):
            pen += 40 * e["degraus"]
        if e.get("porta") == "giratoria":
            pen += 80
    if "baixa_visao" in perfis:
        if e.get("piso_tatil"):
            pen -= 40
            qualidades.append("tem piso tátil")
        if e.get("tipo") == "principal":
            pen -= 20
    if e.get("porta") == "automatica":
        pen -= 15
        qualidades.append("tem porta automática")
    if e.get("rampa"):
        qualidades.append("tem rampa")
    if e.get("elevador"):
        qualidades.append("tem elevador")
    if sem_degrau and not e.get("rampa") and not e.get("elevador") and e.get("degraus") == 0:
        qualidades.append("não tem degraus")
    if e.get("coberta"):
        pen -= 10
        qualidades.append("é coberta")
    return None, pen, qualidades


def _distancias(origens, destinos, perfis) -> tuple[list[list[float]], str]:
    try:
        m = ors.matriz(origens, destinos, perfis)
        if all(v is not None for linha in m for v in linha):
            return m, "ors"
    except ors.IndisponivelORS as ex:
        log.info(json.dumps({"matriz_ors": str(ex)}))
    return [[distancia_m(a[0], a[1], b[0], b[1]) * FATOR_RUA for b in destinos] for a in origens], "estimada"


def _porque_perdeu(e: dict, vencedora: dict) -> str:
    if e.get("degraus") and not (e.get("rampa") or e.get("elevador")):
        return f"tem {e['degraus']} {'degrau' if e['degraus'] == 1 else 'degraus'}"
    if e.get("porta") == "giratoria":
        return "tem porta giratória"
    if e.get("distancia_fora_m", 0) + e.get("distancia_dentro_m", 0) > vencedora.get("distancia_fora_m", 0) + vencedora.get("distancia_dentro_m", 0):
        return "fica mais longe pelo caminho seguro"
    return "é menos confortável para o seu jeito de andar"


def _explicar(escolhida: dict, descartadas: list[dict], sentido: str) -> str:
    verbo = "Vou te levar pela" if sentido == "chegar" else "Saia pela"
    qs = escolhida.get("qualidades", [])[:2]
    q = f" Ela {' e '.join(qs)}." if qs else ""
    fala = f"{verbo} {escolhida['nome']}.{q}"
    if descartadas:
        d = descartadas[0]
        fala += f" A {d['nome']} {d['motivo']}."
    return fala


def escolher(entradas: list[dict], perfis, *, origem=None, destino=None, internas: dict | None = None,
             sentido="chegar", quando: datetime | None = None) -> dict:
    """Ordena as entradas para o perfil. `origem` (chegar) ou `destino` + `internas` (sair)."""
    aptas, descartadas = [], []
    for e in entradas:
        motivo, pen, qual = avaliar(e, perfis)
        if sentido == "sair" and internas is not None and e["id"] not in internas:
            motivo = motivo or "não é saída a partir de onde você está"
        if motivo:
            descartadas.append({**e, "motivo": motivo})
        else:
            aptas.append({**e, "penalidade_m": pen, "qualidades": qual, "aberta": aberta(e.get("horario"), quando)})
    # Horário: descarta as fechadas só se houver alguma aberta. Se tudo estiver fechado,
    # escolhe pela acessibilidade e avisa (a pessoa pode estar planejando para mais tarde).
    todas_fechadas = bool(aptas) and all(e["aberta"] is False for e in aptas)
    if not todas_fechadas:
        for e in [x for x in aptas if x["aberta"] is False]:
            aptas.remove(e)
            descartadas.append({**e, "motivo": "está fechada agora"})
    if not aptas:
        return {"escolhida": None, "entradas": [], "descartadas": descartadas, "fonte_distancia": None,
                "fala": "Não encontrei uma entrada que sirva para o seu jeito de andar. "
                        "Vou te levar até a frente do lugar; peça ajuda na portaria."}
    pts = [(e["lat"], e["lon"]) for e in aptas]
    if sentido == "chegar":
        m, fonte = _distancias([(origem["lat"], origem["lon"])], pts, perfis)
        externo = m[0]
    else:
        m, fonte = _distancias(pts, [(destino["lat"], destino["lon"])], perfis)
        externo = [linha[0] for linha in m]
    for e, ext in zip(aptas, externo):
        e["distancia_fora_m"] = round(ext)
        e["distancia_dentro_m"] = (internas or {}).get(e["id"], 0) if sentido == "sair" else 0
        e["nota"] = round(ext + e["distancia_dentro_m"] + e["penalidade_m"], 1)
    aptas.sort(key=lambda x: x["nota"])
    # a "descartada" citada na fala: uma de verdade, ou a mais curta que perdeu para a escolhida
    citar = descartadas[:1] or ([{**aptas[1], "motivo": _porque_perdeu(aptas[1], aptas[0])}] if len(aptas) > 1 else [])
    fala = _explicar(aptas[0], citar, sentido)
    if todas_fechadas:
        fala = f"Atenção: o lugar está fechado agora (horário: {aptas[0].get('horario')}). " + fala
    return {"escolhida": aptas[0], "entradas": aptas, "descartadas": descartadas, "fonte_distancia": fonte,
            "fala": fala, "fechado_agora": todas_fechadas}


def ponto_interno(local: dict, ponto_id: str | None = None, texto: str | None = None) -> dict | None:
    """Ponto interno pelo id (lista/QR code) ou pela frase ("perto da praça de alimentação")."""
    pontos = local.get("pontos_internos", [])
    if ponto_id:
        return next((p for p in pontos if p["id"] == ponto_id), None)
    n = _norm(texto or "")
    if not n:
        return None
    melhor, nota = None, 0
    for p in pontos:
        s = max((len(a) for a in [_norm(p["nome"])] + p.get("apelidos", []) if a and a in n), default=0)
        if s > nota:
            melhor, nota = p, s
    return melhor
