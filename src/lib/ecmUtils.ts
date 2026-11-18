import { getRNG } from './mathUtils';

export let ecmStats = {
    modMuls: 0,
    curveAdds: 0
};

export function resetEcmStats() {
    ecmStats.modMuls = 0;
    ecmStats.curveAdds = 0;
}

export function gcdBigInt(a: bigint, b: bigint): bigint {
    if (a < 0n) a = -a;
    if (b < 0n) b = -b;
    while (b !== 0n) {
        let t = b;
        b = a % b;
        a = t;
    }
    return a;
}

export function montgomeryDouble(X: bigint, Z: bigint, A24: bigint, N: bigint) {
    ecmStats.curveAdds++;
    ecmStats.modMuls += 4;
    let u = (X + Z) % N;
    let v = (X - Z) % N;
    if (u < 0n) u += N;
    if (v < 0n) v += N;
    
    let u2 = (u * u) % N;
    let v2 = (v * v) % N;
    
    let diff = (u2 - v2) % N;
    if (diff < 0n) diff += N;
    
    let X2 = (u2 * v2) % N;
    let Z2 = (diff * (v2 + (A24 * diff) % N)) % N;
    
    return { X: X2, Z: Z2 };
}

export function montgomeryAdd(X1: bigint, Z1: bigint, X2: bigint, Z2: bigint, X_minus: bigint, Z_minus: bigint, N: bigint) {
    ecmStats.curveAdds++;
    ecmStats.modMuls += 4;
    let u1 = (X1 - Z1) % N;
    let v1 = (X1 + Z1) % N;
    if (u1 < 0n) u1 += N;
    if (v1 < 0n) v1 += N;
    
    let u2 = (X2 - Z2) % N;
    let v2 = (X2 + Z2) % N;
    if (u2 < 0n) u2 += N;
    if (v2 < 0n) v2 += N;
    
    let t1 = (u1 * v2) % N;
    let t2 = (v1 * u2) % N;
    
    let add = (t1 + t2) % N;
    let sub = (t1 - t2) % N;
    if (sub < 0n) sub += N;
    
    let add2 = (add * add) % N;
    let sub2 = (sub * sub) % N;
    
    let X3 = (Z_minus * add2) % N;
    let Z3 = (X_minus * sub2) % N;
    
    return { X: X3, Z: Z3 };
}

const primesCache: number[] = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71, 73, 79, 83, 89, 97];
function getPrimesUpTo(max: number): number[] {
    if (primesCache[primesCache.length - 1] >= max) {
        return primesCache.filter(p => p <= max);
    }
    let last = primesCache[primesCache.length - 1];
    for (let i = last + 2; i <= max; i += 2) {
        let isPrime = true;
        let sqrtI = Math.sqrt(i);
        for (let j = 0; primesCache[j] <= sqrtI; j++) {
            if (i % primesCache[j] === 0) {
                isPrime = false;
                break;
            }
        }
        if (isPrime) primesCache.push(i);
    }
    return primesCache.filter(p => p <= max);
}

export function ecmMultiplyMontgomeryBatch(X: bigint, Z: bigint, B1: number, A24: bigint, N: bigint): bigint | undefined {
    let X1 = X;
    let Z1 = Z;
    let B1Primes = getPrimesUpTo(B1);
    
    let gcdAccumulator = 1n;
    
    for (let i = 0; i < B1Primes.length; i++) {
        let p = B1Primes[i];
        let power = p;
        while (power * p <= B1) power *= p;
        
        let kBits = power.toString(2);
        
        let X2 = X1;
        let Z2 = Z1;
        let d = montgomeryDouble(X1, Z1, A24, N);
        let X3 = d.X;
        let Z3 = d.Z;
        
        for (let j = 1; j < kBits.length; j++) {
            if (kBits[j] === '0') {
                let add = montgomeryAdd(X2, Z2, X3, Z3, X1, Z1, N);
                X3 = add.X; Z3 = add.Z;
                let dbl = montgomeryDouble(X2, Z2, A24, N);
                X2 = dbl.X; Z2 = dbl.Z;
            } else {
                let add = montgomeryAdd(X2, Z2, X3, Z3, X1, Z1, N);
                X2 = add.X; Z2 = add.Z;
                let dbl = montgomeryDouble(X3, Z3, A24, N);
                X3 = dbl.X; Z3 = dbl.Z;
            }
        }
        X1 = X2;
        Z1 = Z2;
        
        gcdAccumulator = (gcdAccumulator * Z1) % N;
        
        if (i % 50 === 49 || i === B1Primes.length - 1) {
            let g = gcdBigInt(gcdAccumulator, N);
            if (g > 1n) {
                if (g < N) return g;
                let gIndiv = gcdBigInt(Z1, N);
                if (gIndiv > 1n && gIndiv < N) return gIndiv;
            }
        }
    }
    return undefined;
}

export function getGleeokCurveMontgomery(N: bigint, k_idx: number) {
    const rng = getRNG(N, k_idx);
    
    const getRandomBig = () => {
        let low = Math.floor(rng() * 4294967296);
        let high = Math.floor(rng() * 4294967296);
        let v = (BigInt(high) << 32n) | BigInt(low);
        return (v % N + N) % N;
    };
    
    let X = getRandomBig() || 2n;
    let Z = 1n;
    let A24 = getRandomBig();
    
    return { X, Z, A24 };
}

export function calculateCurvePriority(N: bigint, featureStability: number, entropy: number, idx: number): number {
    const rng = getRNG(N, idx + 10000); // offset seed for priority scoring
    const baseScore = rng() * 100;
    const stabilityWeight = featureStability * 10;
    const entropyWeight = entropy * 20;
    return baseScore + stabilityWeight + entropyWeight;
}
