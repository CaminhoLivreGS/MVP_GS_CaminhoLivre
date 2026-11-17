"""API do Caminho Livre (FastAPI).

Rotas públicas em /api/*, métricas Prometheus em /metrics (só rede interna,
o nginx não publica). Contrato completo em /api/docs (OpenAPI).
"""
from __future__ import annotations

import hmac
import json
import logging
import re
import time
import uuid
from collections import defaultdict, deque
from datetime import datetime
from typing import Literal, Optional
from zoneinfo import ZoneInfo

import requests
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse, Response
from prometheus_client import CONTENT_TYPE_LATEST, Counter, Gauge, Histogram, generate_latest
from pydantic import BaseModel, Field

from . import assistente, clima, config, entradas, ors, osm_ao_vivo
from .grafo import Grafo, distancia_m
from .lugares import TIPO_LLM_PARA_CATEGORIA, Lugares, categoria_do_texto, tokens
from .relatos import ErroRelato, Relatos
from .roteamento import PERFIS, VELOCIDADE_MS, Contexto, SemRota, calcular, fala_resumo

logging.basicConfig(level=logging.INFO, format='{"t":"%(asctime)s","nivel":"%(levelname)s","msg":%(message)s}')
log = logging.getLogger("caminho_livre")

app = FastAPI(title="Caminho Livre API", version="1.0.0", docs_url="/api/docs", openapi_url="/api/openapi.json",
              redoc_url=None)

GRAFO = Grafo(config.DADOS_DIR / "grafo.json")
LUGARES = Lugares(config.DADOS_DIR / "lugares.json")
RELATOS = Relatos(config.DB_PATH, config.DADOS_DIR / "relatos_seed.json" if config.SEMEAR_RELATOS else None)
BASE = assistente.BaseConhecimento(config.CONTEXTO)
LOCAIS = entradas.Locais(config.DADOS_DIR / "locais_detalhados.json")
QUALIDADE = json.loads((config.DADOS_DIR / "qualidade.json").read_text(encoding="utf-8"))
config.FOTOS_DIR.mkdir(parents=True, exist_ok=True)

# ---------------------------------------------------------------------------
# Observabilidade: as 4 métricas de ouro (latência, tráfego, erros, saturação)
# ---------------------------------------------------------------------------
REQS = Counter("cl_http_requisicoes_total", "Requisições HTTP", ["metodo", "rota", "status"])
LAT = Histogram("cl_http_latencia_segundos", "Latência HTTP", ["rota"],
                buckets=(0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 20))
EM_ANDAMENTO = Gauge("cl_http_em_andamento", "Requisições em andamento (saturação)")
ROTAS_CALC = Counter("cl_rotas_calculadas_total", "Rotas calculadas", ["perfil", "com_desvio"])
RELATOS_CRIADOS = Counter("cl_relatos_criados_total", "Relatos enviados pelo app", ["categoria"])
LLM_CHAMADAS = Counter("cl_llm_chamadas_total", "Chamadas ao LLM por resultado", ["tarefa", "status"])
_llm_contadas = 0


@app.middleware("http")
async def observar(request: Request, call_next):
    rota = request.scope.get("route").path if request.scope.get("route") else request.url.path
    ini = time.perf_counter()
    EM_ANDAMENTO.inc()
    status = 500
    try:
        resp = await call_next(request)
        status = resp.status_code
        rota = request.scope.get("route").path if request.scope.get("route") else "nao_encontrada"
        return resp
    finally:
        EM_ANDAMENTO.dec()
        dur = time.perf_counter() - ini
        REQS.labels(request.method, rota, str(status)).inc()
        LAT.labels(rota).observe(dur)
        log.info(json.dumps({"metodo": request.method, "rota": rota, "status": status, "ms": round(dur * 1000, 1)}))


