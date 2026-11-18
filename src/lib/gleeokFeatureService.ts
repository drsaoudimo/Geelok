import { getRNG, Complex } from './mathUtils';

export function calculateEntropy(bits: number[]): number {
    let ones = 0;
    for (const b of bits) ones += b;
    const p1 = ones / bits.length;
    const p0 = 1 - p1;
    if (p1 === 0 || p0 === 0) return 0;
    return -(p1 * Math.log2(p1) + p0 * Math.log2(p0));
}

export function calculateBitDensity(bits: number[]): number {
    let ones = 0;
    for (const b of bits) ones += b;
    return ones / bits.length;
}

export function getGleeokFeatureAdvanced(N: bigint, n: number): {
    featureVector: number[],
    stability: number,
    entropy: number,
    bitDensity: number,
    convergence: number,
    qualityIndex: number,
    timings: number[] // Latencies per round
} {
    let bitStr = N.toString(2);
    if (bitStr.length < n) bitStr = bitStr.padStart(n, '0');
    const bits = bitStr.split('').map(Number);
    
    const safeN = Math.min(n, 2048); // Cap for browser performance while maintaining theory
    
    const featureVector = new Array(safeN).fill(0).map(() => new Complex(0, 0));
    const timings: number[] = [];
    
    let totalDeviation = 0;

    for (let k = 1; k <= safeN; k++) {
        const start = performance.now();
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
        
        let roundDeviation = 0;
        // Spectral Transform Simulation
        for (let i = 0; i < safeN; i++) {
            const valC = new Complex(permutedBits[i] ? 1 : -1, 0);
            const projection = valC.mul(phaseC);
            featureVector[i] = featureVector[i].add(projection);
            roundDeviation += projection.magSq();
        }
        
        totalDeviation += roundDeviation / safeN;
        timings.push(performance.now() - start);
    }
    
    const finalFeature = featureVector.map(c => c.magSq() / (safeN * safeN));
    
    const entropy = calculateEntropy(bits);
    const bitDensity = calculateBitDensity(bits);
    
    const stability = totalDeviation / safeN;
    const convergence = 1 / (1 + stability);
    const qualityIndex = (entropy * convergence * bitDensity) * 100;

    return {
        featureVector: finalFeature,
        stability,
        entropy,
        bitDensity,
        convergence,
        qualityIndex,
        timings
    };
}

export interface GleeokFingerprint {
  N: string;
  B: {
    binary: string;
    bitLength: number;
    density: number;
  };
  M: {
    bitLength: number;
    popCount: number;
    density: number;
    runCount: number;
    transitions: number;
    longestRun: number;
    entropy: number;
    balance: number;
    symmetry: number;
  };
  S: {
    featureVector: number[];
    spectralCentroid: number;
    spectralEnergy: number;
    spectralVariance: number;
    dominantFrequency: number;
    spectralEntropy: number;
  };
  R: {
    primes: number[];
    residues: number[];
  };
  metrics: {
    complexity: number;
    stability: number;
    sensitivity: number;
    inertia: number;
    energy: number;
  };
}

