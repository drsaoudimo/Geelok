import * as forge from 'node-forge';

export function parsePemToN(pem: string): bigint | null {
    try {
        const pki = forge.pki;
        let key: any;
        try {
            key = pki.publicKeyFromPem(pem);
        } catch (e1) {
            try {
                key = pki.privateKeyFromPem(pem);
            } catch (e2) {
                // Not a valid PEM, which is expected for raw integer inputs
                return null;
            }
        }
        
        if (key && key.n) {
            return BigInt(key.n.toString(10));
        }
    } catch (e) {
        // General error, also expected for non-PEM inputs
    }
    return null;
}

function gcd(a: bigint, b: bigint): bigint {
    a = a < 0n ? -a : a;
    b = b < 0n ? -b : b;
    while (b !== 0n) {
        const t = b;
        b = a % b;
        a = t;
    }
    return a;
}

function modInverse(a: bigint, m: bigint): bigint {
    if (m <= 1n) return 0n;
    let m0 = m;
    let y = 0n, x = 1n;
    let aVal = ((a % m) + m) % m;
    if (aVal === 0n) return 0n;

    while (aVal > 1n) {
        if (m === 0n) return 0n;
        let q = aVal / m;
        let t = m;
        m = aVal % m;
        aVal = t;
        t = y;
        y = x - q * y;
        x = t;
    }
    if (x < 0n) x += m0;
    return x;
}

export function generatePrivatePem(n: bigint, p: bigint, q: bigint, preferredE: bigint = 65537n): string {
    if (p <= 1n || q <= 1n || p * q !== n) {
        throw new Error("أرقام العوامل غير صالحة لمفتاح RSA.");
    }

    // Ensure p and q are ordered for RSA CRT
    if (p > q) {
        const temp = p;
        p = q;
        q = temp;
    }

    const phi = (p - 1n) * (q - 1n);
    if (phi <= 0n) {
        throw new Error("قيمة phi غير صالحة.");
    }

    let e = preferredE;
    if (gcd(e, phi) !== 1n) {
        const candidates = [65537n, 3n, 5n, 17n, 257n, 65539n, 65543n];
        let found = false;
        for (const cand of candidates) {
            if (gcd(cand, phi) === 1n) {
                e = cand;
                found = true;
                break;
            }
        }
        if (!found) {
            e = 3n;
            while (e < phi && gcd(e, phi) !== 1n) {
                e += 2n;
            }
        }
    }

    if (gcd(e, phi) !== 1n) {
        throw new Error("تعذر إيجاد أس مشفر e أولي نسبياً مع phi.");
    }

    const d = modInverse(e, phi);
    if (d === 0n) {
        throw new Error("تعذر حساب المعكوس النمطي d للأس e.");
    }

    const dP = d % (p - 1n);
    const dQ = d % (q - 1n);
    const qInv = modInverse(q, p);

    const pki = forge.pki;
    const nBN = new forge.jsbn.BigInteger(n.toString(16), 16);
    const eBN = new forge.jsbn.BigInteger(e.toString(16), 16);
    const dBN = new forge.jsbn.BigInteger(d.toString(16), 16);
    const pBN = new forge.jsbn.BigInteger(p.toString(16), 16);
    const qBN = new forge.jsbn.BigInteger(q.toString(16), 16);
    const dPBN = new forge.jsbn.BigInteger(dP.toString(16), 16);
    const dQBN = new forge.jsbn.BigInteger(dQ.toString(16), 16);
    const qInvBN = new forge.jsbn.BigInteger(qInv.toString(16), 16);

    const key = pki.setRsaPrivateKey(
        nBN,
        eBN,
        dBN,
        pBN,
        qBN,
        dPBN,
        dQBN,
        qInvBN
    );
    
    return pki.privateKeyToPem(key);
}

export function generatePublicPem(n: bigint, e: bigint = 65537n): string {
    const pki = forge.pki;
    const key = pki.setRsaPublicKey(
        forge.util.createBuffer(n.toString(16), 'hex'),
        forge.util.createBuffer(e.toString(16), 'hex')
    );
    return pki.publicKeyToPem(key);
}