# Mesmos cabeçalhos de segurança do nginx (docker/nginx/security-headers.conf),
# para o deploy em um serviço só (sem nginx na frente).
CABECALHOS_SEGURANCA = {
    "Content-Security-Policy": "default-src 'self'; script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval'; worker-src 'self' blob:; img-src 'self' blob: data: https://api.maptiler.com https://tile.openstreetmap.org; style-src 'self'; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests",
    "Permissions-Policy": "camera=(self), microphone=(self), geolocation=(self), payment=(), usb=()",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Strict-Transport-Security": "max-age=31536000",
}


@app.middleware("http")
async def seguranca(request: Request, call_next):
    resp = await call_next(request)
    for k, v in CABECALHOS_SEGURANCA.items():
        resp.headers.setdefault(k, v)
    return resp


# Limite simples por IP (protege a cota do LLM/ORS e evita spam de relatos).
_janelas: dict[str, deque] = defaultdict(deque)
_ultima_limpeza = 0.0


def ip_cliente(request: Request) -> str:
    """IP real do cliente. O X-Forwarded-For pode ser forjado pelo cliente: só vale
    o ÚLTIMO valor, que é o que o proxy de confiança (Render/nginx) acrescenta."""
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[-1].strip()[:64]
    return request.client.host if request.client else "?"


def limite(maximo: int, janela_s: int = 60):
    def dep(request: Request):
        global _ultima_limpeza
        chave = f"{request.url.path}:{ip_cliente(request)}"
        q, agora = _janelas[chave], time.time()
        while q and agora - q[0] > janela_s:
            q.popleft()
        if len(q) >= maximo:
            raise HTTPException(429, "Muitas requisições. Espere um minuto.")
        q.append(agora)
        if agora - _ultima_limpeza > 300:  # não deixa a memória crescer com IPs que já foram embora
            _ultima_limpeza = agora
            for k in [k for k, v in _janelas.items() if not v or agora - v[-1] > 600]:
                _janelas.pop(k, None)
    return dep


def noite_agora() -> bool:
    h = datetime.now(ZoneInfo(config.FUSO)).hour
    return h >= 18 or h < 6


def validar_dispositivo(x_dispositivo: Optional[str]) -> Optional[str]:
    if x_dispositivo and re.fullmatch(r"[0-9a-fA-F-]{16,64}", x_dispositivo):
        return x_dispositivo
    return None


