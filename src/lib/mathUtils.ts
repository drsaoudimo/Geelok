export class Complex {
  constructor(public re: number, public im: number) {}
  add(c: Complex) { return new Complex(this.re + c.re, this.im + c.im); }
  mul(c: Complex) { return new Complex(this.re * c.re - this.im * c.im, this.re * c.im + this.im * c.re); }
  magSq() { return this.re * this.re + this.im * this.im; }
}

export function sfc32(a: number, b: number, c: number, d: number) {
  return function() {
    a |= 0; b |= 0; c |= 0; d |= 0; 
    let t = (a + b | 0) + d | 0;
    d = d + 1 | 0;
    a = b ^ b >>> 9;
    b = c + (c << 3) | 0;
    c = c << 21 | c >>> 11;
    c = c + t | 0;
    return (t >>> 0) / 4294967296;
  }
}

export function getRNG(N: bigint, k: number) {
    const s1 = Number(N % 4294967291n);
    const s2 = Number((N / 4294967291n) % 4294967291n);
    return sfc32(s1, s2 + k, s1 ^ k, k * 1337);
}

export function getGleeokFeature(N: bigint, n: number): number[] {
  let bitStr = N.toString(2);
  if (bitStr.length < n) bitStr = bitStr.padStart(n, '0');
  const bits = bitStr.split('').map(Number);
  
  // Limit n to a safe maximum for browser performance during simulation
  const safeN = Math.min(n, 512); 
  
  const featureVector = new Array(safeN).fill(0).map(() => new Complex(0, 0));
  
  for (let k = 1; k <= safeN; k++) {
    const rng = getRNG(N, k);
    
    // tau_k
    const tau_k = Math.floor(rng() * safeN);
    const phase = (2 * Math.PI * tau_k) / safeN;
    const phaseC = new Complex(Math.cos(phase), Math.sin(phase));
    
    // Permutation
    const permutedBits = [...bits.slice(0, safeN)];
    for (let i = permutedBits.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [permutedBits[i], permutedBits[j]] = [permutedBits[j], permutedBits[i]];
    }
    
    // Spectral Transform Simulation (Walsh-like bipolar mixing)
    for (let i = 0; i < safeN; i++) {
        const valC = new Complex(permutedBits[i] ? 1 : -1, 0);
        featureVector[i] = featureVector[i].add(valC.mul(phaseC));
    }
  }
  
  return featureVector.map(c => c.magSq() / (safeN * safeN));
}

export function distanceSq(v1: number[], v2: number[]): number {
  let sum = 0;
  const len = Math.min(v1.length, v2.length);
  for (let i = 0; i < len; i++) {
    const d = v1[i] - v2[i];
    sum += d * d;
  }
  return sum;
}

export function sqrtBigInt(value: bigint): bigint {
  if (value < 0n) throw new Error('Square root of negative numbers is not supported');
  if (value < 2n) return value;
  let z = value / 2n + 1n;
  let y = z;
  while (true) {
    z = (value / y + y) / 2n;
    if (z >= y) return y;
    y = z;
  }
}
