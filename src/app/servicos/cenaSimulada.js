/**
 * Câmera de demonstração: cena 2D de asfalto com um buraco, gerada no aparelho.
 *
 * Por quê: na apresentação o app roda num notebook, e a câmera frontal só vê o rosto de quem
 * apresenta (a visão computacional, corretamente, não acha problema nenhum). Com esta cena, a
 * tela da câmera abre normalmente (o navegador pede permissão), mas o que aparece "ao vivo" e
 * vira foto é este buraco simulado, que o pipeline de visão confirma (ver test/nucleo.test.js).
 *
 * Sempre 640x480: é o tamanho validado (em resolução maior o granulado some na redução e a
 * visão marca FORA_DE_CONTEXTO). Desligar: abrir o app com ?camera=real (vale para a aba).
 */
export const CHAVE_CAMERA_REAL = 'caminhoLivre.cameraReal';

/** Gerador pseudoaleatório com semente (a cena é sempre a mesma). */
function aleatorio(semente) {
  let a = semente >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Gera a cena em RGBA. Asfalto: cinza com granulado; buraco: mancha escura irregular
 * (raio varia com o ângulo), borda esfarelada um pouco mais clara e pedrinhas soltas.
 * @returns {{ data: Uint8ClampedArray, largura: number, altura: number }}
 */
export function gerarCenaBuraco({ largura = 640, altura = 480, semente = 7 } = {}) {
  const rnd = aleatorio(semente);
  const data = new Uint8ClampedArray(largura * altura * 4);
  const cx = largura * 0.5, cy = altura * 0.66;
  const rx = largura * 0.18, ry = altura * 0.13;
  // contorno irregular: soma de senos com fases fixas
  const fases = [rnd() * 6.28, rnd() * 6.28, rnd() * 6.28];
  const raio = (ang) => 1 + 0.12 * Math.sin(3 * ang + fases[0]) + 0.07 * Math.sin(5 * ang + fases[1]) + 0.05 * Math.sin(9 * ang + fases[2]);
  const pedras = Array.from({ length: 26 }, () => ({
    x: cx + (rnd() - 0.5) * rx * 3.4, y: cy + (rnd() - 0.5) * ry * 3.2, r: 2 + rnd() * 3.5, c: 150 + rnd() * 40,
  }));
  for (let y = 0; y < altura; y++) {
    // leve gradiente de luz (mais claro em cima, como luz do dia na rua)
    const luz = 128 - (y / altura) * 14;
    for (let x = 0; x < largura; x++) {
      const i = (y * largura + x) * 4;
      let v = luz + (rnd() - 0.5) * 40;
      const dx = (x - cx) / rx, dy = (y - cy) / ry;
      const d = Math.hypot(dx, dy) / raio(Math.atan2(dy, dx));
      if (d < 1) v = 22 + (rnd() - 0.5) * 16 + d * 10;          // fundo do buraco
      else if (d < 1.12) v = 150 + (rnd() - 0.5) * 50;           // borda esfarelada
      for (const p of pedras) {
        if ((x - p.x) ** 2 + (y - p.y) ** 2 < p.r * p.r && d >= 1.12) { v = p.c; break; }
      }
      data[i] = v + 2; data[i + 1] = v; data[i + 2] = v - 3; data[i + 3] = 255;
    }
  }
  return { data, largura, altura };
}

/** A câmera simulada está ligada? (padrão: sim; ?camera=real desliga nesta aba) */
export function cameraSimulada(href = globalThis.location?.href ?? '') {
  try {
    const q = new URL(href).searchParams.get('camera');
    if (q === 'real') sessionStorage.setItem(CHAVE_CAMERA_REAL, '1');
    if (q === 'simulada') sessionStorage.removeItem(CHAVE_CAMERA_REAL);
    return sessionStorage.getItem(CHAVE_CAMERA_REAL) !== '1';
  } catch {
    return true;
  }
}
