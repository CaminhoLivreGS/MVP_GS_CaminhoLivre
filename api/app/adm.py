"""Painel Administrativo (ADM) para a gestão pública.

Regiões: MOCK. O piloto ainda não tem os polígonos oficiais de bairro da
prefeitura, então o território é dividido numa grade 3 x 3 com nomes de setor
(Setor Norte, Setor Central...). Para trocar pelos bairros oficiais basta
reescrever `regiao()` para testar o ponto contra os polígonos (GeoJSON da
prefeitura); o resto do painel continua igual.
"""
from __future__ import annotations

import csv
import io
import zipfile
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

NOMES_SETOR = [["Setor Noroeste", "Setor Norte", "Setor Nordeste"],
               ["Setor Oeste", "Setor Central", "Setor Leste"],
               ["Setor Sudoeste", "Setor Sul", "Setor Sudeste"]]
FORA = "Fora do piloto"
NOME_CATEGORIA = {"buraco": "Buraco", "calcada_irregular": "Calçada irregular", "obstaculo": "Obstáculo",
                  "sem_rampa": "Falta de rampa", "alagamento": "Alagamento", "luz_apagada": "Luz apagada",
                  "obra": "Obra", "outro": "Outro", "entrada": "Entrada de lugar"}
NOME_STATUS = {"em_verificacao": "Em verificação", "confirmado": "Confirmado", "encaminhado": "Encaminhado",
               "resolvido": "Resolvido", "descartado": "Descartado"}


FOLGA = 0.006  # ~600 m: relatos logo na borda do território entram no setor vizinho


def regiao(lat: float, lon: float, bbox) -> str:
    s, w, n, e = bbox
    if not (s - FOLGA <= lat <= n + FOLGA and w - FOLGA <= lon <= e + FOLGA):
        return FORA
    linha = max(0, min(2, int((n - lat) / (n - s) * 3)))
    coluna = max(0, min(2, int((lon - w) / (e - w) * 3)))
    return NOMES_SETOR[linha][coluna]


def regioes(bbox) -> list[dict]:
    """Retângulo de cada setor, para o mapa do painel desenhar a grade."""
    s, w, n, e = bbox
    dl, dc = (n - s) / 3, (e - w) / 3
    out = []
    for i in range(3):
        for j in range(3):
            out.append({"nome": NOMES_SETOR[i][j], "bbox": [n - (i + 1) * dl, w + j * dc, n - i * dl, w + (j + 1) * dc]})
    return out


def com_regiao(relatos: list[dict], bbox) -> list[dict]:
    for r in relatos:
        r["regiao"] = regiao(r["lat"], r["lon"], bbox)
    return relatos


def filtrar(relatos: list[dict], regiao_: str | None = None, categoria: str | None = None, status: str | None = None,
            dias: int | None = None) -> list[dict]:
    desde = (datetime.now(timezone.utc) - timedelta(days=dias)).isoformat() if dias else None
    out = []
    for r in relatos:
        if regiao_ and r["regiao"] != regiao_:
            continue
        if categoria and r["categoria"] != categoria:
            continue
        if status and r["status"] != status:
            continue
        if desde and r["criado_em"] < desde:
            continue
        out.append(r)
    return out


def _dias_entre(a: str | None, b: str | None) -> float | None:
    if not a or not b:
        return None
    return (datetime.fromisoformat(b) - datetime.fromisoformat(a)).total_seconds() / 86400