export function extractGleeokFingerprint(N: bigint): GleeokFingerprint {
  const binary = N.toString(2);
  const bitLength = binary.length;
  const bits = binary.split('').map(Number);

  // 1. Morphological Features (M)
  let popCount = 0;
  for (const b of bits) if (b === 1) popCount++;
  const density = popCount / bitLength;

  let transitions = 0;
  let runCount = 1;
  let currentRun = 1;
  let longestRun = 1;

  for (let i = 1; i < bits.length; i++) {
    if (bits[i] !== bits[i - 1]) {
      transitions++;
      runCount++;
      if (currentRun > longestRun) {
        longestRun = currentRun;
      }
      currentRun = 1;
    } else {
      currentRun++;
    }
  }
  if (currentRun > longestRun) {
    longestRun = currentRun;
  }

  const entropy = calculateEntropy(bits);
  const balance = Math.abs(popCount - (bitLength - popCount)) / bitLength;

  // Symmetry: compare first half to reversed second half
  let mismatches = 0;
  const halfLen = Math.floor(bits.length / 2);
  for (let i = 0; i < halfLen; i++) {
    if (bits[i] !== bits[bits.length - 1 - i]) {
      mismatches++;
    }
  }
  const symmetry = 1 - (halfLen > 0 ? mismatches / halfLen : 0);

  // 2. Spectral Features (S)
  // Use a fast or standard feature size (capped at 128 for general UI responsiveness)
  const specN = Math.min(bitLength, 128);
  const featData = getGleeokFeatureAdvanced(N, specN);
  const featureVector = featData.featureVector;

  // Centroid
  let sumWeighted = 0;
  let sumVal = 0;
  let spectralEnergy = 0;
  let maxVal = -1;
  let dominantFrequency = 0;

  for (let i = 0; i < featureVector.length; i++) {
    const val = featureVector[i];
    sumWeighted += i * val;
    sumVal += val;
    spectralEnergy += val * val;
    if (val > maxVal) {
      maxVal = val;
      dominantFrequency = i;
    }
  }

  const spectralCentroid = sumVal > 0 ? sumWeighted / sumVal : 0;

  // Variance
  const meanSpec = sumVal / featureVector.length;
  let specVarianceSum = 0;
  for (const val of featureVector) {
    specVarianceSum += (val - meanSpec) * (val - meanSpec);
  }
  const spectralVariance = featureVector.length > 0 ? specVarianceSum / featureVector.length : 0;

  // Spectral Entropy
  let spectralEntropy = 0;
  if (sumVal > 0) {
    for (const val of featureVector) {
      const p = val / sumVal;
      if (p > 0) {
        spectralEntropy -= p * Math.log2(p);
      }
    }
  }

  // 3. Residue Profile (R)
  const primes = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47];
  const residues = primes.map(p => Number(N % BigInt(p)));

  // 4. Complexity & Stability
  // Complexity(N) = w1 * entropy + w2 * transitions/bitLength + w3 * runCount/bitLength + w4 * spectralCentroid/specN + w5 * density
  const complexity = 0.3 * entropy + 
                     0.2 * (transitions / Math.max(1, bitLength)) + 
                     0.2 * (runCount / Math.max(1, bitLength)) + 
                     0.15 * (spectralCentroid / Math.max(1, specN)) + 
                     0.15 * density;

  const stability = featData.stability;

  // 5. Sensitivity (SV with delta = 1)
  // Calculate morphological vector of N+1 to get fast difference
  const nextN = N + 1n;
  const nextBinary = nextN.toString(2);
  const nextBitLength = nextBinary.length;
  const nextBits = nextBinary.split('').map(Number);
  let nextPopCount = 0;
  for (const b of nextBits) if (b === 1) nextPopCount++;
  const nextDensity = nextPopCount / nextBitLength;
  const nextEntropy = calculateEntropy(nextBits);

  let nextTransitions = 0;
  let nextRunCount = 1;
  for (let i = 1; i < nextBits.length; i++) {
    if (nextBits[i] !== nextBits[i - 1]) {
      nextTransitions++;
      nextRunCount++;
    }
  }

  // Quantify Morphological Difference as Sensitivity
  const sensitivity = Math.min(1, Math.max(0, 
    Math.abs(density - nextDensity) * 5 +
    Math.abs(entropy - nextEntropy) * 2 +
    Math.abs(transitions - nextTransitions) / Math.max(1, bitLength) +
    Math.abs(runCount - nextRunCount) / Math.max(1, bitLength) +
    (bitLength !== nextBitLength ? 0.5 : 0)
  ));

  const inertia = 1 / (1 + sensitivity);

  // Structural Energy: combination of complexity, entropy, and spectral energy
  const energy = Math.min(1, Math.max(0, 
    (complexity * 0.4) + (spectralEnergy * 0.3) + (entropy * 0.3)
  ));

  return {
    N: N.toString(),
    B: {
      binary,
      bitLength,
      density
    },
    M: {
      bitLength,
      popCount,
      density,
      runCount,
      transitions,
      longestRun,
      entropy,
      balance,
      symmetry
    },
    S: {
      featureVector,
      spectralCentroid,
      spectralEnergy,
      spectralVariance,
      dominantFrequency,
      spectralEntropy
    },
    R: {
      primes,
      residues
    },
    metrics: {
      complexity,
      stability,
      sensitivity,
      inertia,
      energy
    }
  };
}

// Compare two fingerprints using normalized features (Fingerprint Algebra)
export function compareGleeokFingerprints(f1: GleeokFingerprint, f2: GleeokFingerprint): {
  difference: number;
  similarity: number;
} {
  // We compute Euclidean distance between morphological vectors & key metrics
  const diffM = 
    Math.pow(f1.M.density - f2.M.density, 2) +
    Math.pow(f1.M.entropy - f2.M.entropy, 2) +
    Math.pow(f1.M.balance - f2.M.balance, 2) +
    Math.pow(f1.M.symmetry - f2.M.symmetry, 2) +
    Math.pow((f1.M.transitions / f1.M.bitLength) - (f2.M.transitions / f2.M.bitLength), 2) +
    Math.pow((f1.M.runCount / f1.M.bitLength) - (f2.M.runCount / f2.M.bitLength), 2);

  const diffS = 
    Math.pow((f1.S.spectralCentroid / f1.S.featureVector.length) - (f2.S.spectralCentroid / f2.S.featureVector.length), 2) +
    Math.pow(f1.S.spectralEnergy - f2.S.spectralEnergy, 2) +
    Math.pow(f1.S.spectralEntropy - f2.S.spectralEntropy, 2);

  // Residue profile distance
  let diffR = 0;
  for (let i = 0; i < f1.R.primes.length; i++) {
    const r1Norm = f1.R.residues[i] / f1.R.primes[i];
    const r2Norm = f2.R.residues[i] / f2.R.primes[i];
    diffR += Math.pow(r1Norm - r2Norm, 2);
  }
  diffR = diffR / f1.R.primes.length;

  const totalDist = Math.sqrt(diffM + diffS + diffR);
  const similarity = 1 / (1 + totalDist);

  return {
    difference: totalDist,
    similarity
  };
}
