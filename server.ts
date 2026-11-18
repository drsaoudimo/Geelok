import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";

const app = express();
const PORT = 3000;

app.use(express.json());

// --- Gleeok Local Mathematical Engine ---

// 1. Greatest Common Divisor
function gcdBigInt(a: bigint, b: bigint): bigint {
  if (a < 0n) a = -a;
  if (b < 0n) b = -b;
  while (b !== 0n) {
    const t = b;
    b = a % b;
    a = t;
  }
  return a;
}

// 2. Square Root for BigInt
function sqrtBigInt(value: bigint): bigint {
  if (value < 0n) throw new Error("Square root of negative numbers is not supported");
  if (value < 2n) return value;
  let z = value / 2n + 1n;
  let y = z;
  while (true) {
    z = (value / y + y) / 2n;
    if (z >= y) return y;
    y = z;
  }
}

// 3. Power Mod (Modular Exponentiation)
function powerMod(base: bigint, exp: bigint, mod: bigint): bigint {
  let res = 1n;
  base = base % mod;
  while (exp > 0n) {
    if (exp % 2n === 1n) res = (res * base) % mod;
    base = (base * base) % mod;
    exp = exp / 2n;
  }
  return res;
}

// 4. Miller-Rabin Primality Test for Verification
function millerRabin(n: bigint, k = 5): boolean {
  if (n <= 1n) return false;
  if (n === 2n || n === 3n) return true;
  if (n % 2n === 0n) return false;

  let d = n - 1n;
  let s = 0n;
  while (d % 2n === 0n) {
    d /= 2n;
    s++;
  }

  const bases = [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n];
  for (const a of bases) {
    if (a >= n) break;
    let x = powerMod(a, d, n);
    if (x === 1n || x === n - 1n) continue;
    let composite = true;
    for (let r = 1n; r < s; r++) {
      x = (x * x) % n;
      if (x === n - 1n) {
        composite = false;
        break;
      }
    }
    if (composite) return false;
  }
  return true;
}

// 5. Fermat Factorization with Custom Start Offset (Optimized for |p - q| close to zero)
function fermatFactorWithOffset(n: bigint, maxIterations = 100000, offset = 0n): { p: bigint, q: bigint } | null {
  let a = sqrtBigInt(n);
  if (a * a === n) {
    return { p: a, q: a };
  }
  a += 1n + offset;
  let b2 = a * a - n;
  for (let i = 0; i < maxIterations; i++) {
    const b = sqrtBigInt(b2);
    if (b * b === b2) {
      const p = a - b;
      const q = a + b;
      return { p, q };
    }
    a += 1n;
    b2 = a * a - n;
  }
  return null;
}

// 6. Pollard's p - 1 Algorithm (Excellent for smooth factors)
function pollardsPMinus1(n: bigint, B = 100000n): { p: bigint, q: bigint } | null {
  let a = 2n;
  for (let k = 2n; k <= B; k++) {
    a = powerMod(a, k, n);
    if (k % 2000n === 0n) {
      const g = gcdBigInt(a - 1n, n);
      if (g > 1n && g < n) {
        return { p: g, q: n / g };
      }
    }
  }
  const g = gcdBigInt(a - 1n, n);
  if (g > 1n && g < n) {
    return { p: g, q: n / g };
  }
  return null;
}

// 7. Pollard's Rho Algorithm with Brent's Fast Cycle Detection and Customizable Constant 'c'
function pollardsRhoBrentWithC(n: bigint, maxSteps = 250000, startC = 1n): { p: bigint, q: bigint } | null {
  if (n % 2n === 0n) return { p: 2n, q: n / 2n };
  if (n % 3n === 0n) return { p: 3n, q: n / 3n };

  let x = 2n;
  let y = 2n;
  let r = 1;
  let q_acc = 1n;
  let g = 1n;
  let ys = 2n;
  let c = startC;

  const f = (val: bigint) => (val * val + c) % n;

  for (let step = 0; step < maxSteps; ) {
    x = y;
    for (let i = 0; i < r; i++) {
      y = f(y);
    }
    
    let k = 0;
    while (k < r && step < maxSteps) {
      ys = y;
      const limit = Math.min(r - k, 128);
      for (let i = 0; i < limit; i++) {
        y = f(y);
        const diff = x > y ? x - y : y - x;
        q_acc = (q_acc * diff) % n;
      }
      g = gcdBigInt(q_acc, n);
      k += limit;
      step += limit;
      if (g > 1n) break;
    }
    
    if (g > 1n) {
      if (g < n) {
        return { p: g, q: n / g };
      }
      // Backtrack
      y = ys;
      while (true) {
        y = f(y);
        const diff = x > y ? x - y : y - x;
        g = gcdBigInt(diff, n);
        if (g > 1n) {
          if (g < n) {
            return { p: g, q: n / g };
          }
          break; // Try another parameter c
        }
      }
    }
    
    r *= 2;
    c += 1n;
    x = 2n;
    y = 2n;
  }
  return null;
}