# ---------------------------------------------------------------------------
# Modelos de entrada
# ---------------------------------------------------------------------------
class Ponto(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    nome: Optional[str] = Field(default=None, max_length=120)
    id: Optional[str] = Field(default=None, max_length=40)


class PedidoRota(BaseModel):
    origem: Ponto
    destino: Ponto
    perfis: list[Literal["bengala", "cadeira", "baixa_visao", "sem_apoio"]] = ["sem_apoio"]
    idoso: bool = False
    chuva: Literal["auto", "simular", "nao"] = "auto"
    explicar: bool = True


class PedidoFala(BaseModel):
    fala: str = Field(max_length=400)
    lat: Optional[float] = None
    lon: Optional[float] = None


class PedidoAjuda(BaseModel):
    pergunta: str = Field(max_length=400)


class Resposta(BaseModel):
    resposta: Literal["sim", "nao", "nao_sei"]


class Protocolo(BaseModel):
    protocolo: str = Field(min_length=3, max_length=60)


# ---------------------------------------------------------------------------
# Rotas
# ---------------------------------------------------------------------------
@app.get("/api/saude")
def saude():
    return {"ok": True, "grafo": {"nos": len(GRAFO.lat), "arestas": len(GRAFO.arestas)},
            "lugares": len(LUGARES.itens), "relatos": RELATOS.estatisticas(), "llm": assistente.llm_disponivel()}


@app.get("/api/territorio")
def territorio():
    t = GRAFO.meta["territorio"]
    return {"nome": t["nome"], "bbox": t["bbox"], "centro": t["centro"], "qualidade": QUALIDADE,
            "gerado_em": GRAFO.meta["gerado_em"], "fontes": GRAFO.meta["fontes"],
            "demo": GRAFO.meta.get("demo")}


@app.get("/api/lugares", dependencies=[Depends(limite(40))])
def buscar_lugares(q: str = "", lat: Optional[float] = None, lon: Optional[float] = None,
                   categoria: Optional[str] = None, limite_itens: int = 5):
    ref = (lat, lon) if lat is not None and lon is not None else None
    return {"lugares": buscar(q[:120], ref, categoria, max(1, min(limite_itens, 10)))}


def buscar(texto: str, ref, categoria=None, limite=5) -> list[dict]:
    """Território do piloto: base curada do pipeline. Fora dele (ou sem
    resultado): categorias perto de você (Overpass) e endereço/nome (Photon)."""
    no_piloto = ref is not None and GRAFO.dentro_territorio(*ref)
    if no_piloto or ref is None:
        r = LUGARES.buscar(texto, ref=ref, categoria=categoria, limite=limite)
        if r or ref is None:
            return r
    cat = categoria or categoria_do_texto(texto)
    try:
        # pedido de categoria ("farmácia", "postinho perto"): o mais próximo de verdade
        if cat and (not texto or len(tokens(texto)) <= 3):
            r = osm_ao_vivo.perto_de(cat, ref[0], ref[1], limite=limite)
            if r:
                return r
        return osm_ao_vivo.buscar_texto(texto, ref[0], ref[1], limite=limite) if texto.strip() else []
    except Exception as e:  # serviço externo fora do ar: degrada com elegância
        log.warning(json.dumps({"erro_busca": e.__class__.__name__}))
        return []


@app.get("/api/lugares/{lugar_id}")
def obter_lugar(lugar_id: str):
    l = LUGARES.por_id(lugar_id)
    if not l:
        raise HTTPException(404, "Lugar não encontrado.")
    return l


@app.post("/api/assistente/destino", dependencies=[Depends(limite(20))])
def assistente_destino(p: PedidoFala):
    try:
        d = assistente.interpretar_destino(p.fala)
    except ValueError:
        raise HTTPException(422, "Não ouvi nada. Pode repetir?")
    if d.get("emergencia"):
        return {"interpretacao": d, "candidatos": [], "fala": d["fala_confirmacao"], "emergencia": True}
    ref = (p.lat, p.lon) if p.lat is not None and p.lon is not None else None
    cat = TIPO_LLM_PARA_CATEGORIA.get(d.get("tipo_local"))
    texto = " ".join(x for x in (d.get("nome_local"), d.get("bairro"), p.fala) if x)
    cands = buscar(d.get("nome_local") or (p.fala if not cat else ""), ref, cat, 3) if cat else []
    if not cands:
        cands = buscar(" ".join(x for x in (d.get("nome_local"), d.get("bairro")) if x) or p.fala, ref, None, 3)
    if cands:
        c = cands[0]
        dist = c.get("distancia_m")
        fala = f"Encontrei {c['nome']}" + (f", a {round(dist / 50) * 50 if dist > 100 else dist} metros" if dist else "") + ". Quer ir para lá?"
    else:
        fala = "Não encontrei esse lugar aqui perto. Pode falar o nome de novo?"
    return {"interpretacao": d, "candidatos": cands, "fala": fala, "emergencia": False}


@app.post("/api/rotas", dependencies=[Depends(limite(30))])
def rota(p: PedidoRota):
    if distancia_m(p.origem.lat, p.origem.lon, p.destino.lat, p.destino.lon) > 8000:
        raise HTTPException(422, "Esse lugar fica a mais de 8 quilômetros. É longe demais para ir a pé.")
    tempo = {"chuva_forte_proximas_h": False}
    if p.chuva != "nao":
        tempo = clima.resumo(p.origem.lat, p.origem.lon, simular_chuva=p.chuva == "simular")
    ctx = Contexto(perfis=tuple(dict.fromkeys(p.perfis)), chuva_forte=bool(tempo.get("chuva_forte_proximas_h")),
                   noite=noite_agora(), relatos=RELATOS.para_rotas())
    origem = p.origem.model_dump()
    destino = p.destino.model_dump()
    origem["nome"] = origem.get("nome") or "Você"
    destino["nome"] = destino.get("nome") or "seu destino"
    # Território do piloto: grafo gold (relevo, alagamento, relatos curados).
    # Qualquer outro lugar: grafo montado na hora a partir do OSM (mesmas regras).
    # Se o OSM falhar: rota a pé do OSRM, avisando que não há dados de acessibilidade.
    fonte = "piloto"
    try:
        if GRAFO.dentro_territorio(origem["lat"], origem["lon"]) and GRAFO.dentro_territorio(destino["lat"], destino["lon"]):
            g = GRAFO
        else:
            fonte = "osm_ao_vivo"
            g = osm_ao_vivo.construir_grafo(osm_ao_vivo.caixa_para([(origem["lat"], origem["lon"]), (destino["lat"], destino["lon"])]))
        r = calcular(g, origem, destino, ctx)
    except SemRota as e:
        raise HTTPException(422, str(e))
    except (osm_ao_vivo.IndisponivelOSM, requests.RequestException):
        vel = min((VELOCIDADE_MS[x] for x in ctx.perfis), default=1.1)
        r = None
        # Plano B acessível: OpenRouteService (cadeira de rodas / sem escadas), com a chave no servidor.
        try:
            r = ors.rota(origem, destino, ctx.perfis, vel)
            fonte = "ors"
        except (ors.IndisponivelORS, KeyError, IndexError) as e:
            log.warning(json.dumps({"rota_ors": str(e)}))
        if r is None:
            fonte = "sem_acessibilidade"
            try:
                r = osm_ao_vivo.rota_osrm(origem, destino, vel)
            except (requests.RequestException, KeyError, IndexError):
                raise HTTPException(503, "Não consegui calcular a rota agora. Tente de novo em um minuto.")
        r["perfil"] = list(ctx.perfis)
        r["falas"] = fala_resumo(r)
        if fonte == "ors":
            r["falas"]["avisos"].insert(0, "Rota do OpenRouteService: evita escadas"
                                        + (" e ladeiras fortes" if "cadeira" in ctx.perfis else "")
                                        + ". Os problemas avisados pela comunidade nesta área ainda não entram no cálculo.")
        else:
            r["falas"]["avisos"].insert(0, "Nesta área ainda não tenho dados de calçada, escada e travessia. Vá com atenção.")
    r["fonte_dados"] = fonte
    r["id"] = uuid.uuid4().hex[:12]
    r["clima"] = tempo
    r["noite"] = ctx.noite
    if p.explicar and fonte in ("piloto", "osm_ao_vivo"):
        r["falas"] = assistente.explicar_rota(r, idoso=p.idoso)
    ROTAS_CALC.labels("+".join(sorted(ctx.perfis)), str(bool(r["desvios"])).lower()).inc()
    _contar_llm()
    return r


@app.get("/api/mapa", dependencies=[Depends(limite(60))])
def mapa(s: float, w: float, n: float, e: float):
    if (n - s) > 0.03 or (e - w) > 0.03:
        raise HTTPException(422, "Área grande demais.")
    vias, vistos = [], set()
    clat, clon = (s + n) / 2, (w + e) / 2
    raio = distancia_m(s, w, n, e) / 2 + 50
    for i, _d, _t in GRAFO.arestas_perto(clat, clon, raio):
        if i in vistos:
            continue
        vistos.add(i)
        a = GRAFO.arestas[i]
        la1, lo1, la2, lo2 = GRAFO.lat[a.u], GRAFO.lon[a.u], GRAFO.lat[a.v], GRAFO.lon[a.v]
        if max(la1, la2) < s or min(la1, la2) > n or max(lo1, lo2) < w or min(lo1, lo2) > e:
            continue
        classe = "grande" if a.tipo in ("primary", "secondary", "trunk", "primary_link", "secondary_link") else \
            "pedestre" if a.tipo in ("footway", "pedestrian", "path", "steps") else "rua"
        vias.append([round(la1, 6), round(lo1, 6), round(la2, 6), round(lo2, 6), classe, int(a.travessia)])
    return {"vias": vias[:8000]}


@app.get("/api/relatos")
def listar_relatos(s: Optional[float] = None, w: Optional[float] = None, n: Optional[float] = None, e: Optional[float] = None):
    bbox = (s, w, n, e) if None not in (s, w, n, e) else None
    return {"relatos": RELATOS.listar(bbox=bbox)}


@app.post("/api/relatos", dependencies=[Depends(limite(10))])
async def criar_relato(categoria: str = Form(...), lat: float = Form(...), lon: float = Form(...),
                       hash_foto: Optional[str] = Form(None), validacao: Optional[str] = Form(None),
                       detalhes: Optional[str] = Form(None),
                       foto: Optional[UploadFile] = File(None), x_dispositivo: Optional[str] = Header(None)):
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        raise HTTPException(422, "Posição inválida.")
    from .relatos import CATEGORIAS
    if categoria not in CATEGORIAS:
        raise HTTPException(422, "categoria inválida")
    rua = None
    if GRAFO.dentro_territorio(lat, lon):
        aj = GRAFO.ajustar(lat, lon, 60)
        rua = GRAFO.arestas[aj[0]].nome if aj else None
    else:
        try:
            rua = osm_ao_vivo.onde_estou(lat, lon).get("rua")
        except Exception:  # sem nome de rua: segue sem
            rua = None
    arquivo = None
    if foto is not None:
        dados = await foto.read(2_500_001)
        if len(dados) > 2_500_000:
            raise HTTPException(413, "Foto grande demais.")
        if not (dados[:3] == b"\xff\xd8\xff" or dados[:8] == b"\x89PNG\r\n\x1a\n" or dados[8:12] == b"WEBP"):
            raise HTTPException(415, "Formato de foto não suportado.")
        arquivo = f"{uuid.uuid4().hex}.img"
        (config.FOTOS_DIR / arquivo).write_bytes(dados)
    val = None
    if validacao:
        try:
            v = json.loads(validacao)
            val = {k: v.get(k) for k in ("status", "motivos", "evidencias", "rostos_borrados", "placas_borradas") if k in v}
        except (ValueError, AttributeError):
            val = None
    det = None
    if detalhes:
        try:
            det = json.loads(detalhes[:500])
            det = det if isinstance(det, dict) else None
        except ValueError:
            det = None
    try:
        r = RELATOS.criar(categoria=categoria, lat=lat, lon=lon, rua=rua, dispositivo=validar_dispositivo(x_dispositivo),
                          hash_foto=(hash_foto or None) and hash_foto[:64], foto_arquivo=arquivo, validacao=val,
                          detalhes=det)
    except ErroRelato as e:
        raise HTTPException(422, str(e))
    RELATOS_CRIADOS.labels(categoria).inc()
    return r


@app.post("/api/relatos/{rid}/respostas", dependencies=[Depends(limite(30))])
def responder_relato(rid: str, p: Resposta, x_dispositivo: Optional[str] = Header(None)):
    try:
        return RELATOS.responder(rid, p.resposta, validar_dispositivo(x_dispositivo))
    except ErroRelato as e:
        raise HTTPException(404 if "não encontrado" in str(e) else 422, str(e))


@app.get("/api/relatos/meus")
def meus_relatos(x_dispositivo: Optional[str] = Header(None)):
    itens = RELATOS.meus(validar_dispositivo(x_dispositivo))
    return {"relatos": itens, "total": len(itens), "consertados": sum(1 for r in itens if r["status"] == "resolvido")}


@app.get("/api/novidades")
def novidades(marcar: bool = False, x_dispositivo: Optional[str] = Header(None)):
    return {"novidades": RELATOS.novidades(validar_dispositivo(x_dispositivo), marcar_vistas=marcar)}


@app.post("/api/assistente/ajuda", dependencies=[Depends(limite(20))])
def ajuda(p: PedidoAjuda):
    r = assistente.responder_ajuda(BASE, p.pergunta)
    _contar_llm()
    return r


AVALIACOES = Counter("cl_avaliacoes_rota_total", "Avaliação da rota ao chegar (indicador de impacto)", ["nota"])


class Avaliacao(BaseModel):
    rota_id: Optional[str] = Field(default=None, max_length=40, pattern=r"^[0-9a-f]{0,40}$")
    nota: Literal["bom", "ruim"]
    perfil: Optional[str] = Field(default=None, max_length=60, pattern=r"^[a-z_+]*$")
    fonte_dados: Optional[Literal["piloto", "osm_ao_vivo", "ors", "sem_acessibilidade"]] = None


@app.post("/api/avaliacoes", dependencies=[Depends(limite(10))])
def avaliar(p: Avaliacao):
    AVALIACOES.labels(p.nota).inc()
    RELATOS.registrar_avaliacao(p.rota_id, p.nota, p.perfil, p.fonte_dados)
    log.info(json.dumps({"evento": "avaliacao_rota", "nota": p.nota, "rota_id": p.rota_id}))
    return {"ok": True}


@app.get("/api/indicadores", dependencies=[Depends(limite(30))])
def indicadores():
    """Indicadores agregados para o BI (sem dado pessoal: só contagens)."""
    return RELATOS.indicadores()


# ---------------------------------------------------------------------------
# Melhor entrada / melhor saída de um lugar
# ---------------------------------------------------------------------------
def _perfis(texto: str) -> tuple[str, ...]:
    ps = tuple(dict.fromkeys(x for x in (texto or "").split(",") if x in PERFIS))
    return ps or ("sem_apoio",)


def _entrada_publica(e: dict) -> dict:
    campos = ("id", "nome", "tipo", "lat", "lon", "degraus", "rampa", "elevador", "porta", "largura_m", "piso_tatil",
              "coberta", "horario", "fonte", "confianca", "qualidades", "motivo", "distancia_fora_m", "distancia_dentro_m",
              "nota", "aberta")
    return {k: e[k] for k in campos if k in e}


def _resposta_escolha(local, res, fontes):
    exemplo = any(e.get("fonte") == "exemplo" for e in res["entradas"] + res["descartadas"])
    return {"local": entradas.resumo_local(local) if local else None,
            "escolhida": _entrada_publica(res["escolhida"]) if res["escolhida"] else None,
            "entradas": [_entrada_publica(e) for e in res["entradas"]],
            "descartadas": [_entrada_publica(e) for e in res["descartadas"]],
            "fala": res["fala"], "fonte_distancia": res["fonte_distancia"], "fontes": fontes, "dados_exemplo": exemplo,
            "fechado_agora": res.get("fechado_agora", False)}


def _quando(hora: Optional[str]):
    """Demo reproduzível: ?hora=15:00 simula esse horário de hoje (só muda o horário de funcionamento)."""
    if not hora or not re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", hora):
        return None
    h, m = map(int, hora.split(":"))
    return datetime.now(ZoneInfo(config.FUSO)).replace(hour=h, minute=m)


@app.get("/api/locais", dependencies=[Depends(limite(30))])
def locais_perto(lat: float, lon: float):
    """Lugares com entradas e pontos internos mapeados perto de você (para "estou saindo")."""
    return {"locais": LOCAIS.proximos(lat, lon)}


@app.get("/api/locais/entradas", dependencies=[Depends(limite(20))])
def melhor_entrada(lat: float, lon: float, origem_lat: float, origem_lon: float, perfis: str = "",
                   nome: Optional[str] = None, hora: Optional[str] = None):
    """Entradas do lugar em (lat, lon) ordenadas para o perfil, a partir da origem."""
    local, lista, fontes = entradas.entradas_do_local(LOCAIS, lat, lon, (nome or "")[:120])
    if not lista:
        return {"local": None, "escolhida": None, "entradas": [], "descartadas": [], "fala": None,
                "fonte_distancia": None, "fontes": fontes, "dados_exemplo": False}
    res = entradas.escolher(lista, _perfis(perfis), origem={"lat": origem_lat, "lon": origem_lon}, sentido="chegar",
                            quando=_quando(hora))
    return _resposta_escolha(local, res, fontes)


@app.get("/api/locais/saida", dependencies=[Depends(limite(20))])
def melhor_saida(local_id: str, destino_lat: float, destino_lon: float, perfis: str = "",
                 ponto: Optional[str] = None, texto: Optional[str] = None, hora: Optional[str] = None):
    """Melhor saída: de onde você está dentro do lugar até o destino lá fora."""
    local = LOCAIS.por_id(local_id[:80])
    if not local:
        raise HTTPException(404, "Lugar não encontrado.")
    p = entradas.ponto_interno(local, ponto_id=(ponto or "")[:80] or None, texto=(texto or "")[:200])
    res = entradas.escolher(local["entradas"], _perfis(perfis), destino={"lat": destino_lat, "lon": destino_lon},
                            internas=p["saidas_m"] if p else None, sentido="sair", quando=_quando(hora))
    out = _resposta_escolha(local, res, [local.get("fonte", "levantamento")])
    out["ponto"] = {"id": p["id"], "nome": p["nome"]} if p else None
    if texto and not p:
        out["fala"] = "Não reconheci onde você está. " + (out["fala"] or "")
    return out


@app.get("/api/locais/{local_id}")
def obter_local(local_id: str):
    local = LOCAIS.por_id(local_id[:80])
    if not local:
        raise HTTPException(404, "Lugar não encontrado.")
    return {**entradas.resumo_local(local), "entradas": [_entrada_publica(e) for e in local["entradas"]]}


@app.get("/api/onde-estou", dependencies=[Depends(limite(30))])
def onde_estou(lat: float, lon: float):
    """Endereço aproximado da posição (Photon). A posição não é guardada."""
    try:
        return {**osm_ao_vivo.onde_estou(lat, lon), "no_piloto": GRAFO.dentro_territorio(lat, lon)}
    except Exception:
        return {"texto": None, "no_piloto": GRAFO.dentro_territorio(lat, lon)}


@app.get("/api/clima", dependencies=[Depends(limite(30))])
def tempo(lat: float, lon: float, simular: bool = False):
    return clima.resumo(lat, lon, simular_chuva=simular)


# ---------------------------------------------------------------------------
# Integração com o robô de RPA (UiPath): token de serviço obrigatório
# ---------------------------------------------------------------------------
def _token_ok(authorization: Optional[str], token: str) -> bool:
    # compare_digest: tempo constante (não vaza o token por diferença de tempo de resposta)
    return bool(token) and hmac.compare_digest((authorization or "").encode(), f"Bearer {token}".encode())


def exigir_rpa(authorization: Optional[str] = Header(None)):
    if not _token_ok(authorization, config.RPA_TOKEN):
        raise HTTPException(401, "Token do robô inválido.")


def exigir_admin(authorization: Optional[str] = Header(None)):
    if not _token_ok(authorization, config.ADMIN_TOKEN):
        raise HTTPException(401, "Token de administração inválido.")


class Decisao(BaseModel):
    decisao: Literal["aprovar", "rejeitar"]


@app.get("/api/moderacao", dependencies=[Depends(exigir_admin)])
def fila_moderacao():
    """Relatos que a visão computacional não conseguiu confirmar (INCONCLUSIVO)."""
    return {"relatos": RELATOS.moderacao_pendentes()}


@app.post("/api/moderacao/{rid}", dependencies=[Depends(exigir_admin)])
def moderar(rid: str, p: Decisao):
    try:
        return RELATOS.moderar(rid[:20], p.decisao)
    except ErroRelato as e:
        raise HTTPException(422, str(e))


@app.get("/api/chamados/pendentes", dependencies=[Depends(exigir_rpa)])
def chamados_pendentes():
    out = []
    for r in RELATOS.chamados_pendentes():
        if not r.get("chamado"):
            perto = LUGARES.buscar("", ref=(r["lat"], r["lon"]), categoria="ubs", limite=1)
            perto_nome = perto[0]["nome"] if perto and perto[0]["distancia_m"] < 250 else None
            r["chamado"] = assistente.redigir_chamado(r, perto_de=perto_nome)
            RELATOS.salvar_chamado(r["id"], r["chamado"])
        out.append(r)
    _contar_llm()
    return {"chamados": out}


@app.post("/api/chamados/{rid}/protocolo", dependencies=[Depends(exigir_rpa)])
def registrar_protocolo(rid: str, p: Protocolo):
    try:
        return RELATOS.registrar_protocolo(rid, p.protocolo)
    except ErroRelato as e:
        raise HTTPException(422, str(e))


@app.post("/api/chamados/{rid}/resolvido", dependencies=[Depends(exigir_rpa)])
def chamado_resolvido(rid: str):
    try:
        return RELATOS.marcar_resolvido(rid)
    except ErroRelato as e:
        raise HTTPException(404, str(e))


@app.get("/metrics", include_in_schema=False)
def metricas(request: Request, authorization: Optional[str] = Header(None)):
    # Rede interna (Prometheus do compose, sem proxy) lê direto. Pela internet (passou por
    # proxy: tem X-Forwarded-For), só com CL_METRICS_TOKEN; sem token configurado, 404.
    if request.headers.get("x-forwarded-for") and not _token_ok(authorization, config.METRICS_TOKEN):
        raise HTTPException(404, "Not Found")
    _contar_llm()
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)


