"""Relatos de problemas na calçada (SQLite) e ciclo de vida.

Estados:
  em_verificacao -> confirmado     3 pessoas diferentes dizem "ainda está"
  em_verificacao -> descartado     2 pessoas dizem "não tem mais"
  confirmado     -> encaminhado    robô de RPA abriu o chamado na prefeitura (protocolo)
  confirmado/encaminhado -> resolvido   prefeitura consertou (RPA) ou 3 pessoas dizem "não tem mais"

LGPD: não guardamos nome nem telefone. O dispositivo é um UUID aleatório
gerado no aparelho; aqui só fica o hash dele (com sal), usado para "Meus
avisos", para evitar voto duplicado e para limitar envios por dia.
"""
from __future__ import annotations

import hashlib
import json
import shutil
import os
import sqlite3
import threading
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

CATEGORIAS = ("buraco", "calcada_irregular", "obstaculo", "sem_rampa", "alagamento", "luz_apagada", "obra", "outro", "entrada")
# "entrada" descreve a entrada de um lugar (degrau, rampa, porta): alimenta a escolha de
# entradas, não pesa no roteamento das calçadas.
DETALHES_ENTRADA = {"degrau": bool, "rampa": bool, "porta_automatica": bool, "porta_giratoria": bool}
CONFIRMACOES_NECESSARIAS = 3
NEGACOES_DESCARTE = 2
NEGACOES_RESOLVIDO = 3
LIMITE_DIA_POR_DISPOSITIVO = 10
SAL = os.getenv("CL_SAL_DISPOSITIVO", "caminho-livre-dev")

ESQUEMA = """
CREATE TABLE IF NOT EXISTS relatos (
  id TEXT PRIMARY KEY, categoria TEXT NOT NULL, status TEXT NOT NULL,
  confirmacoes INTEGER NOT NULL DEFAULT 1, negacoes INTEGER NOT NULL DEFAULT 0,
  lat REAL NOT NULL, lon REAL NOT NULL, rua TEXT, lado_seguro TEXT,
  criado_em TEXT NOT NULL, atualizado_em TEXT NOT NULL, origem TEXT NOT NULL,
  dispositivo TEXT, hash_foto TEXT, foto TEXT, validacao_visao TEXT,
  protocolo TEXT, chamado TEXT, resolvido_em TEXT, novidade_vista INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS respostas (
  relato_id TEXT NOT NULL, dispositivo TEXT NOT NULL, resposta TEXT NOT NULL, criado_em TEXT NOT NULL,
  PRIMARY KEY (relato_id, dispositivo)
);
CREATE INDEX IF NOT EXISTS idx_relatos_pos ON relatos(lat, lon);
CREATE TABLE IF NOT EXISTS rotas (
  id INTEGER PRIMARY KEY AUTOINCREMENT, perfil TEXT NOT NULL, preferencias TEXT, com_desvio INTEGER NOT NULL,
  desvios INTEGER NOT NULL DEFAULT 0, fonte_dados TEXT, criado_em TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS avaliacoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT, rota_id TEXT, nota TEXT NOT NULL, perfil TEXT, fonte_dados TEXT,
  criado_em TEXT NOT NULL
);
"""
# Colunas adicionadas depois da primeira versão (bancos antigos ganham a coluna sem perder dados).
MIGRACOES = ("ALTER TABLE relatos ADD COLUMN detalhes TEXT", "ALTER TABLE relatos ADD COLUMN moderacao TEXT",
             # relato por voz: texto dito pela pessoa (sem foto) e canal de envio
             "ALTER TABLE relatos ADD COLUMN descricao TEXT", "ALTER TABLE relatos ADD COLUMN canal TEXT",
             # quando ficou confirmado (mede o tempo de resposta do responsável)
             "ALTER TABLE relatos ADD COLUMN confirmado_em TEXT",
             # foto de banco de imagens nos relatos SIMULADOS (mock para a demonstração)
             "ALTER TABLE relatos ADD COLUMN foto_ilustrativa INTEGER DEFAULT 0")
