import { 
    getGleeokCurveMontgomery, 
    calculateCurvePriority,
    ecmMultiplyMontgomeryBatch
} from '../lib/ecmUtils';

export interface EcmTask {
    idx: number;
    priority: number;
    X: bigint;
    Z: bigint;
    A24: bigint;
}

export class ECMService {
    /**
     * Verification Module:
     * Takes a candidate factor 'p', calculates 'q = N / p',
     * and performs a final modular integrity check (N = p * q).
     */
    static verifyFactor(N: bigint, p: bigint): { valid: boolean; q?: bigint } {
        if (p <= 1n || p >= N) return { valid: false };
        if (N % p === 0n) {
            const q = N / p;
            if (p * q === N) {
                return { valid: true, q };
            }
        }
        return { valid: false };
    }

    /**
     * Calculates a B1 limit that scales with n (bit length) and the current search attempt.
     * Higher bit lengths and successive search attempts lead to proportionally larger B1 parameters,
     * allowing for systematic testing of semi-primes up to 1024-bit.
     */
    static getB1Limit(nBits: number, attempt: number = 1): number {
        let baseB1 = 2000;
        
        if (nBits <= 40) {
            baseB1 = 2000;
        } else if (nBits <= 64) {
            baseB1 = 15000;
        } else if (nBits <= 128) {
            baseB1 = 50000;
        } else if (nBits <= 256) {
            baseB1 = 150000;
        } else if (nBits <= 512) {
            baseB1 = 450000;
        } else if (nBits <= 768) {
            baseB1 = 800000;
        } else {
            // 1024-bit and higher semi-primes
            baseB1 = 1500000;
        }

        // Scale B1 progressively across search depth/attempts
        const scaleFactor = 1 + Math.log2(attempt) * 0.5;
        return Math.floor(baseB1 * scaleFactor);
    }

    /**
     * Service Layer: 
     * Generate and prioritize curves based on Gleeok-n structural footprints.
     */
    static generateCurves(N: bigint, count: number, stability: number, entropy: number, startIndex: number = 1): EcmTask[] {
        const tasks: EcmTask[] = [];
        for (let i = 0; i < count; i++) {
            const idx = startIndex + i;
            const priority = calculateCurvePriority(N, stability, entropy, idx);
            const { X, Z, A24 } = getGleeokCurveMontgomery(N, idx);
            tasks.push({ idx, priority, X, Z, A24 });
        }
        // Sort descending by priority (highest priority first)
        return tasks.sort((a, b) => b.priority - a.priority);
    }

    /**
     * Service Layer:
     * Execute ECM on a specific curve.
     */
    static executeCurve(task: EcmTask, B1: number, N: bigint): bigint | null {
        const factor = ecmMultiplyMontgomeryBatch(task.X, task.Z, B1, task.A24, N);
        return factor || null;
    }

    /**
     * Robust ECM Loop:
     * Iterates through a configured batch of prioritized curves, performing Montgomery multiplication
     * and immediate verification checks to find non-trivial factors of N.
     */
    static runEcmLoop(
        N: bigint, 
        maxCurves: number = 40, 
        attempt: number = 1, 
        stability: number = 5.0, 
        entropy: number = 5.0,
        onProgress?: (index: number, currentB1: number) => void
    ): { p: bigint; q: bigint; method: string } | null {
        const nBits = N.toString(2).length;
        const B1 = this.getB1Limit(nBits, attempt);
        const startIndex = (attempt - 1) * maxCurves + 1;
        
        const tasks = this.generateCurves(N, maxCurves, stability, entropy, startIndex);
        
        for (let i = 0; i < tasks.length; i++) {
            const task = tasks[i];
            const factor = this.executeCurve(task, B1, N);
            
            if (factor) {
                const verification = this.verifyFactor(N, factor);
                if (verification.valid && verification.q) {
                    const p = factor;
                    const q = verification.q;
                    const pMin = p < q ? p : q;
                    const qMax = p < q ? q : p;
                    return {
                        p: pMin,
                        q: qMax,
                        method: `Lenstra's ECM (المنحنيات الإهليلجية - المحاولة ${attempt}, المنحنى ${task.idx}, B1=${B1})`
                    };
                }
            }
            
            if (onProgress) {
                onProgress(i + 1, B1);
            }
        }
        
        return null;
    }
}

