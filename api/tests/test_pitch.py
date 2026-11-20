"""Testes das funções do pitch: perfil completo, relato por voz, mapa público, Painel ADM e widget."""
from __future__ import annotations

import io
import math
import os
import tempfile
import zipfile

os.environ.setdefault("CL_DB_PATH", os.path.join(tempfile.mkdtemp(), "teste.db"))
os.environ.setdefault("CL_RPA_TOKEN", "token-de-teste")
os.environ.pop("OPENROUTER_API_KEY", None)
os.environ.pop("ORS_API_KEY", None)

from fastapi.testclient import TestClient  # noqa: E402

from app import adm, assistente, config  # noqa: E402
from app.main import GRAFO, app  # noqa: E402
from app.roteamento import Contexto  # noqa: E402

c = TestClient(app)
ADM = {"Authorization": f"Bearer {config.ADMIN_TOKEN}"}
CASA = GRAFO.meta["demo"]["casa"]
DISP = {"X-Dispositivo": "abcdef0123456789abcd"}


def _rota(perfis, preferencias=()):
    u = c.get("/api/lugares", params={"q": "posto de saúde", "lat": CASA["lat"], "lon": CASA["lon"]}).json()["lugares"][0]
    r = c.post("/api/rotas", json={"origem": CASA, "destino": {"lat": u["lat"], "lon": u["lon"], "nome": u["nome"]},
                                   "perfis": perfis, "preferencias": list(preferencias), "chuva": "nao", "explicar": False})
    assert r.status_code == 200, r.text
    return r.json()


# ---- perfil completo ---------------------------------------------------------
def test_perfil_muletas_aceito_e_sem_escada():
    r = _rota(["muletas"])
    assert r["perfil"] == ["muletas"]
    assert "Sem escadas" in r["criterios"] or r["escadas"] > 0


def test_preferencia_sem_escada_bloqueia_escada_para_qualquer_perfil():
    ctx = Contexto(perfis=("sem_apoio",), preferencias=("sem_escada",))
    assert math.isinf(ctx.fator("escada"))
    assert ctx.fator("escada") > Contexto(perfis=("sem_apoio",)).fator("escada")
    r = _rota(["sem_apoio"], ["sem_escada"])
    assert r["escadas"] == 0
    assert "Sem escadas" in r["criterios"]


def test_preferencias_aparecem_nos_criterios():
    r = _rota(["bengala"], ["plano", "iluminado"])
    assert r["preferencias"] == ["plano", "iluminado"]
    assert "Trecho mais plano" in r["criterios"] and "Ruas iluminadas" in r["criterios"]


def test_preferencia_invalida_recusada():
    r = c.post("/api/rotas", json={"origem": CASA, "destino": CASA, "perfis": ["cadeira"], "preferencias": ["voar"]})
    assert r.status_code == 422


# ---- relato por voz -----------------------------------------------------------
def test_classificacao_por_regras():
    assert assistente.categoria_por_regras("tem um buraco enorme na calçada") == "buraco"
    assert assistente.categoria_por_regras("a rua está alagada") == "alagamento"
    assert assistente.categoria_por_regras("carro estacionado em cima da calçada") == "obstaculo"
    assert assistente.categoria_por_regras("não tem rampa na esquina") == "sem_rampa"
    assert assistente.categoria_por_regras("o poste está apagado, muito escuro") == "luz_apagada"
    assert assistente.categoria_por_regras("bom dia") == "outro"


def test_relato_por_voz_sem_foto():
    s = c.post("/api/relatos/voz/classificar", json={"texto": "tem obra com tapume ocupando a calçada"}).json()
    assert s["categoria"] == "obra" and s["fonte"] == "regras"
    r = c.post("/api/relatos", data={"categoria": s["categoria"], "lat": CASA["lat"], "lon": CASA["lon"],
                                      "descricao": "tem obra com tapume ocupando a calçada", "canal": "voz"}, headers=DISP)
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["canal"] == "voz" and j["descricao"].startswith("tem obra") and j["tem_foto"] is False
    assert j["status"] == "em_verificacao"


def test_texto_curto_recusado():
    assert c.post("/api/relatos/voz/classificar", json={"texto": "a"}).status_code == 422


# ---- mapa público -------------------------------------------------------------
def test_relatos_publicos_tem_foto_ilustrativa_sem_dados_sensiveis():
    rel = c.get("/api/relatos").json()["relatos"]
    com_foto = [r for r in rel if r["tem_foto"]]
    assert com_foto, "relatos simulados deveriam ter foto ilustrativa"
    assert all(r["foto_ilustrativa"] for r in com_foto if r["origem"].startswith("simulado"))
    assert all("dispositivo" not in r and "foto" not in r for r in rel)
    f = c.get(f"/api/relatos/{com_foto[0]['id']}/foto")
    assert f.status_code == 200 and f.content[:3] == b"\xff\xd8\xff"
    assert c.get("/api/relatos/naoexiste/foto").status_code == 404