// 8. Lenstra's Elliptic Curve Method (ECM) using Montgomery Curve Arithmetic with Curve Offset
function montDouble(X: bigint, Z: bigint, A24: bigint, N: bigint) {
  let u = (X + Z) % N;
  let v = (X - Z) % N;
  if (u < 0n) u += N;
  if (v < 0n) v += N;
  const u2 = (u * u) % N;
  const v2 = (v * v) % N;
  let diff = (u2 - v2) % N;
  if (diff < 0n) diff += N;
  const X2 = (u2 * v2) % N;
  const Z2 = (diff * (v2 + (A24 * diff) % N)) % N;
  return { X: X2, Z: Z2 };
}

function montAdd(X1: bigint, Z1: bigint, X2: bigint, Z2: bigint, X_minus: bigint, Z_minus: bigint, N: bigint) {
  let u1 = (X1 - Z1) % N;
  let v1 = (X1 + Z1) % N;
  if (u1 < 0n) u1 += N;
  if (v1 < 0n) v1 += N;
  let u2 = (X2 - Z2) % N;
  let v2 = (X2 + Z2) % N;
  if (u2 < 0n) u2 += N;
  if (v2 < 0n) v2 += N;
  const t1 = (u1 * v2) % N;
  const t2 = (v1 * u2) % N;
  const add = (t1 + t2) % N;
  let sub = (t1 - t2) % N;
  if (sub < 0n) sub += N;
  const add2 = (add * add) % N;
  const sub2 = (sub * sub) % N;
  const X3 = (Z_minus * add2) % N;
  const Z3 = (X_minus * sub2) % N;
  return { X: X3, Z: Z3 };
}

function runEcmOnServerWithOffset(N: bigint, maxCurves = 40, B1 = 8000, curveStartIdx = 1): { p: bigint, q: bigint } | null {
  // Sieve of Eratosthenes to get primes up to B1
  const primes: number[] = [];
  const isPrime = new Uint8Array(B1 + 1);
  isPrime.fill(1);
  for (let p = 2; p <= B1; p++) {
    if (isPrime[p]) {
      primes.push(p);
      for (let i = p * p; i <= B1; i += p) {
        isPrime[i] = 0;
      }
    }
  }

  // Iterate over curves
  for (let curveIdx = curveStartIdx; curveIdx < curveStartIdx + maxCurves; curveIdx++) {
    const seed = Number(N % 1000003n) + curveIdx * 10007;
    let randVal = BigInt(seed);
    const getRandomBig = () => {
      randVal = (randVal * 48271n) % 2147483647n;
      return randVal % N;
    };

    const X = getRandomBig() || 2n;
    const Z = 1n;
    const A = getRandomBig() || 4n;
    // Compute A24 = (A + 2) * 4^(-1) mod N
    const A24 = ((A + 2n) * powerMod(4n, N - 2n, N)) % N;

    let X1 = X;
    let Z1 = Z;
    let gcdAccumulator = 1n;

    for (let i = 0; i < primes.length; i++) {
      const p = primes[i];
      let power = p;
      while (power * p <= B1) power *= p;

      const kBits = power.toString(2);
      let X2 = X1;
      let Z2 = Z1;
      const d = montDouble(X1, Z1, A24, N);
      let X3 = d.X;
      let Z3 = d.Z;

      for (let j = 1; j < kBits.length; j++) {
        if (kBits[j] === '0') {
          const add = montAdd(X2, Z2, X3, Z3, X1, Z1, N);
          X3 = add.X; Z3 = add.Z;
          const dbl = montDouble(X2, Z2, A24, N);
          X2 = dbl.X; Z2 = dbl.Z;
        } else {
          const add = montAdd(X2, Z2, X3, Z3, X1, Z1, N);
          X2 = add.X; Z2 = add.Z;
          const dbl = montDouble(X3, Z3, A24, N);
          X3 = dbl.X; Z3 = dbl.Z;
        }
      }
      X1 = X2;
      Z1 = Z2;

      gcdAccumulator = (gcdAccumulator * Z1) % N;

      if (i % 50 === 49 || i === primes.length - 1) {
        const g = gcdBigInt(gcdAccumulator, N);
        if (g > 1n) {
          if (g < N) {
            return { p: g, q: N / g };
          }
          const gIndiv = gcdBigInt(Z1, N);
          if (gIndiv > 1n && gIndiv < N) {
            return { p: gIndiv, q: N / gIndiv };
          }
        }
      }
    }
  }
  return null;
}

