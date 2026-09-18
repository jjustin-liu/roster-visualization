/** Small dense linear algebra for fitting the portability model. No dependencies. */

/** Eigen-decomposition of a symmetric matrix by cyclic Jacobi rotations; eigenvalues descending. */
export function symmetricEigen(input: number[][]): { values: number[]; vectors: number[][] } {
  const n = input.length;
  const a = input.map((r) => [...r]);
  const v: number[][] = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j): number => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += a[i][j] * a[i][j];
    if (off < 1e-22) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(a[p][q]) < 1e-300) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = a[k][p];
          const akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p][k];
          const aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = v[k][p];
          const vkq = v[k][q];
          v[k][p] = c * vkp - s * vkq;
          v[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }
  const order = a.map((_, i) => i).sort((i, j) => a[j][j] - a[i][i]);
  return { values: order.map((i) => a[i][i]), vectors: order.map((i) => v.map((row) => row[i])) };
}

/** Solve A x = b by Gaussian elimination with partial pivoting. */
export function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const m = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[piv][c])) piv = r;
    [m[c], m[piv]] = [m[piv], m[c]];
    for (let r = c + 1; r < n; r++) {
      const f = m[r][c] / m[c][c];
      if (f === 0) continue;
      for (let k = c; k <= n; k++) m[r][k] -= f * m[c][k];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = m[r][n];
    for (let k = r + 1; k < n; k++) s -= m[r][k] * x[k];
    x[r] = s / m[r][r];
  }
  return x;
}

/** Weighted ridge regression. Column 0 of `F` must be the intercept, which is not penalised. */
export function ridge(F: number[][], t: number[], w: number[], lambda: number): number[] {
  const d = F[0].length;
  const A = Array.from({ length: d }, () => new Array<number>(d).fill(0));
  const b = new Array<number>(d).fill(0);
  for (let r = 0; r < F.length; r++) {
    const f = F[r];
    const wr = w[r];
    for (let i = 0; i < d; i++) {
      const wfi = wr * f[i];
      b[i] += wfi * t[r];
      for (let j = i; j < d; j++) A[i][j] += wfi * f[j];
    }
  }
  for (let i = 0; i < d; i++) {
    for (let j = 0; j < i; j++) A[i][j] = A[j][i];
    if (i > 0) A[i][i] += lambda;
  }
  return solve(A, b);
}

export function weightedR2(t: number[], p: number[], w: number[]): number {
  let sw = 0;
  let st = 0;
  for (let i = 0; i < t.length; i++) {
    sw += w[i];
    st += w[i] * t[i];
  }
  const mean = st / sw;
  let res = 0;
  let tot = 0;
  for (let i = 0; i < t.length; i++) {
    res += w[i] * (t[i] - p[i]) ** 2;
    tot += w[i] * (t[i] - mean) ** 2;
  }
  return 1 - res / tot;
}

export function weightedCorrelation(a: number[], b: number[], w: number[]): number {
  let sw = 0;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < a.length; i++) {
    sw += w[i];
    ma += w[i] * a[i];
    mb += w[i] * b[i];
  }
  ma /= sw;
  mb /= sw;
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  for (let i = 0; i < a.length; i++) {
    sab += w[i] * (a[i] - ma) * (b[i] - mb);
    saa += w[i] * (a[i] - ma) ** 2;
    sbb += w[i] * (b[i] - mb) ** 2;
  }
  return sab / Math.sqrt(saa * sbb);
}

/** Value at each of `count` evenly spaced weighted quantiles. */
export function weightedQuantiles(values: number[], weights: number[], count: number): number[] {
  const order = values.map((_, i) => i).sort((i, j) => values[i] - values[j]);
  const total = weights.reduce((s, x) => s + x, 0);
  const out: number[] = [];
  let acc = 0;
  let k = 0;
  for (const i of order) {
    acc += weights[i];
    while (k < count && acc / total >= (k + 0.5) / count) {
      out.push(values[i]);
      k++;
    }
  }
  while (out.length < count) out.push(values[order[order.length - 1]]);
  return out;
}

const matMul = (A: number[][], B: number[][]) => A.map((r) => B[0].map((_, j) => r.reduce((s, x, k) => s + x * B[k][j], 0)));
const transpose = (A: number[][]) => A[0].map((_, j) => A.map((r) => r[j]));

/** The orthogonal polar factor U Vᵀ of a small square matrix M = U Σ Vᵀ, via the eigenvectors of MᵀM. */
function polarFactor(M: number[][]): number[][] {
  const { values, vectors } = symmetricEigen(matMul(transpose(M), M));
  const V = transpose(vectors); // columns are eigenvectors
  const MV = matMul(M, V);
  const U = MV.map((row) => row.map((x, j) => x / Math.sqrt(Math.max(values[j], 1e-300))));
  return matMul(U, transpose(V));
}

/**
 * Varimax rotation of a loadings matrix (rows = variables, columns = factors).
 * PCA components are contrasts ("rebounds AND blocks versus threes AND steals");
 * rotating them concentrates each variable on one factor, which is what lets a
 * factor be read as a SKILL. Kaiser's algorithm; deterministic.
 */
export function varimax(loadings: number[][], iterations = 200): number[][] {
  const p = loadings.length;
  const k = loadings[0].length;
  let R: number[][] = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j): number => (i === j ? 1 : 0)));
  let last = 0;
  for (let it = 0; it < iterations; it++) {
    const L = matMul(loadings, R);
    const colSq = Array.from({ length: k }, (_, j) => L.reduce((s, row) => s + row[j] * row[j], 0));
    const G = L.map((row) => row.map((x, j) => x * x * x - (x * colSq[j]) / p));
    const M = matMul(transpose(loadings), G);
    R = polarFactor(M);
    const crit = matMul(transpose(R), M).reduce((s, row, i) => s + row[i], 0);
    if (last !== 0 && crit / last < 1 + 1e-10) break;
    last = crit;
  }
  return matMul(loadings, R);
}

/** Factor-score weights for rotated loadings L: L (LᵀL)⁻¹, so scores = z · weights. */
export function scoreWeights(L: number[][]): number[][] {
  const k = L[0].length;
  const LtL = matMul(transpose(L), L);
  const inv = transpose(Array.from({ length: k }, (_, j) => solve(LtL, Array.from({ length: k }, (_, i) => (i === j ? 1 : 0)))));
  return matMul(L, inv);
}
