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
import os
import sqlite3
import threading
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

CATEGORIAS = ("buraco", "calcada_irregular", "obstaculo", "sem_rampa", "alagamento", "luz_apagada", "obra", "outro")
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
"""


def agora() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def hash_dispositivo(d: str | None) -> str | None:
    if not d:
        return None
    return hashlib.sha256((SAL + d).encode()).hexdigest()[:32]


class ErroRelato(ValueError):
    pass


class Relatos:
    def __init__(self, caminho: Path, seed: Path | None = None):
        Path(caminho).parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(str(caminho), check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.lock = threading.Lock()
        with self.lock:
            self.db.executescript(ESQUEMA)
            vazio = self.db.execute("SELECT COUNT(*) FROM relatos").fetchone()[0] == 0
        if vazio and seed and Path(seed).exists():
            self._semear(json.loads(Path(seed).read_text(encoding="utf-8"))["relatos"])

    def _semear(self, itens: list[dict]) -> None:
        with self.lock, self.db:
            for r in itens:
                self.db.execute(
                    "INSERT OR IGNORE INTO relatos (id, categoria, status, confirmacoes, lat, lon, rua, lado_seguro,"
                    " criado_em, atualizado_em, origem) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                    (r["id"], r["categoria"], r["status"], r["confirmacoes"], r["lat"], r["lon"], r.get("rua"),
                     r.get("lado_seguro"), r["criado_em"], r["criado_em"], r["origem"]))

    @staticmethod
    def _publico(row: sqlite3.Row) -> dict:
        d = dict(row)
        d.pop("dispositivo", None)
        d.pop("foto", None)
        d["validacao_visao"] = json.loads(d["validacao_visao"]) if d.get("validacao_visao") else None
        d["chamado"] = json.loads(d["chamado"]) if d.get("chamado") else None
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
              hash_foto: str | None = None, foto_arquivo: str | None = None, validacao: dict | None = None) -> dict:
        if categoria not in CATEGORIAS:
            raise ErroRelato("categoria inválida")
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
                    " origem, dispositivo, hash_foto, foto, validacao_visao) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (rid, categoria, "em_verificacao", 1, lat, lon, rua, t, t, "app", disp, hash_foto, foto_arquivo,
                     json.dumps(validacao, ensure_ascii=False) if validacao else None))
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
                                " resolvido_em=CASE WHEN ?='resolvido' THEN ? ELSE resolvido_em END WHERE id=?",
                                (conf, neg, status, t, status, t, rid))
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

    # ---- integração com o robô de RPA (UiPath) ---------------------------
    # TODO: integrar fila de moderação humana para relatos INCONCLUSIVOS da visão (hoje entram como em_verificacao).
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
