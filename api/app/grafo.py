"""Grafo de acessibilidade (lido do gold do pipeline caminho-livre-dados).

Formato colunar documentado em caminho-livre-dados/docs/dicionario_de_dados.md.
Em memória: listas paralelas + lista de adjacência (nó -> [(vizinho, aresta)]).
"""
from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path

R_TERRA = 6_371_000.0
F_TRAVESSIA, F_SEMAFORO, F_SONORO, F_GUIA_REB, F_GUIA_ELEV, F_TATIL, F_ALAGA = 1, 2, 4, 8, 16, 32, 64
SUP_NOMES = ["boa", "irregular", "ruim", "sem_dado"]
TRI_NOMES = ["sim", "nao", "sem_dado"]
VIAS_GRANDES = {"primary", "primary_link", "secondary", "secondary_link", "trunk", "trunk_link"}


def distancia_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R_TERRA * math.asin(math.sqrt(a))


def rumo(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Azimute em graus (0 = norte, 90 = leste)."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dl = math.radians(lon2 - lon1)
    y = math.sin(dl) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def dist_ponto_segmento(lat, lon, a_lat, a_lon, b_lat, b_lon) -> tuple[float, float]:
    """Distância (m) de P ao segmento AB e fração t (0..1) da projeção.
    Projeção equirretangular local: erro desprezível em poucos km."""
    kx = 111_320 * math.cos(math.radians(lat))
    ky = 110_540
    ax, ay = (a_lon - lon) * kx, (a_lat - lat) * ky
    bx, by = (b_lon - lon) * kx, (b_lat - lat) * ky
    dx, dy = bx - ax, by - ay
    L2 = dx * dx + dy * dy
    t = 0.0 if L2 == 0 else max(0.0, min(1.0, -(ax * dx + ay * dy) / L2))
    px, py = ax + t * dx, ay + t * dy
    return math.hypot(px, py), t


@dataclass
class Aresta:
    u: int
    v: int
    comp: float
    nome: str
    tipo: str
    sup: str
    calc: str
    ilum: str
    escada: bool
    travessia: bool
    inc: float


class Grafo:
    PASSO_GRADE = 0.0015  # ~165 m

    def __init__(self, caminho: Path | None = None, dados: dict | None = None):
        g = dados if dados is not None else json.loads(Path(caminho).read_text(encoding="utf-8"))
        self.meta = g["meta"]
        n, a = g["nos"], g["arestas"]
        self.lat: list[float] = n["lat"]
        self.lon: list[float] = n["lon"]
        self.alt: list[float] = n["alt"]
        self.flags: list[int] = n["flags"]
        nomes, tipos = g["nomes"], g["tipos"]
        self.arestas: list[Aresta] = [
            Aresta(u, v, c, nomes[nm], tipos[tp], SUP_NOMES[s], TRI_NOMES[cl], TRI_NOMES[il], bool(es), bool(tr), inc)
            for u, v, c, nm, tp, s, cl, il, es, tr, inc in zip(
                a["u"], a["v"], a["comp"], a["nome"], a["tipo"], a["sup"], a["calc"], a["ilum"], a["esc"], a["trav"], a["inc"])
        ]
        self.adj: list[list[tuple[int, int]]] = [[] for _ in self.lat]
        for i, e in enumerate(self.arestas):
            self.adj[e.u].append((e.v, i))
            self.adj[e.v].append((e.u, i))
        # Índice espacial de arestas (pelo ponto médio e extremidades).
        self._grade: dict[tuple[int, int], list[int]] = {}
        for i, e in enumerate(self.arestas):
            celulas = {self._cel(self.lat[e.u], self.lon[e.u]), self._cel(self.lat[e.v], self.lon[e.v])}
            for c in celulas:
                self._grade.setdefault(c, []).append(i)
        s, w, no, ea = self.meta["territorio"]["bbox"]
        self.bbox = (s, w, no, ea)

    def _cel(self, lat: float, lon: float) -> tuple[int, int]:
        return int(math.floor(lat / self.PASSO_GRADE)), int(math.floor(lon / self.PASSO_GRADE))

    def dentro_territorio(self, lat: float, lon: float, folga: float = 0.002) -> bool:
        s, w, n, e = self.bbox
        return s - folga <= lat <= n + folga and w - folga <= lon <= e + folga

    def arestas_perto(self, lat: float, lon: float, raio_m: float):
        """Gera (indice_aresta, distancia_m, t) para arestas a até raio_m."""
        ci, cj = self._cel(lat, lon)
        r = int(raio_m / 165) + 1
        vistos = set()
        for di in range(-r, r + 1):
            for dj in range(-r, r + 1):
                for i in self._grade.get((ci + di, cj + dj), ()):
                    if i in vistos:
                        continue
                    vistos.add(i)
                    e = self.arestas[i]
                    d, t = dist_ponto_segmento(lat, lon, self.lat[e.u], self.lon[e.u], self.lat[e.v], self.lon[e.v])
                    if d <= raio_m:
                        yield i, d, t

    def ajustar(self, lat: float, lon: float, raio_m: float = 400):
        """Ponto mais próximo da rede: (aresta, distancia_m, t) ou None."""
        melhor = None
        for i, d, t in self.arestas_perto(lat, lon, raio_m):
            if melhor is None or d < melhor[1]:
                melhor = (i, d, t)
        return melhor

    def no_mais_proximo(self, lat: float, lon: float, raio_m: float = 400):
        aj = self.ajustar(lat, lon, raio_m)
        if aj is None:
            return None
        e = self.arestas[aj[0]]
        return e.u if aj[2] < 0.5 else e.v