STATUS = ("em_verificacao", "confirmado", "encaminhado", "resolvido", "descartado")
# Mock: fotos de domínio público/CC0 para os relatos simulados (ver api/dados/fotos_demo/CREDITOS.md).
FOTOS_DEMO = {
    "buraco": ["buraco_pos2_0.jpg", "buraco_pos2_1.jpg", "buraco_pos2_3.jpg", "buraco_pos2_4.jpg", "buraco_pos2_5.jpg"],
    "calcada_irregular": ["buraco_pos2_4.jpg", "buraco_pos2_0.jpg", "buraco_pos2_5.jpg"],
    "obstaculo": ["lixo_pos_0.jpg", "lixo_pos_4.jpg"],
    "alagamento": ["alaga2_1.jpg", "alaga2_2.jpg"],
    "sem_rampa": ["escada_2.jpg"],
}


def agora() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def hash_dispositivo(d: str | None) -> str | None:
    if not d:
        return None
    return hashlib.sha256((SAL + d).encode()).hexdigest()[:32]


class ErroRelato(ValueError):
    pass


class Relatos:
    def __init__(self, caminho: Path, seed: Path | None = None, fotos_dir: Path | None = None,
                 fotos_demo: Path | None = None):
        self.fotos_dir = Path(fotos_dir) if fotos_dir else None
        self.fotos_demo = Path(fotos_demo) if fotos_demo else None
        Path(caminho).parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(str(caminho), check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.lock = threading.Lock()
        with self.lock:
            self.db.executescript(ESQUEMA)
            for m in MIGRACOES:
                try:
                    self.db.execute(m)
                except sqlite3.OperationalError:
                    pass  # coluna já existe
            vazio = self.db.execute("SELECT COUNT(*) FROM relatos").fetchone()[0] == 0
        if vazio and seed and Path(seed).exists():
            self._semear(json.loads(Path(seed).read_text(encoding="utf-8"))["relatos"])

    def _semear(self, itens: list[dict]) -> None:
        with self.lock, self.db:
            for k, r in enumerate(itens):
                # MOCK (dados simulados): datas de confirmação e conserto deterministas, para o
                # indicador "tempo de resposta" e a linha do tempo do Painel ADM terem o que mostrar.
                criado = datetime.fromisoformat(r["criado_em"])
                confirmado_em = resolvido_em = None
                if r["status"] in ("confirmado", "encaminhado", "resolvido"):
                    confirmado_em = (criado + timedelta(hours=6 + 7 * (k % 5))).isoformat(timespec="seconds")
                if r["status"] == "resolvido":
                    resolvido_em = (criado + timedelta(days=4 + 3 * (k % 4))).isoformat(timespec="seconds")
                foto = self._foto_demo(r["categoria"], k)
                self.db.execute(
                    "INSERT OR IGNORE INTO relatos (id, categoria, status, confirmacoes, lat, lon, rua, lado_seguro,"
                    " criado_em, atualizado_em, origem, confirmado_em, resolvido_em, foto, foto_ilustrativa, canal,"
                    " novidade_vista) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)",
                    (r["id"], r["categoria"], r["status"], r["confirmacoes"], r["lat"], r["lon"], r.get("rua"),
                     r.get("lado_seguro"), r["criado_em"], resolvido_em or r["criado_em"], r["origem"], confirmado_em,
                     resolvido_em, foto, 1 if foto else 0, "foto" if foto else "texto"))
            # MOCK: histórico de rotas da demonstração (fonte_dados='simulado_demo'), para o indicador
            # "rotas adaptadas por perfil" não começar vazio. Rotas reais entram com a fonte de verdade.
            perfis_demo = [("cadeira", 18, 11), ("bengala", 14, 8), ("muletas", 6, 4), ("baixa_visao", 11, 5),
                           ("sem_apoio", 9, 2), ("bengala+baixa_visao", 4, 3)]
            base = datetime.now(timezone.utc) - timedelta(days=20)
            for perfil, n, com_desvio in perfis_demo:
                for j in range(n):
                    t = (base + timedelta(hours=11 * j + len(perfil))).isoformat(timespec="seconds")
                    self.db.execute("INSERT INTO rotas (perfil, preferencias, com_desvio, desvios, fonte_dados, criado_em)"
                                    " VALUES (?,?,?,?,?,?)", (perfil, "", int(j < com_desvio), int(j < com_desvio),
                                                              "simulado_demo", t))

    def _foto_demo(self, categoria: str, k: int) -> str | None:
        opcoes = FOTOS_DEMO.get(categoria)
        if not opcoes or not self.fotos_dir or not self.fotos_demo:
            return None
        origem = self.fotos_demo / opcoes[k % len(opcoes)]
        if not origem.exists():
            return None
        self.fotos_dir.mkdir(parents=True, exist_ok=True)
        destino = self.fotos_dir / f"demo_{origem.stem}.img"
        if not destino.exists():
            shutil.copyfile(origem, destino)
        return destino.name

    def caminho_foto(self, rid: str) -> Path | None:
        with self.lock:
            row = self.db.execute("SELECT foto FROM relatos WHERE id=?", (rid,)).fetchone()
        if not row or not row["foto"] or not self.fotos_dir:
            return None
        p = self.fotos_dir / Path(row["foto"]).name
        return p if p.exists() else None

    @staticmethod
    def _publico(row: sqlite3.Row) -> dict:
        d = dict(row)
        d.pop("dispositivo", None)
        d["tem_foto"] = bool(d.pop("foto", None))
        d["foto_ilustrativa"] = bool(d.get("foto_ilustrativa"))
        d["validacao_visao"] = json.loads(d["validacao_visao"]) if d.get("validacao_visao") else None
        d["chamado"] = json.loads(d["chamado"]) if d.get("chamado") else None
        d["detalhes"] = json.loads(d["detalhes"]) if d.get("detalhes") else None
        return d

    def listar(self, bbox=None, ativos=True) -> list[dict]:
        sql, args = "SELECT * FROM relatos", []
        cond = []
        if ativos:
            cond.append("status IN ('em_verificacao','confirmado','encaminhado')")
        if bbox:
            s, w, n, e = bbox
            cond.append("lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?")
            args += [s, n, w, e]
        if cond:
            sql += " WHERE " + " AND ".join(cond)
        with self.lock:
            return [self._publico(r) for r in self.db.execute(sql, args).fetchall()]

    def para_rotas(self) -> list[dict]:
        """Visão usada pelo roteamento: encaminhado conta como confirmado."""
        out = []
        for r in self.listar():
            if r["categoria"] == "entrada":
                continue
            r = dict(r)
            if r["status"] == "encaminhado":
                r["status"] = "confirmado"
            out.append(r)
        return out

    def obter(self, rid: str) -> dict | None:
        with self.lock:
            row = self.db.execute("SELECT * FROM relatos WHERE id=?", (rid,)).fetchone()
        return self._publico(row) if row else None

    def criar(self, *, categoria: str, lat: float, lon: float, rua: str | None, dispositivo: str | None,
              hash_foto: str | None = None, foto_arquivo: str | None = None, validacao: dict | None = None,
              detalhes: dict | None = None, descricao: str | None = None, canal: str | None = None) -> dict:
        if categoria not in CATEGORIAS:
            raise ErroRelato("categoria inválida")
        if detalhes is not None:
            detalhes = {k: bool(v) for k, v in detalhes.items() if k in DETALHES_ENTRADA} or None
        disp = hash_dispositivo(dispositivo)
        desde = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat(timespec="seconds")
        with self.lock:
            if disp:
                n = self.db.execute("SELECT COUNT(*) FROM relatos WHERE dispositivo=? AND criado_em>=?", (disp, desde)).fetchone()[0]
                if n >= LIMITE_DIA_POR_DISPOSITIVO:
                    raise ErroRelato("Você já mandou muitos avisos hoje. Tente amanhã.")
            if hash_foto:
                dup = self.db.execute("SELECT id FROM relatos WHERE hash_foto=?", (hash_foto,)).fetchone()
                if dup:
                    raise ErroRelato("Essa foto já foi enviada antes. Tire outra foto.")
            rid = "r" + uuid.uuid4().hex[:10]
            t = agora()
            with self.db:
                self.db.execute(
                    "INSERT INTO relatos (id, categoria, status, confirmacoes, lat, lon, rua, criado_em, atualizado_em,"
                    " origem, dispositivo, hash_foto, foto, validacao_visao, detalhes, moderacao, descricao, canal)"
                    " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (rid, categoria, "em_verificacao", 1, lat, lon, rua, t, t, "app", disp, hash_foto, foto_arquivo,
                     json.dumps(validacao, ensure_ascii=False) if validacao else None,
                     json.dumps(detalhes, ensure_ascii=False) if detalhes else None,
                     # a visão não teve certeza: uma pessoa da equipe olha antes de valer
                     "pendente" if (validacao or {}).get("status") == "INCONCLUSIVO" else None,
                     (descricao or "").strip()[:400] or None,
                     canal or ("foto" if foto_arquivo else "voz" if descricao else "texto")))
                if disp:
                    self.db.execute("INSERT OR REPLACE INTO respostas VALUES (?,?,?,?)", (rid, disp, "sim", t))
        return self.obter(rid)

    def responder(self, rid: str, resposta: str, dispositivo: str | None) -> dict:
        if resposta not in ("sim", "nao", "nao_sei"):
            raise ErroRelato("resposta inválida")
        disp = hash_dispositivo(dispositivo) or ("anon-" + uuid.uuid4().hex)
        with self.lock:
            row = self.db.execute("SELECT * FROM relatos WHERE id=?", (rid,)).fetchone()
            if not row:
                raise ErroRelato("relato não encontrado")
            if self.db.execute("SELECT 1 FROM respostas WHERE relato_id=? AND dispositivo=?", (rid, disp)).fetchone():
                return {"relato": self._publico(row), "contou": False}
            conf, neg, status = row["confirmacoes"], row["negacoes"], row["status"]
            if resposta == "sim":
                conf += 1
                if status == "em_verificacao" and conf >= CONFIRMACOES_NECESSARIAS:
                    status = "confirmado"
            elif resposta == "nao":
                neg += 1
                if status == "em_verificacao" and neg >= NEGACOES_DESCARTE:
                    status = "descartado"
                elif status in ("confirmado", "encaminhado") and neg >= NEGACOES_RESOLVIDO:
                    status = "resolvido"
            t = agora()
            with self.db:
                self.db.execute("INSERT INTO respostas VALUES (?,?,?,?)", (rid, disp, resposta, t))
                self.db.execute("UPDATE relatos SET confirmacoes=?, negacoes=?, status=?, atualizado_em=?,"
                                " resolvido_em=CASE WHEN ?='resolvido' THEN ? ELSE resolvido_em END,"
                                " confirmado_em=CASE WHEN ?='confirmado' AND confirmado_em IS NULL THEN ? ELSE confirmado_em END"
                                " WHERE id=?", (conf, neg, status, t, status, t, status, t, rid))
        return {"relato": self.obter(rid), "contou": True}

    def meus(self, dispositivo: str | None) -> list[dict]:
        disp = hash_dispositivo(dispositivo)
        if not disp:
            return []
        with self.lock:
            rows = self.db.execute("SELECT * FROM relatos WHERE dispositivo=? ORDER BY criado_em DESC", (disp,)).fetchall()
        return [self._publico(r) for r in rows]

    def novidades(self, dispositivo: str | None, marcar_vistas: bool = False) -> list[dict]:
        disp = hash_dispositivo(dispositivo)
        if not disp:
            return []
        with self.lock:
            rows = self.db.execute("SELECT * FROM relatos WHERE dispositivo=? AND status='resolvido' AND novidade_vista=0",
                                   (disp,)).fetchall()
            if marcar_vistas and rows:
                with self.db:
                    self.db.execute("UPDATE relatos SET novidade_vista=1 WHERE dispositivo=? AND status='resolvido'", (disp,))
        return [self._publico(r) for r in rows]

    # ---- moderação humana: relatos que a visão não conseguiu confirmar ----------
    def moderacao_pendentes(self) -> list[dict]:
        with self.lock:
            rows = self.db.execute("SELECT * FROM relatos WHERE moderacao='pendente' ORDER BY criado_em").fetchall()
        return [self._publico(r) for r in rows]

    def moderar(self, rid: str, decisao: str) -> dict:
        if decisao not in ("aprovar", "rejeitar"):
            raise ErroRelato("decisão inválida")
        status = "confirmado" if decisao == "aprovar" else "descartado"
        with self.lock, self.db:
            t = agora()
            cur = self.db.execute("UPDATE relatos SET moderacao=?, status=?, atualizado_em=?,"
                                  " confirmado_em=CASE WHEN ?='confirmado' THEN ? ELSE confirmado_em END"
                                  " WHERE id=? AND moderacao='pendente'",
                                  ("aprovado" if decisao == "aprovar" else "rejeitado", status, t, status, t, rid))
        if cur.rowcount == 0:
            raise ErroRelato("relato não está na fila de moderação")
        return self.obter(rid)

    # ---- Painel ADM (gestão pública) ---------------------------------------------
    def todos(self) -> list[dict]:
        with self.lock:
            rows = self.db.execute("SELECT * FROM relatos ORDER BY criado_em DESC").fetchall()
        return [self._publico(r) for r in rows]

    def mudar_status(self, rid: str, status: str, protocolo: str | None = None) -> dict:
        """Mudança feita pela equipe da prefeitura no painel (vale mais que os votos)."""
        if status not in STATUS:
            raise ErroRelato("status inválido")
        t = agora()
        with self.lock, self.db:
            cur = self.db.execute(
                "UPDATE relatos SET status=?, atualizado_em=?,"
                " confirmado_em=CASE WHEN ? IN ('confirmado','encaminhado','resolvido') AND confirmado_em IS NULL"
                "   THEN ? ELSE confirmado_em END,"
                " resolvido_em=CASE WHEN ?='resolvido' THEN ? WHEN ?<>'resolvido' THEN NULL ELSE resolvido_em END,"
                " novidade_vista=CASE WHEN ?='resolvido' THEN 0 ELSE novidade_vista END,"
                " protocolo=COALESCE(?, protocolo),"
                " moderacao=CASE WHEN moderacao='pendente' THEN 'decidido_no_painel' ELSE moderacao END WHERE id=?",
                (status, t, status, t, status, t, status, status, (protocolo or None) and protocolo[:60], rid))
        if cur.rowcount == 0:
            raise ErroRelato("relato não encontrado")
        return self.obter(rid)

    def registrar_rota(self, perfil: str, preferencias: list[str], desvios: int, fonte: str | None) -> None:
        with self.lock, self.db:
            self.db.execute("INSERT INTO rotas (perfil, preferencias, com_desvio, desvios, fonte_dados, criado_em)"
                            " VALUES (?,?,?,?,?,?)", (perfil, ",".join(preferencias), int(desvios > 0), desvios, fonte, agora()))

    def rotas_por_perfil(self) -> list[dict]:
        with self.lock:
            return [dict(r) for r in self.db.execute(
                "SELECT perfil, COUNT(*) n, SUM(com_desvio) com_desvio FROM rotas GROUP BY perfil ORDER BY n DESC").fetchall()]

    # ---- avaliações da rota (indicador de impacto para o BI) ---------------------
    def registrar_avaliacao(self, rota_id: str | None, nota: str, perfil: str | None, fonte: str | None) -> None:
        with self.lock, self.db:
            self.db.execute("INSERT INTO avaliacoes (rota_id, nota, perfil, fonte_dados, criado_em) VALUES (?,?,?,?,?)",
                            (rota_id, nota, perfil, fonte, agora()))

    def indicadores(self) -> dict:
        with self.lock:
            q = lambda sql: [dict(r) for r in self.db.execute(sql).fetchall()]  # noqa: E731
            av = q("SELECT nota, COUNT(*) n FROM avaliacoes GROUP BY nota")
            av_perfil = q("SELECT perfil, nota, COUNT(*) n FROM avaliacoes GROUP BY perfil, nota")
            por_cat = q("SELECT categoria, COUNT(*) n FROM relatos GROUP BY categoria")
            por_origem = q("SELECT origem, COUNT(*) n FROM relatos GROUP BY origem")
            resolvidos = q("SELECT COUNT(*) n, AVG(julianday(resolvido_em) - julianday(criado_em)) dias,"
                           " AVG(julianday(resolvido_em) - julianday(COALESCE(confirmado_em, criado_em))) dias_resposta"
                           " FROM relatos WHERE status='resolvido' AND resolvido_em IS NOT NULL")[0]
            confirmacao = q("SELECT AVG(julianday(confirmado_em) - julianday(criado_em)) dias FROM relatos"
                            " WHERE confirmado_em IS NOT NULL")[0]
            total_relatos = self.db.execute("SELECT COUNT(*) FROM relatos").fetchone()[0]
            confirmadas = self.db.execute("SELECT COUNT(*) FROM relatos WHERE confirmado_em IS NOT NULL"
                                          " OR status IN ('confirmado','encaminhado','resolvido')").fetchone()[0]
            por_canal = q("SELECT COALESCE(canal, 'foto') canal, COUNT(*) n FROM relatos GROUP BY 1")
            fila = self.db.execute("SELECT COUNT(*) FROM relatos WHERE moderacao='pendente'").fetchone()[0]
        bom = sum(x["n"] for x in av if x["nota"] == "bom")
        total = sum(x["n"] for x in av)
        return {"avaliacoes": {"total": total, "bom": bom, "ruim": total - bom,
                               "satisfacao_pct": round(100 * bom / total, 1) if total else None, "por_perfil": av_perfil},
                "relatos": {"por_status": self.estatisticas(), "por_categoria": por_cat, "por_origem": por_origem,
                            "resolvidos": resolvidos["n"],
                            "dias_medios_ate_resolver": round(resolvidos["dias"], 1) if resolvidos["dias"] else None,
                            "fila_moderacao": fila, "por_canal": por_canal},
                # Indicadores de impacto citados no pitch
                "impacto": {"obstaculos_identificados": total_relatos, "ocorrencias_confirmadas": confirmadas,
                            "rotas_adaptadas_por_perfil": self.rotas_por_perfil(),
                            "horas_medias_ate_confirmar": round(confirmacao["dias"] * 24, 1) if confirmacao["dias"] else None,
                            "dias_medios_resposta_responsavel": round(resolvidos["dias_resposta"], 1)
                            if resolvidos["dias_resposta"] else None}}

    # ---- integração com o robô de RPA (UiPath) ---------------------------
    def chamados_pendentes(self) -> list[dict]:
        with self.lock:
            rows = self.db.execute("SELECT * FROM relatos WHERE status='confirmado' AND protocolo IS NULL"
                                   " ORDER BY confirmacoes DESC, criado_em").fetchall()
        return [self._publico(r) for r in rows]

    def salvar_chamado(self, rid: str, chamado: dict) -> None:
        with self.lock, self.db:
            self.db.execute("UPDATE relatos SET chamado=? WHERE id=?", (json.dumps(chamado, ensure_ascii=False), rid))

    def registrar_protocolo(self, rid: str, protocolo: str) -> dict:
        with self.lock, self.db:
            cur = self.db.execute("UPDATE relatos SET protocolo=?, status='encaminhado', atualizado_em=? WHERE id=?"
                                  " AND status IN ('confirmado','encaminhado')", (protocolo[:60], agora(), rid))
        if cur.rowcount == 0:
            raise ErroRelato("relato não está confirmado")
        return self.obter(rid)

    def marcar_resolvido(self, rid: str) -> dict:
        t = agora()
        with self.lock, self.db:
            cur = self.db.execute("UPDATE relatos SET status='resolvido', resolvido_em=?, atualizado_em=? WHERE id=?",
                                  (t, t, rid))
        if cur.rowcount == 0:
            raise ErroRelato("relato não encontrado")
        return self.obter(rid)

    def estatisticas(self) -> dict:
        with self.lock:
            rows = self.db.execute("SELECT status, COUNT(*) n FROM relatos GROUP BY status").fetchall()
        return {r["status"]: r["n"] for r in rows}