def resumo(relatos: list[dict]) -> dict:
    """Números do painel a partir da lista JÁ filtrada."""
    ativos = [r for r in relatos if r["status"] in ("em_verificacao", "confirmado", "encaminhado")]
    por_regiao: dict[str, Counter] = defaultdict(Counter)
    for r in relatos:
        por_regiao[r["regiao"]][r["status"]] += 1
    ranking_regioes = sorted(
        ({"regiao": k, "total": sum(v.values()), "ativos": v["em_verificacao"] + v["confirmado"] + v["encaminhado"],
          "resolvidos": v["resolvido"]} for k, v in por_regiao.items()),
        key=lambda x: (-x["ativos"], -x["total"]))
    ruas = Counter(r["rua"] for r in ativos if r.get("rua"))
    serie = Counter(r["criado_em"][:10] for r in relatos)
    resolvidos_serie = Counter((r.get("resolvido_em") or "")[:10] for r in relatos if r["status"] == "resolvido")
    hoje = datetime.now(timezone.utc).date()
    dias = [(hoje - timedelta(days=i)).isoformat() for i in range(44, -1, -1)]
    resposta = [d for d in (_dias_entre(r.get("confirmado_em") or r["criado_em"], r.get("resolvido_em"))
                            for r in relatos if r["status"] == "resolvido") if d is not None]
    confirmar = [d for d in (_dias_entre(r["criado_em"], r.get("confirmado_em")) for r in relatos) if d is not None]
    return {
        "total": len(relatos),
        "ativos": len(ativos),
        "por_status": dict(Counter(r["status"] for r in relatos)),
        "por_categoria": dict(Counter(r["categoria"] for r in relatos).most_common()),
        "por_canal": dict(Counter(r.get("canal") or "foto" for r in relatos)),
        "por_regiao": ranking_regioes,
        "ruas_mais_problemas": [{"rua": k, "ativos": v} for k, v in ruas.most_common(8)],
        "serie_diaria": [{"dia": d, "novos": serie.get(d, 0), "resolvidos": resolvidos_serie.get(d, 0)} for d in dias],
        "dias_medios_resposta": round(sum(resposta) / len(resposta), 1) if resposta else None,
        "horas_medias_confirmacao": round(24 * sum(confirmar) / len(confirmar), 1) if confirmar else None,
        "fila_moderacao": sum(1 for r in relatos if r.get("moderacao") == "pendente"),
        "simulados": sum(1 for r in relatos if str(r.get("origem", "")).startswith("simulado")),
    }


def _nome_pasta(t: str) -> str:
    return "".join(c if c.isalnum() or c in " -_" else "_" for c in t).strip().replace(" ", "_") or "sem_regiao"


def exportar_zip(relatos: list[dict], caminho_foto) -> bytes:
    """ZIP com uma pasta por região (fotos dentro) + relatos.csv + LEIAME.txt."""
    buf = io.BytesIO()
    campos = ["id", "regiao", "categoria", "status", "rua", "lat", "lon", "confirmacoes", "negacoes", "criado_em",
              "confirmado_em", "resolvido_em", "protocolo", "canal", "descricao", "origem", "foto", "foto_ilustrativa"]
    tabela = io.StringIO()
    w = csv.DictWriter(tabela, fieldnames=campos, extrasaction="ignore")
    w.writeheader()
    fotos = 0
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for r in sorted(relatos, key=lambda x: (x["regiao"], x["categoria"], x["criado_em"])):
            linha = dict(r)
            linha["categoria"] = NOME_CATEGORIA.get(r["categoria"], r["categoria"])
            linha["status"] = NOME_STATUS.get(r["status"], r["status"])
            p: Path | None = caminho_foto(r["id"])
            if p:
                nome = f"{_nome_pasta(r['regiao'])}/{r['criado_em'][:10]}_{r['categoria']}_{r['id']}.jpg"
                z.write(p, nome)
                linha["foto"] = nome
                fotos += 1
            else:
                linha["foto"] = ""
            w.writerow(linha)
        z.writestr("relatos.csv", "﻿" + tabela.getvalue())
        z.writestr("LEIAME.txt", (
            "Caminho Livre - exportação do Painel ADM\n"
            f"Gerado em: {datetime.now(timezone.utc).isoformat(timespec='seconds')}\n"
            f"Registros: {len(relatos)} | Fotos: {fotos}\n\n"
            "Cada pasta é uma região; dentro dela, as fotos (rostos e placas já borrados no aparelho de quem enviou).\n"
            "relatos.csv traz todos os registros, inclusive os sem foto (relatos por voz).\n"
            "Regiões: setores de uma grade 3x3 sobre o território do piloto (provisório até termos os bairros oficiais).\n"
            "Registros com origem 'simulado_demo' são DADOS SIMULADOS e as fotos deles são ilustrativas (domínio público).\n"
        ))
    return buf.getvalue()