// 9. Consolidated Local Factorizer Router with Adaptive Bit-Length Scaling
function factorLocally(n: bigint, attempt = 1): { p: bigint, q: bigint, method: string } | null {
  const bitLen = n.toString(2).length;

  // A. Trial Division for small primes up to 100000 on first attempt
  if (attempt === 1) {
    const smallPrimesLimit = 100000n;
    if (n % 2n === 0n) return n === 2n ? null : { p: 2n, q: n / 2n, method: "Trial Division (القسمة التجريبية للأعداد الزوجية)" };
    
    for (let d = 3n; d * d <= n && d <= smallPrimesLimit; d += 2n) {
      if (n % d === 0n) {
        return { p: d, q: n / d, method: "Trial Division (القسمة التجريبية السريعة)" };
      }
    }
  }

  // B. Fermat Factorization - check a disjoint range on each attempt (Ultra-fast for |p-q| < 2^280)
  const fermatSteps = bitLen >= 500 ? 50000 : 25000;
  const fermatOffset = BigInt(attempt - 1) * BigInt(fermatSteps);
  const fermat = fermatFactorWithOffset(n, fermatSteps, fermatOffset);
  if (fermat) {
    return { ...fermat, method: `Fermat's Factorization (تحليل فيرما للمربعات المتقاربة - محاولة ${attempt})` };
  }

  // C. Pollard's p-1 Algorithm - increase smoothness bound for 556-bit and large semiprimes
  const basePMinus1B = bitLen >= 500 ? 180000n : 100000n;
  const pMinus1B = basePMinus1B + BigInt(attempt - 1) * 80000n;
  const pMinus1 = pollardsPMinus1(n, pMinus1B);
  if (pMinus1) {
    return { ...pMinus1, method: `Pollard's p-1 (بولارد p-1 للأعداد السلسة B1=${pMinus1B} - محاولة ${attempt})` };
  }

  // D. Pollard's Rho - vary the polynomial constant 'c' based on the attempt
  const baseRhoSteps = bitLen >= 500 ? 220000 : 160000;
  const rhoSteps = baseRhoSteps + (attempt - 1) * 50000;
  const rho = pollardsRhoBrentWithC(n, rhoSteps, BigInt(attempt));
  if (rho) {
    return { ...rho, method: `Pollard's Rho Brent (بولارد رو المطورة بـ Brent - محاولة ${attempt})` };
  }

  // E. Lenstra's Elliptic Curve Method (ECM) - high-performance Montgomery curves
  const ecmCurves = bitLen >= 500 ? 50 : 40;
  const baseB1 = bitLen >= 500 ? 12000 : 6000;
  const ecmB1 = baseB1 + (attempt - 1) * 6000;
  const curveStartIdx = (attempt - 1) * ecmCurves + 1;
  const ecm = runEcmOnServerWithOffset(n, ecmCurves, ecmB1, curveStartIdx);
  if (ecm) {
    return { ...ecm, method: `Lenstra's ECM (المنحنيات الإهليلجية - مجموعة ${attempt}، B1=${ecmB1})` };
  }

  return null;
}

// --- API Endpoints ---

// Health check route
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

// Pure Mathematical Factoring Endpoint - ZERO AI, ZERO KEY REQUIRED
app.post("/api/gleeok/factor", (req, res) => {
  const { N, attempt } = req.body;
  if (!N) {
     res.status(400).json({ error: "معامل N مطلوب" });
     return;
  }

  try {
    const bigintN = BigInt(N.toString().replace(/\s/g, ''));
    if (bigintN <= 3n) {
       res.status(400).json({ error: "يجب أن يكون العدد أكبر من 3" });
       return;
    }

    const currentAttempt = Number(attempt) || 1;

    // Run local mathematical solver with the current attempt parameters
    const localResult = factorLocally(bigintN, currentAttempt);
    
    if (localResult) {
      // Sort p <= q
      let p = localResult.p;
      let q = localResult.q;
      if (p > q) {
        const tmp = p;
        p = q;
        q = tmp;
      }

      res.json({
        p: p.toString(),
        q: q.toString(),
        success: true,
        method: localResult.method,
        explanation: `تم استخراج العوامل بنجاح فائق ومحلي 100% في المحاولة رقم [${currentAttempt}] باستخدام خوارزمية [${localResult.method}].`
      });
    } else {
      res.json({
        success: false,
        attempt: currentAttempt,
        explanation: `المحاولة رقم [${currentAttempt}] لم تسفر عن عوامل رقمية. تم فحص نطاقات فيرما، وسلاسة بولارد، ومنحنيات إهليلجية جديدة بالكامل.`
      });
    }

  } catch (error: any) {
    console.error("Gleeok Mathematical Factorization Error:", error);
    res.status(500).json({ 
      error: error.message || "حدث خطأ غير متوقع أثناء المعالجة الرياضية للعدد." 
    });
  }
});

// Vite middleware for development vs static asset serving for production
async function setupServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

setupServer();