def _contar_llm():
    global _llm_contadas
    novas = list(assistente.LOG_CHAMADAS)[_llm_contadas:] if len(assistente.LOG_CHAMADAS) >= _llm_contadas else []
    for c in novas:
        LLM_CHAMADAS.labels(c["tarefa"], c["status"]).inc()
    _llm_contadas = len(assistente.LOG_CHAMADAS)


@app.exception_handler(Exception)
async def erro_generico(request: Request, exc: Exception):
    log.exception(json.dumps({"erro": exc.__class__.__name__, "rota": request.url.path}))
    return JSONResponse(status_code=500, content={"detail": "Erro interno. Tente de novo em instantes."})


# ---------------------------------------------------------------------------
# Front estático (deploy em um serviço só). Vem por último: /api/* tem prioridade.
# ---------------------------------------------------------------------------
if (config.FRONT_DIR / "index.html").exists():
    from fastapi.responses import FileResponse
    from fastapi.staticfiles import StaticFiles

    app.mount("/assets", StaticFiles(directory=config.FRONT_DIR / "assets"), name="assets")

    @app.get("/healthz", include_in_schema=False)
    def healthz():
        return Response("ok\n", media_type="text/plain")

    @app.get("/{caminho:path}", include_in_schema=False)
    def front(caminho: str):
        alvo = (config.FRONT_DIR / caminho).resolve()
        if caminho and alvo.is_file() and config.FRONT_DIR.resolve() in alvo.parents:
            return FileResponse(alvo)
        return FileResponse(config.FRONT_DIR / "index.html", headers={"Cache-Control": "no-cache"})