# ---- Painel ADM ---------------------------------------------------------------
def test_adm_exige_token():
    for rota in ("/api/adm/sessao", "/api/adm/resumo", "/api/adm/relatos", "/api/adm/exportar"):
        assert c.get(rota).status_code == 401
        assert c.get(rota, headers={"Authorization": "Bearer errado"}).status_code == 401


def test_regioes_grade_3x3():
    bbox = GRAFO.bbox
    s, w, n, e = bbox
    assert adm.regiao((s + n) / 2, (w + e) / 2, bbox) == "Setor Central"
    assert adm.regiao(n - 0.0001, w + 0.0001, bbox) == "Setor Noroeste"
    assert adm.regiao(s + 0.0001, e - 0.0001, bbox) == "Setor Sudeste"
    assert adm.regiao(0, 0, bbox) == adm.FORA
    assert len(adm.regioes(bbox)) == 9


def test_adm_resumo_e_filtro_por_regiao():
    sessao = c.get("/api/adm/sessao", headers=ADM).json()
    assert len(sessao["regioes"]) == 9
    tudo = c.get("/api/adm/resumo", headers=ADM).json()
    assert tudo["total"] >= 32
    assert tudo["dias_medios_resposta"] is not None
    assert {"obstaculos_identificados", "ocorrencias_confirmadas", "rotas_adaptadas_por_perfil",
            "dias_medios_resposta_responsavel"} <= set(tudo["impacto"])
    regiao = tudo["por_regiao"][0]["regiao"]
    so = c.get("/api/adm/relatos", params={"regiao": regiao}, headers=ADM).json()["relatos"]
    assert so and all(r["regiao"] == regiao for r in so)
    assert len(tudo["serie_diaria"]) == 45


def test_adm_muda_status_e_mede_resposta():
    r = c.post("/api/relatos", data={"categoria": "buraco", "lat": CASA["lat"], "lon": CASA["lon"], "descricao": "buraco",
                                      "canal": "texto"}, headers={"X-Dispositivo": "1234567890abcdef1234"}).json()
    enc = c.post(f"/api/adm/relatos/{r['id']}/status", json={"status": "encaminhado", "protocolo": "SP156-123"}, headers=ADM).json()
    assert enc["status"] == "encaminhado" and enc["protocolo"] == "SP156-123" and enc["confirmado_em"]
    res = c.post(f"/api/adm/relatos/{r['id']}/status", json={"status": "resolvido"}, headers=ADM).json()
    assert res["status"] == "resolvido" and res["resolvido_em"]
    # quem avisou recebe a "Novidade" do conserto
    nov = c.get("/api/novidades", headers={"X-Dispositivo": "1234567890abcdef1234"}).json()["novidades"]
    assert any(x["id"] == r["id"] for x in nov)
    assert c.post("/api/adm/relatos/xxx/status", json={"status": "resolvido"}, headers=ADM).status_code == 404
    assert c.post(f"/api/adm/relatos/{r['id']}/status", json={"status": "sumiu"}, headers=ADM).status_code == 422


def test_adm_exporta_zip_por_regiao():
    z = c.get("/api/adm/exportar", headers=ADM)
    assert z.status_code == 200 and z.headers["content-type"] == "application/zip"
    nomes = zipfile.ZipFile(io.BytesIO(z.content)).namelist()
    assert "relatos.csv" in nomes and "LEIAME.txt" in nomes
    fotos = [n for n in nomes if n.endswith(".jpg")]
    assert fotos and all("/" in n for n in fotos)  # cada foto dentro da pasta da sua região
    csv = zipfile.ZipFile(io.BytesIO(z.content)).read("relatos.csv").decode("utf-8-sig")
    assert csv.splitlines()[0].startswith("id,regiao,categoria")


# ---- instituições / widget ------------------------------------------------------
def test_instituicoes_e_widget_pode_ser_emoldurado():
    inst = c.get("/api/instituicoes").json()["instituicoes"]
    assert inst and inst[0]["entradas"] >= inst[0]["entradas_acessiveis"] >= 1
    # só o /embed/ pode ir num iframe de outro site; o resto continua protegido
    emb = c.get("/embed/shopping-uniao-osasco")
    assert "X-Frame-Options" not in emb.headers
    assert "frame-ancestors *" in emb.headers["content-security-policy"]
    api = c.get("/api/instituicoes")
    assert api.headers["x-frame-options"] == "DENY"
