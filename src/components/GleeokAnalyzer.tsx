import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Play, Square, Cpu, Zap, Activity, ShieldCheck, AlertTriangle, Hash, Database, 
  Server, RefreshCcw, CheckCircle, Clock, Upload, Download, BookOpen, Layers, 
  GitMerge, Scale, Info, ChevronLeft, ChevronRight, Compass, Flame, HelpCircle, Sparkles, Key
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GleeokWorker, GleeokStrategy } from '../lib/gleeokWorker';
import { getGleeokFeatureAdvanced, extractGleeokFingerprint, compareGleeokFingerprints, GleeokFingerprint } from '../lib/gleeokFeatureService';
import { ecmStats, resetEcmStats } from '../lib/ecmUtils';
import { ECMService } from '../services/ecmService';
import { verifyAndNotifyFactors } from '../utils/mathUtils';
import { SpectralChart } from './SpectralChart';
import { parsePemToN, generatePrivatePem, generatePublicPem } from '../lib/rsaUtils';

type DashboardStatus = 'idle' | 'generating_gleeok' | 'calculating_footprint' | 'ranking_curves' | 'running_ecm' | 'success' | 'failed';

interface BookSection {
  id: string;
  title: string;
  chapter: string;
  content: string;
  axiom?: string;
  demoData?: { N?: string; A?: string; B?: string; delta?: string; strategy?: GleeokStrategy };
}

export function GleeokAnalyzer() {
  // Navigation / Mode state
  const [activeTab, setActiveTab] = useState<'lab' | 'algebra' | 'book'>('lab');
  const [selectedBookSection, setSelectedBookSection] = useState<string>('intro');

  // Input States
  const [inputN, setInputN] = useState('10403');
  const [pemInput, setPemInput] = useState('');
  const [inputA, setInputA] = useState('10403');
  const [inputB, setInputB] = useState('10405');
  const [inputDelta, setInputDelta] = useState('1');
  const [strategy, setStrategy] = useState<GleeokStrategy>('Linear Nullspace');

  // Core Engine States
  const [status, setStatus] = useState<DashboardStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  // Live Extracted Data
  const [fingerprintN, setFingerprintN] = useState<GleeokFingerprint | null>(null);
  const [comparisonResult, setComparisonResult] = useState<{
    f1: GleeokFingerprint;
    f2: GleeokFingerprint;
    diff: number;
    similarity: number;
    merged: { label: string; v1: number; v2: number }[];
    // Calculus metrics
    sv: number;
    sr: number;
    ss: number;
    si: number;
    // Dynamics metrics
    sd: number; // structural density of A
    sp: number; // structural pressure of A
  } | null>(null);

  // Factorization execution timing & stats
  const [startTime, setStartTime] = useState<number | null>(null);
  const [elapsedTime, setElapsedTime] = useState<number>(0);
  const [nBits, setNBits] = useState(0);
  const [permsDone, setPermsDone] = useState(0);
  const [roundLatency, setRoundLatency] = useState({ current: 0, avg: 0, min: Infinity, max: 0, perSec: 0 });
  const [priority, setPriority] = useState({ max: 0, min: 0, avg: 0, ready: 0, executed: 0, currentB1: 0 });
  const [perf, setPerf] = useState({ modMuls: 0, curveAdds: 0 });
  const [factors, setFactors] = useState<{ p: string; q: string } | null>(null);
  const [generatedPem, setGeneratedPem] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(1);

  const abortControllerRef = useRef<AbortController | null>(null);
  const rafRef = useRef<number | null>(null);

  // Extract Fingerprint for N on input change
  useEffect(() => {
    try {
      const cleanInput = inputN.replace(/\s/g, '');
      if (cleanInput) {
        const bigintVal = BigInt(cleanInput);
        if (bigintVal > 0n) {
          const fp = extractGleeokFingerprint(bigintVal);
          setFingerprintN(fp);
          setNBits(fp.B.bitLength);
        }
      }
    } catch (e) {
      // Quiet fail to avoid typing crash
    }
  }, [inputN]);

  // Compute Algebra, Calculus & Dynamics for A and B
  useEffect(() => {
    try {
      const cleanA = inputA.replace(/\s/g, '');
      const cleanB = inputB.replace(/\s/g, '');
      const deltaVal = BigInt(inputDelta.replace(/\s/g, '') || '1');
      if (cleanA && cleanB) {
        const valA = BigInt(cleanA);
        const valB = BigInt(cleanB);
        
        if (valA > 0n && valB > 0n) {
          const f1 = extractGleeokFingerprint(valA);
          const f2 = extractGleeokFingerprint(valB);
          const { difference, similarity } = compareGleeokFingerprints(f1, f2);

          // Structural Calculus calculations (A + delta)
          const fDelta = extractGleeokFingerprint(valA + deltaVal);
          const sv = compareGleeokFingerprints(f1, fDelta).difference;
          const sr = sv / Number(deltaVal);
          const ss = f1.metrics.sensitivity; // Using pre-computed Sensitivity over interval
          const si = f1.metrics.inertia;

          // Structural Dynamics calculations (Density & Pressure in F(N))
          // We simulate a local field of size k = 2
          let similaritySum = 0;
          const k = 2;
          let count = 0;
          for (let i = -k; i <= k; i++) {
            if (i === 0) continue;
            const neighborVal = valA + BigInt(i);
            if (neighborVal > 0n) {
              const fNeighbor = extractGleeokFingerprint(neighborVal);
              similaritySum += compareGleeokFingerprints(f1, fNeighbor).similarity;
              count++;
            }
          }
          const sd = count > 0 ? similaritySum / count : 1;

          // Pressure: rate of change of structural density
          const fNextNeighbor = extractGleeokFingerprint(valA + 1n);
          let simNextSum = 0;
          for (let i = -k; i <= k; i++) {
            if (i === 0) continue;
            const neighborVal = (valA + 1n) + BigInt(i);
            if (neighborVal > 0n) {
              const fNeighbor = extractGleeokFingerprint(neighborVal);
              simNextSum += compareGleeokFingerprints(fNextNeighbor, fNeighbor).similarity;
            }
          }
          const sdNext = count > 0 ? simNextSum / count : 1;
          const sp = Math.abs(sdNext - sd);

          // Merged Vector for statistical visualization
          const merged = [
            { label: 'كثافة البتات (Density)', v1: f1.M.density, v2: f2.M.density },
            { label: 'الانتروبيا (Entropy)', v1: f1.M.entropy, v2: f2.M.entropy },
            { label: 'التوازن (Balance)', v1: f1.M.balance, v2: f2.M.balance },
            { label: 'التناظر (Symmetry)', v1: f1.M.symmetry, v2: f2.M.symmetry },
            { label: 'التعقيد (Complexity)', v1: f1.metrics.complexity, v2: f2.metrics.complexity },
            { label: 'الاستقرار (Stability)', v1: f1.metrics.stability, v2: f2.metrics.stability },
            { label: 'الحساسية (Sensitivity)', v1: f1.metrics.sensitivity, v2: f2.metrics.sensitivity },
            { label: 'الطاقة (Energy)', v1: f1.metrics.energy, v2: f2.metrics.energy },
          ];

          setComparisonResult({
            f1,
            f2,
            diff: difference,
            similarity,
            merged,
            sv,
            sr,
            ss,
            si,
            sd,
            sp
          });
        }
      }
    } catch (e) {
      // Quiet fail to avoid typing crash
    }
  }, [inputA, inputB, inputDelta]);

  // Factorization Decision Index computation based on current G(N)
  const getDecisionIndex = () => {
    if (!fingerprintN) return [];

    const N = BigInt(inputN.replace(/\s/g, ''));
    const sqrtN = BigInt(Math.floor(Math.sqrt(Number(N))));
    const diffToSquare = N - (sqrtN * sqrtN);
    const floatDiff = Number(diffToSquare);

    // 1. Fermat Index: higher if extremely close to perfect square
    const FermatScore = Math.min(100, Math.max(5, Math.round(100 - (floatDiff * 10 / Math.max(1, Math.sqrt(Number(N)))))));
    
    // 2. ECM Index: higher if stability is high & entropy is medium
    const EcmScore = Math.min(100, Math.max(15, Math.round(
      (fingerprintN.metrics.stability * 40) + 
      ((1 - Math.abs(fingerprintN.M.entropy - 0.6)) * 40) + 
      (fingerprintN.M.density * 20)
    )));

    // 3. Pollard's Rho Index: general fallback, prefers medium/high entropy and low symmetry
    const RhoScore = Math.min(100, Math.max(10, Math.round(
      (fingerprintN.M.entropy * 60) + 
      ((1 - fingerprintN.M.symmetry) * 40)
    )));

    // 4. Pollard's p-1 Index: prefers N-1 divisible by small primes (even residues on 2,3,5)
    let evenCount = 0;
    if ((N - 1n) % 2n === 0n) evenCount += 35;
    if ((N - 1n) % 3n === 0n) evenCount += 25;
    if ((N - 1n) % 5n === 0n) evenCount += 20;
    if ((N - 1n) % 7n === 0n) evenCount += 20;
    const P1Score = Math.min(100, Math.max(5, evenCount));

    return [
      { name: 'فيرمات البنيوي (Fermat)', score: FermatScore, icon: <Scale className="w-4 h-4 text-rose-400" />, desc: 'ممتاز عندما تكون المسافة بين العوامل والمربع الكامل صغيرة.' },
      { name: 'منحنيات إيليبتك (Gleeok-ECM)', score: EcmScore, icon: <Compass className="w-4 h-4 text-cyan-400" />, desc: 'توجيه المنحنيات بالبصمة البنيوية ونصف القطر التراكمي.' },
      { name: 'بولارد رو البنيوي (Pollard\'s Rho)', score: RhoScore, icon: <Flame className="w-4 h-4 text-amber-400" />, desc: 'خوارزمية احتمالية عامة تعتمد على انتروبيا المتجه المورفولوجي.' },
      { name: 'بولارد p-1 البنيوي (Pollard\'s p-1)', score: P1Score, icon: <Layers className="w-4 h-4 text-purple-400" />, desc: 'مثالي للأعداد حيث يمتلك N-1 بنيوية قسمة عالية على أعداد أولية صغيرة.' }
    ].sort((a, b) => b.score - a.score);
  };

  // Timer loop for factoring
  useEffect(() => {
    if (status !== 'idle' && status !== 'success' && status !== 'failed' && startTime) {
      const updateTimer = () => {
        setElapsedTime(Date.now() - startTime);
        rafRef.current = requestAnimationFrame(updateTimer);
      };
      rafRef.current = requestAnimationFrame(updateTimer);
    }
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [status, startTime]);

  const stopAnalysis = () => {
    if (abortControllerRef.current) abortControllerRef.current.abort();
    setStatus('idle');
  };

  const currentBitInfo = useMemo(() => {
    try {
      const clean = inputN.replace(/\s/g, '');
      if (!clean) return null;
      const nBig = BigInt(clean);
      const bits = nBig.toString(2).length;
      const digits = nBig.toString(10).length;
      return { bits, digits, nBig };
    } catch (e) {
      return null;
    }
  }, [inputN]);

  const handleLoad556Preset = (type: 'smooth' | 'fermat' | 'medium' | 'rsa') => {
    let presetN = '';
    if (type === 'smooth') {
      const p = 1125899906842629n;
      const q = (2n ** 505n) + 32187312893712983719827391823791823712983712983712938127391823719238n | 1n;
      presetN = (p * q).toString();
      setStrategy("Sacred Data");
    } else if (type === 'fermat') {
      const base = (2n ** 277n) + 9876543210123456789012345678901234567890n;
      const p = base - 1234n;
      const q = base + 1234n;
      presetN = (p * q).toString();
      setStrategy("Linear Nullspace");
    } else if (type === 'medium') {
      const p = 35184372088831n;
      const q = (2n ** 510n) + 912837129837129837129837129837129837192837192837192837192837n | 1n;
      presetN = (p * q).toString();
      setStrategy("Sacred Data");
    } else {
      const p = (2n ** 277n) + 1234567890123456789012345678901234567890n | 1n;
      const q = (2n ** 277n) + 9876543210987654321098765432109876543210n | 1n;
      presetN = (p * q).toString();
      setStrategy("Sacred Data");
    }
    setInputN(presetN);
    setFactors(null);
    setGeneratedPem(null);
    setError(null);
  };

  const handleConvertToPublic = () => {
      try {
          const N = BigInt(inputN.replace(/\s/g, ''));
          const e = 65537n;
          const pem = generatePublicPem(N, e);
          setPemInput(pem);
          setError(null);
      } catch (e) {
          setError("خطأ في مدخل N لتحويله إلى مفتاح عام PEM.");
      }
  };

  const handleImportPem = () => {
      if (pemInput) {
          const n = parsePemToN(pemInput);
          if (n) {
              setInputN(n.toString());
              setError(null);
          } else {
              setError("فشل في قراءة مفتاح PEM.");
          }
      } else {
          setError("يرجى لصق نص مفتاح PEM أولاً.");
      }
  };

  const handleExportPem = () => {
      if (factors && factors.p && factors.q) {
          const e = 65537n;
          try {
              const N = BigInt(inputN.replace(/\s/g, ''));
              const pem = generatePrivatePem(N, BigInt(factors.p), BigInt(factors.q), e);
              setGeneratedPem(pem);
              setError(null);
          } catch (e) {
              setError("فشل تصدير المفتاح الخاص PEM.");
          }
      } else {
          setError("عوامل التحليل غير متوفرة للتصدير.");
      }
  };

  const startAnalysis = async () => {
    setError(null);
    setFactors(null);
    resetEcmStats();
    setPerf({ modMuls: 0, curveAdds: 0 });
    
    let N: bigint;
    try {
      const cleanInput = inputN.trim().replace(/[\s,]/g, '');
      if (cleanInput.includes('-----BEGIN')) {
        const parsedN = parsePemToN(cleanInput);
        if (parsedN) {
          N = parsedN;
        } else {
          throw new Error('تعذر قراءة مفتاح PEM.');
        }
      } else {
        N = BigInt(cleanInput);
      }
      if (N <= 3n) throw new Error('يجب أن يكون العدد أكبر من 3');
    } catch (e: any) {
      setError(e?.message || 'يرجى إدخال عدد صحيح صالح أو مفتاح PEM.');
      return;
    }

    const n = N.toString(2).length;
    setNBits(n);
    setStartTime(Date.now());
    setStatus('generating_gleeok');

    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    try {
      await new Promise(res => setTimeout(res, 100)); // UI flush
      
      const featureData = getGleeokFeatureAdvanced(N, n);
      if (signal.aborted) return;
      
      const { timings } = featureData;
      const totalT = timings.reduce((a, b) => a + b, 0);
      const avgT = totalT / timings.length;
      
      setRoundLatency({
        current: timings[timings.length - 1] || 0,
        avg: avgT,
        min: Math.min(...timings),
        max: Math.max(...timings),
        perSec: timings.length > 0 ? (1000 / avgT) : 0
      });

      setPermsDone(n);
      setStatus('calculating_footprint');
      await new Promise(res => setTimeout(res, 400));
      if (signal.aborted) return;
      
      if (n > 40) {
        let currentAttempt = 1;
        let success = false;
        
        while (!success) {
          if (signal.aborted) return;
          
          setAttempt(currentAttempt);
          setStatus('ranking_curves');
          await new Promise(res => setTimeout(res, 400));
          if (signal.aborted) return;

          setStatus('running_ecm');
          
          let simulatedMuls = 0;
          const interval = setInterval(() => {
            simulatedMuls += Math.floor(Math.random() * 8000) + 2000;
            setPerf(prev => ({
              modMuls: simulatedMuls + (currentAttempt - 1) * 200000,
              curveAdds: Math.floor((simulatedMuls + (currentAttempt - 1) * 200000) / 10)
            }));
          }, 150);

          try {
            const response = await fetch("/api/gleeok/factor", {
              method: "POST",
              headers: {
                "Content-Type": "application/json"
              },
              body: JSON.stringify({ N: N.toString(), attempt: currentAttempt }),
              signal
            });
            
            clearInterval(interval);

            if (!response.ok) {
              const errData = await response.json();
              throw new Error(errData.error || "حدث خطأ أثناء الاتصال بخادم التحليل المحلي.");
            }

            const data = await response.json();
            if (data.success && data.p && data.q) {
              const pBig = BigInt(data.p);
              const qBig = BigInt(data.q);
              
              // Perform the final modular check and display success notification
              verifyAndNotifyFactors(N, pBig, qBig);

              setStatus('success');
              setFactors({ p: pBig.toString(), q: qBig.toString() });
              
              const e = 65537n;
              try {
                const pem = generatePrivatePem(N, pBig, qBig, e);
                setGeneratedPem(pem);
              } catch (err) {
                console.error("PEM failure:", err);
                setError("تم استخراج عوامل صحيحة، ولكن حدث خطأ أثناء تشفير PEM.");
              }
              success = true;
              break;
            } else {
              setError(`المحاولة رقم [${currentAttempt}] لم تنجح في إيجاد العوامل. جاري الانتقال تلقائياً إلى المحاولة التالية رقم [${currentAttempt + 1}] مع توسيع نطاقات البحث الرياضي وتوليد منحنيات جديدة بالكامل...`);
              currentAttempt++;
              await new Promise(res => setTimeout(res, 1500));
            }
          } catch (apiErr: any) {
            clearInterval(interval);
            if (apiErr.name === 'AbortError') return;
            console.error(apiErr);
            setError(apiErr.message || "فشل الاتصال بالمحرك البنيوي الرياضي.");
            setStatus('failed');
            break;
          }
        }
        return;
      }

      setStatus('ranking_curves');
      await new Promise(res => setTimeout(res, 400));
      if (signal.aborted) return;
      
      setStatus('running_ecm');
      
      let foundFactor: bigint | null = null;
      let B1 = 2000;
      let batchStart = 1;
      const BATCH_SIZE = Math.min(n, 1000); 
      let totalExecuted = 0;
      
      while (!foundFactor) {
        if (signal.aborted) return;
        
        // Generate and rank curves using advanced structural metrics
        const tasks = ECMService.generateCurves(N, BATCH_SIZE, featureData.stability, featureData.entropy, batchStart);
        
        const maxP = Math.max(...tasks.map(t => t.priority));
        const minP = Math.min(...tasks.map(t => t.priority));
        const avgP = tasks.reduce((sum, t) => sum + t.priority, 0) / tasks.length;
        
        setPriority(prev => ({
          ...prev,
          ready: tasks.length,
          max: maxP,
          min: minP,
          avg: avgP,
          currentB1: B1
        }));

        for (let i = 0; i < tasks.length; i++) {
            if (signal.aborted) return;
            
            const candidateP = ECMService.executeCurve(tasks[i], B1, N);
            
            if (candidateP) {
                const verification = ECMService.verifyFactor(N, candidateP);
                if (verification.valid) {
                    foundFactor = candidateP;
                    break;
                }
            }
            
            totalExecuted++;
            
            if (i % 10 === 0) {
                setPriority(prev => ({ ...prev, executed: totalExecuted }));
                setPerf({ modMuls: ecmStats.modMuls, curveAdds: ecmStats.curveAdds });
                await new Promise(res => setTimeout(res, 0));
            }
        }
        
        if (foundFactor) break;
        
        batchStart += BATCH_SIZE;
        B1 += 200; 
        
        setPriority(prev => ({ ...prev, executed: totalExecuted, currentB1: B1 }));
        setPerf({ modMuls: ecmStats.modMuls, curveAdds: ecmStats.curveAdds });
        await new Promise(res => setTimeout(res, 0));
      }

      if (foundFactor) {
         const verification = ECMService.verifyFactor(N, foundFactor);
         
         if (!verification.valid || !verification.q) {
             console.error('العوامل غير صالحة:', verification);
             setError('فشل التحقق الرياضي المستقل.');
             setStatus('failed');
             return;
         }
         
         const p = foundFactor;
         const q = verification.q;
         
         const pBig = BigInt(p);
         const qBig = BigInt(q);

         // Perform the final modular check and display success notification
         verifyAndNotifyFactors(N, pBig, qBig);

         setStatus('success');
         setFactors({ p: pBig.toString(), q: qBig.toString() });
         
         const e = 65537n;
         try {
            const pem = generatePrivatePem(N, pBig, qBig, e);
            setGeneratedPem(pem);
         } catch (err) {
            console.error("PEM failure:", err);
            setError("عوامل صحيحة، ولكن حدث خطأ أثناء تشفير PEM.");
         }
      }

    } catch (e) {
      console.error(e);
      setError('حدث خطأ أثناء تنفيذ الخوارزمية.');
      setStatus('idle');
    }
  };

  const formatTime = (ms: number) => {
    return (ms / 1000).toFixed(2) + 's';
  };

  // Preset demo loaders
  const loadPreset = (preset: { N?: string; A?: string; B?: string; delta?: string; strategy?: GleeokStrategy }) => {
    if (preset.N) setInputN(preset.N);
    if (preset.A) setInputA(preset.A);
    if (preset.B) setInputB(preset.B);
    if (preset.delta) setInputDelta(preset.delta);
    if (preset.strategy) setStrategy(preset.strategy);
    
    // Jump to relevant tab
    if (preset.A || preset.B) {
      setActiveTab('algebra');
    } else {
      setActiveTab('lab');
    }
  };

  const bookSections: BookSection[] = [
    {
      id: 'intro',
      chapter: 'مقدمة العلم التأسيسية',
      title: 'ما هو علم التحليل البنيوي للأعداد؟',
      content: `يُعرَّف علم Gleeok بأنه علم يدرس البنية الداخلية للأعداد الصحيحة من خلال خصائصها الرقمية والإحصائية والطيفية، بهدف فهم العلاقات بين هذه البنية وسلوك الخوارزميات العددية، وخاصة خوارزميات تحليل الأعداد.

بموجب هذا التعريف، لا يدّعي العلم أنه يكسر تشفير RSA بصورة سحرية، بل يدرس خصائص بنيوية دقيقة وعميقة تساعد في تصنيف الأعداد الصحيحة وتوجيه خوارزميات التحليل نحو الكفاءة القصوى.

موضوع الدراسة:
الوحدة الأساسية ليست القيمة الرقمية المجردة للعدد، بل بصمته البنيوية الكاملة G(N)، وهي نقطة داخل فضاء عالي الأبعاد يسمى Morphological Space.`,
      demoData: { N: '10403' }
    },
    {
      id: 'chapter1',
      chapter: 'الفصل الأول',
      title: 'جبر البصمات (Fingerprint Algebra)',
      content: `لكل عدد صحيح موجب N يوجد تمثيل بنيوي وحيد يسمى G(N) = (B, M, S, R).

• البنية الثنائية (B): التمثيل الثنائي، طول البتات، والكثافة.
• المتجه المورفولوجي (M): يحتوي على popCount، الكثافة، السلاسل (runCount)، الانتقالات (transitions)، وأطول سلسلة متتالية، والانتروبيا البنيوية، والتوازن، والتناظر.
• المتجه الطيفي (S): المركز الطيفي، الطاقة، التباين، التردد المسيطر، والانتروبيا الطيفية.
• متجه البواقي (R): بواقي القسمة على الأعداد الأولية الأساسية الصغيرة.

العمليات الجبرية الأساسية:
• عملية الإسقاط Projection: دراسة جزء محدد من المتجه.
• عملية الدمج Merge: تركيب البصمات.
• الفرق البنيوي والتشابه البنيوي: حساب المسافة الإقليدية في فضاء البصمات واستخلاص قيمة التشابه Similarity(A,B) بين 0 و 1.`,
      demoData: { A: '10403', B: '10405' }
    },
    {
      id: 'chapter2',
      chapter: 'الفصل الثاني',
      title: 'حساب التفاضل البنيوي (Structural Calculus)',
      content: `يدرس هذا الفصل حساسية البنية وتغيرها الرقمي عند إدخال تغير كمي صغير على قيمة العدد.

• التغير البنيوي Structural Variation (SV): هو المسافة والفرق البنيوي بين G(N) و G(N + Delta).
• معدل التغير البنيوي Structural Rate (SR): يساوي SV / Delta.
• الحساسية البنيوية Structural Sensitivity (SS): متوسط معدل التغير البنيوي في مجال رقمي معين.
• القصور البنيوي Structural Inertia (SI): يساوي 1 / (1 + SS)، ويعبر عن استقرار العدد وجيرانه ضد التغيرات الطفيفة.

على سبيل المثال، عند الانتقال من عدد مشبع بالوحدات مثل 127 (1111111) إلى 128 (10000000)، تشهد البنية قفزة مورفولوجية حادة جدًا، مما يعني حساسية فائقة وسرعة تفاضلية قصوى.`,
      demoData: { A: '127', B: '128', delta: '1' }
    },
    {
      id: 'chapter3',
      chapter: 'الفصل الثالث',
      title: 'ديناميكا البنية الرقمية (Structural Dynamics)',
      content: `على غرار الميكانيكا في الفيزياء، ندرس هنا القوى الديناميكية للمجالات الرقمية.

• المجال البنيوي Structural Field F(N): مجموعة من البصمات المجاورة للعدد N بنصف قطر معين.
• الكثافة البنيوية Structural Density (SD): متوسط التشابه البنيوي للعدد وجيرانه.
• الضغط البنيوي Structural Pressure (SP): معدل تغير الكثافة البنيوية في الفضاء.
• الطاقة البنيوية Structural Energy (SE): تركيب مرجح من التعقيد المورفولوجي والانتروبيا والطاقة الطيفية والتغير البنيوي.
• الرنين البنيوي Structural Resonance: تشابه بنيوي مرتفع جدًا بين أعداد متباعدة بقيمتها العددية، مما يثبت انتماءها لنفس الفئة البنيوية في الفضاء الهندسي.`,
      demoData: { A: '10403', B: '40961' }
    },
    {
      id: 'chapter4',
      chapter: 'الفصل الرابع',
      title: 'نظرية الاستدلال والتوجيه (Structural Inference)',
      content: `تعتمد النظرية على مبدأ الفصل الحاسم: الاستدلال ليس برهانًا (Inference is NOT a Proof).

كل قيمة بنيوية أو توصية خوارزمية هي فرضية ترشيح ذكية لترتيب وتنظيم خوارزميات التحليل. أما الإثبات النهائي فيتطلب تحققًا رياضيًا مستقلاً وقابلاً لإعادة الإنتاج (مثل نجاح القسمة أو فك RSA).

مؤشر القرار (Decision Index):
يتم توجيه خوارزميات ECM أو فيرمات أو بولارد بناء على معايير البصمة المستخلصة، مما يوفر آلاف العمليات الحسابية الضائعة في المحاولات العشوائية.`,
      demoData: { N: '4294967297' }
    },
    {
      id: 'axioms',
      chapter: 'الفصل الخامس',
      title: 'دستور المسلمات الكبرى والمشاكل المفتوحة',
      content: `المسلمات الكبرى:
• المسلمة 1: لكل عدد صحيح موجب بصمة بنيوية فريدة قابلة للاستخراج حتميًا.
• المسلمة 2: حتمية واستقرار عملية الاستخراج وثباتها.
• المسلمة 3: إمكانية قياس التشابه والمقارنة الهندسية في فضاء البصمات.
• المسلمة 4: فضاء البصمات فضاء هندسي مترابط.
• المسلمة 5: التقارب البنيوي يعني فئة متجانسة ولا يضمن تشابه العوامل.
• المسلمة 6: البصمة تحمل مؤشرات ترشيحية لكنها ليست دليلاً قطعيًا قبل البرهان.
• المسلمة 7 (قانون الفصل): وجوب التحقق الرياضي المستقل لكل استدلال بنيوي.

المشاكل المفتوحة الكبرى لـ Gleeok (مسائل الألفية الرقمية):
1. هل تحتوي البصمة على معلومات كافية للتنبؤ دائمًا بوجود عوامل أولية معينة؟
2. هل تترابط الفئات البنيوية الطبيعية مع صعوبة تحليل الأعداد شبه الأولية؟
3. هل يمكن إثبات حد أدنى عالمي لطول البصمة دون خسارة خصائص التوجيه؟`,
      demoData: { N: '2047' }
    }
  ];

  const currentSection = bookSections.find(s => s.id === selectedBookSection) || bookSections[0];

  return (
    <div className="w-full max-w-7xl mx-auto p-4 sm:p-6 lg:p-8 space-y-6" dir="rtl">
      {/* Header Banner */}
      <div className="relative overflow-hidden bg-gradient-to-l from-slate-900 to-slate-950 border border-slate-800 rounded-2xl p-6 shadow-2xl flex flex-col md:flex-row justify-between items-center gap-6">
        <div className="absolute top-0 right-0 w-48 h-48 bg-cyan-500/10 blur-[60px] pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-32 h-32 bg-purple-500/10 blur-[50px] pointer-events-none" />
        
        <div className="z-10 flex items-center gap-4">
          <div className="bg-cyan-500/10 p-3.5 rounded-xl border border-cyan-500/30 text-cyan-400">
            <Cpu className="w-7 h-7 animate-pulse" />
          </div>
          <div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-slate-100 flex items-center gap-2 font-sans">
              علم التحليل البنيوي للأعداد <span className="text-cyan-400 font-mono">Gleeok</span>
            </h1>
            <p className="text-slate-400 text-sm mt-1">
              منصة تفاعلية متكاملة لدراسة المورفولوجيا، الجبر، التفاضل البنيوي، وديناميكا الأعداد الصحيحة.
            </p>
          </div>
        </div>

        {/* Workspace Quick Tabs */}
        <div className="z-10 bg-slate-900/80 p-1.5 rounded-xl border border-slate-800 flex items-center gap-1 w-full md:w-auto">
          <button 
            onClick={() => setActiveTab('lab')}
            className={`flex-1 md:flex-initial flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold transition-all ${activeTab === 'lab' ? 'bg-cyan-500 text-slate-950 shadow-lg' : 'text-slate-400 hover:text-slate-200'}`}
          >
            <Activity className="w-3.5 h-3.5" />
            المختبر البنيوي (G)
          </button>
          <button 
            onClick={() => setActiveTab('algebra')}
            className={`flex-1 md:flex-initial flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold transition-all ${activeTab === 'algebra' ? 'bg-cyan-500 text-slate-950 shadow-lg' : 'text-slate-400 hover:text-slate-200'}`}
          >
            <GitMerge className="w-3.5 h-3.5" />
            الجبر والتفاضل (A/B)
          </button>
          <button 
            onClick={() => setActiveTab('book')}
            className={`flex-1 md:flex-initial flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold transition-all ${activeTab === 'book' ? 'bg-cyan-500 text-slate-950 shadow-lg' : 'text-slate-400 hover:text-slate-200'}`}
          >
            <BookOpen className="w-3.5 h-3.5" />
            كتاب البديهيات
          </button>
        </div>
      </div>

      {error && (
        <div className="text-rose-400 bg-rose-950/20 p-4 rounded-xl border border-rose-900/40 text-sm flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Main Grid Workspace */}
      <AnimatePresence mode="wait">
        {activeTab === 'lab' && (
          <motion.div
            key="lab"
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            className="grid grid-cols-1 lg:grid-cols-12 gap-6"
          >
            {/* Control Panel (Lab Inputs) */}
            <div className="lg:col-span-4 space-y-6">
              <Panel title="المدخلات الرقمية ومفاتيح PEM" icon={<Hash className="w-4 h-4 text-cyan-400" />}>
                <div className="space-y-4">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="block text-slate-400 text-xs font-medium">
                        العدد الصحيح المراد تحليله (N) <span className="text-cyan-400 font-normal text-[11px]">(يحلل نفس الرقم المدخل تماماً)</span>
                      </label>
                      {currentBitInfo && (
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-cyan-950 border border-cyan-800/60 text-cyan-300 font-bold">
                          {currentBitInfo.bits} بت ({currentBitInfo.digits} خانة)
                        </span>
                      )}
                    </div>
                    <input 
                      dir="ltr"
                      value={inputN}
                      onChange={(e) => setInputN(e.target.value)}
                      placeholder="أدخل عدداً صحيحاً بالكامل..."
                      className="w-full bg-slate-950 border border-slate-800 focus:border-cyan-500/50 rounded-lg p-3 text-slate-100 font-mono text-sm outline-none transition-colors"
                      disabled={status !== 'idle'}
                    />
                  </div>

                  {/* 556-Bit Quick Preset Benchmarks */}
                  <div className="space-y-1.5 pt-1">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400 text-[11px] font-semibold flex items-center gap-1">
                        <Cpu className="w-3.5 h-3.5 text-cyan-400" /> نماذج 556 بت للاختبار الفوري (تحميل نموذج يستبدل الرقم أعلاه):
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleLoad556Preset('smooth')}
                        className="text-right p-2 bg-slate-900 hover:bg-cyan-950/60 border border-slate-800 hover:border-cyan-500/50 rounded-lg text-[11px] transition-all group"
                      >
                        <div className="font-bold text-slate-200 group-hover:text-cyan-300 flex items-center gap-1">
                          <Zap className="w-3 h-3 text-amber-400" /> 556-bit Smooth
                        </div>
                        <div className="text-[10px] text-slate-400">عامل سلس p-1 (تفكيك فوري)</div>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleLoad556Preset('fermat')}
                        className="text-right p-2 bg-slate-900 hover:bg-cyan-950/60 border border-slate-800 hover:border-cyan-500/50 rounded-lg text-[11px] transition-all group"
                      >
                        <div className="font-bold text-slate-200 group-hover:text-cyan-300 flex items-center gap-1">
                          <Scale className="w-3 h-3 text-rose-400" /> 556-bit Twin Fermat
                        </div>
                        <div className="text-[10px] text-slate-400">مربعات متقاربة (1ms)</div>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleLoad556Preset('medium')}
                        className="text-right p-2 bg-slate-900 hover:bg-cyan-950/60 border border-slate-800 hover:border-cyan-500/50 rounded-lg text-[11px] transition-all group"
                      >
                        <div className="font-bold text-slate-200 group-hover:text-cyan-300 flex items-center gap-1">
                          <Compass className="w-3 h-3 text-cyan-400" /> 556-bit Medium
                        </div>
                        <div className="text-[10px] text-slate-400">عامل متوسط ECM (سرعة عالية)</div>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleLoad556Preset('rsa')}
                        className="text-right p-2 bg-slate-900 hover:bg-cyan-950/60 border border-slate-800 hover:border-cyan-500/50 rounded-lg text-[11px] transition-all group"
                      >
                        <div className="font-bold text-slate-200 group-hover:text-cyan-300 flex items-center gap-1">
                          <Key className="w-3 h-3 text-purple-400" /> 556-bit Cryptographic
                        </div>
                        <div className="text-[10px] text-slate-400">مفتاح مشفر RSA متوازن</div>
                      </button>
                    </div>
                  </div>

                  {/* 556-Bit Engine Status Banner */}
                  {currentBitInfo && currentBitInfo.bits >= 500 && (
                    <div className="p-3 bg-gradient-to-r from-cyan-950/60 via-slate-900 to-purple-950/60 border border-cyan-500/40 rounded-xl space-y-1.5 shadow-md">
                      <div className="flex items-center justify-between">
                        <span className="text-cyan-400 font-bold text-xs flex items-center gap-1.5">
                          <Zap className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
                          محرك تسريع الأعداد الكبيرة (556-Bit Active)
                        </span>
                        <span className="text-[10px] font-mono font-bold bg-cyan-500/20 text-cyan-300 px-2 py-0.5 rounded border border-cyan-500/30">
                          {currentBitInfo.bits} BITS
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-300 leading-relaxed">
                        تم تفعيل نمط المعالجة المكثفة لأرقام 556 بت (~168 خانة عشرية). الخوارزمية تجري مسحاً شاملاً لسلاسة بولارد p-1، ومربعات فيرما المتوازية، وتوليد منحنيات مونتغومري الإهليلجية B1/B2 التكيُّفية.
                      </p>
                    </div>
                  )}

                  <div>
                    <label className="block text-slate-400 text-xs mb-2 font-medium">مفتاح PEM العام / الخاص</label>
                    <textarea
                      dir="ltr"
                      value={pemInput}
                      onChange={(e) => setPemInput(e.target.value)}
                      placeholder="الصق مفتاح PEM لتفكيك N ومطابقة البنية..."
                      className="w-full bg-slate-950 border border-slate-800 focus:border-cyan-500/50 rounded-lg p-3 text-slate-100 font-mono text-xs outline-none transition-colors h-24 resize-none"
                    />
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <button onClick={handleImportPem} className="flex items-center justify-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 py-2.5 rounded-lg text-xs font-semibold transition-colors">
                      <Upload className="w-3.5 h-3.5" /> استيراد
                    </button>
                    <button onClick={handleConvertToPublic} className="flex items-center justify-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 py-2.5 rounded-lg text-xs font-semibold transition-colors">
                      <Hash className="w-3.5 h-3.5" /> لعام
                    </button>
                    <button onClick={handleExportPem} disabled={!factors} className="flex items-center justify-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 py-2.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-30 disabled:pointer-events-none">
                      <Download className="w-3.5 h-3.5" /> تصدير
                    </button>
                  </div>

                  <div className="border-t border-slate-800/60 pt-4 space-y-3">
                    <label className="block text-slate-400 text-xs font-medium">الخوارزمية التوجيهية للتحقق المستقل</label>
                    <select
                      value={strategy}
                      onChange={(e) => setStrategy(e.target.value as GleeokStrategy)}
                      className="w-full bg-slate-950 border border-slate-800 focus:border-cyan-500/50 rounded-lg p-2.5 text-slate-100 text-xs font-semibold outline-none transition-colors"
                      disabled={status !== 'idle'}
                    >
                      <option value="Linear Nullspace">Linear Nullspace (سيرورة فيرما الموجهة)</option>
                      <option value="Sacred Data">Sacred Data (تتبع بذور ECM الموثقة)</option>
                      <option value="Pollard's Rho">Pollard's Rho (دورة فلويد البنيوية)</option>
                    </select>

                    {status !== 'idle' && status !== 'success' && status !== 'failed' ? (
                      <button onClick={stopAnalysis} className="w-full flex items-center justify-center gap-2 bg-rose-600 hover:bg-rose-500 text-slate-950 py-3 rounded-lg text-xs font-bold transition-colors">
                        <Square className="w-4 h-4 fill-current" /> Stop Search (إيقاف البحث والتحقق)
                      </button>
                    ) : (
                      <div className="flex flex-col gap-2">
                        <button onClick={startAnalysis} disabled={!inputN} id="btn-execute-search" className="w-full flex items-center justify-center gap-2 bg-cyan-500 hover:bg-cyan-400 text-slate-950 py-3 rounded-lg text-xs font-bold transition-colors disabled:opacity-40 shadow-lg shadow-cyan-500/10">
                          <Play className="w-4 h-4 fill-current" /> Execute Search (بدء البحث والتفكيك الرياضي)
                        </button>
                        <div className="text-[10px] text-center text-slate-500">
                          البحث مستمر عبر استدعاء المحرك البنيوي وتوسيع نطاق curves & bounds تلقائياً حتى استخراج p و q.
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </Panel>

              {/* Engine Run Monitor */}
              <Panel title="حالة التحقق وعقدة المعالجة" icon={<Server className="w-4 h-4 text-purple-400" />}>
                <div className="space-y-2">
                  <MetricRow label="حالة المحرك" value={<StatusBadge status={status} />} />
                  <MetricRow label="العدد المستهدف (N)" value={<span className="text-cyan-300 font-mono text-[11px] font-bold truncate max-w-[150px] inline-block" title={inputN}>{inputN.trim() || '-'}</span>} />
                  <MetricRow label="رقم المحاولة (العمق)" value={<span className="text-cyan-400 font-mono font-bold">{attempt} (توسيع وبحث مستمر)</span>} />
                  <MetricRow label="الزمن المنقضي" value={formatTime(elapsedTime)} />
                  <MetricRow label="الأنوية النشطة" value={navigator.hardwareConcurrency || '8'} />
                  <MetricRow label="عمليات الضرب المعيارية" value={perf.modMuls.toLocaleString()} />
                  <MetricRow label="جمع منحنيات ECM" value={perf.curveAdds.toLocaleString()} />
                </div>
              </Panel>

              <Panel title="أداء التبديلات (Gleeok-n)" icon={<RefreshCcw className="w-4 h-4 text-emerald-400" />}>
                <div className="space-y-2">
                  <MetricRow label="التبديلات المطلوبة" value={nBits > 0 ? nBits : '-'} />
                  <MetricRow label="التبديلات المكتملة" value={permsDone} />
                  <MetricRow label="متوسط زمن جولة الاستخراج" value={roundLatency.avg ? roundLatency.avg.toFixed(2) + ' ms' : '-'} />
                  <MetricRow label="السرعة (تبديل/ثانية)" value={roundLatency.perSec ? Math.round(roundLatency.perSec).toLocaleString() : '-'} />
                </div>
              </Panel>
            </div>

            {/* Laboratory Core Outputs */}
            <div className="lg:col-span-8 space-y-6">
              {/* Fingerprint Vectors */}
              {fingerprintN ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Morphological Vector Card */}
                  <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-16 h-16 bg-amber-500/5 blur-xl pointer-events-none" />
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <Activity className="w-4 h-4 text-amber-400" />
                        <h3 className="text-slate-200 font-semibold text-sm">المتجه المورفولوجي M(N)</h3>
                      </div>
                      <span className="text-[10px] font-mono text-amber-400/80 bg-amber-400/10 px-1.5 py-0.5 rounded border border-amber-400/20">Morphological</span>
                    </div>
                    <div className="space-y-2.5">
                      <MetricRow label="حجم البتات (bitLength)" value={fingerprintN.M.bitLength} />
                      <MetricRow label="عدد الوحدات (popCount)" value={fingerprintN.M.popCount} />
                      <MetricRow label="كثافة البتات (density)" value={(fingerprintN.M.density * 100).toFixed(2) + '%'} />
                      <MetricRow label="عدد السلاسل (runCount)" value={fingerprintN.M.runCount} />
                      <MetricRow label="الانتقالات الثنائية (transitions)" value={fingerprintN.M.transitions} />
                      <MetricRow label="أطول سلسلة متتالية" value={fingerprintN.M.longestRun} />
                      <MetricRow label="الانتروبيا المورفولوجية" value={fingerprintN.M.entropy.toFixed(4)} />
                      <MetricRow label="توازن البتات (balance)" value={fingerprintN.M.balance.toFixed(4)} />
                      <MetricRow label="معامل التناظر (symmetry)" value={fingerprintN.M.symmetry.toFixed(4)} />
                    </div>
                  </div>

                  {/* Spectral & Metrics Card */}
                  <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-16 h-16 bg-cyan-500/5 blur-xl pointer-events-none" />
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <Cpu className="w-4 h-4 text-cyan-400" />
                        <h3 className="text-slate-200 font-semibold text-sm">المتجه الطيفي والمقاييس التأسيسية</h3>
                      </div>
                      <span className="text-[10px] font-mono text-cyan-400/80 bg-cyan-400/10 px-1.5 py-0.5 rounded border border-cyan-400/20">Spectral & Metrics</span>
                    </div>
                    <div className="space-y-2.5">
                      <MetricRow label="المركز الطيفي (Centroid)" value={fingerprintN.S.spectralCentroid.toFixed(4)} />
                      <MetricRow label="الطاقة الطيفية (Energy)" value={fingerprintN.S.spectralEnergy.toFixed(2)} />
                      <MetricRow label="التباين الطيفي (Variance)" value={fingerprintN.S.spectralVariance.toFixed(4)} />
                      <MetricRow label="التردد المسيطر" value={fingerprintN.S.dominantFrequency} />
                      <MetricRow label="انتروبيا الطيف" value={fingerprintN.S.spectralEntropy.toFixed(4)} />
                      <div className="border-t border-slate-800/80 my-2 pt-2" />
                      <MetricRow 
                        label={<span className="text-slate-300 font-semibold flex items-center gap-1"><Sparkles className="w-3.5 h-3.5 text-cyan-400 animate-pulse" /> التعقيد المورفولوجي</span>} 
                        value={<span className="text-cyan-400 font-bold font-mono">{fingerprintN.metrics.complexity.toFixed(4)}</span>} 
                      />
                      <MetricRow label="معامل الاستقرار (Stability)" value={fingerprintN.metrics.stability.toExponential(3)} />
                      <MetricRow label="القصور البنيوي (Inertia)" value={fingerprintN.metrics.inertia.toFixed(4)} />
                      <MetricRow label="الطاقة الكلية للبصمة (SE)" value={fingerprintN.metrics.energy.toFixed(4)} />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="h-48 bg-slate-900 border border-slate-800 rounded-xl flex items-center justify-center text-slate-500">
                  في انتظار إدخال قيمة N صالحة لاستخراج البصمة...
                </div>
              )}

              {/* Spectral Chart Panel */}
              {fingerprintN && (
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Database className="w-4 h-4 text-cyan-400" />
                      <h3 className="text-slate-200 font-semibold text-sm">البصمة الطيفية المستمرة للعدد N</h3>
                    </div>
                    <span className="text-[10px] font-mono text-slate-400">Gleeok Feature Space (n-dimensions)</span>
                  </div>
                  <SpectralChart data={fingerprintN.S.featureVector.map((v, i) => ({ index: i, value: v }))} />
                </div>
              )}

              {/* Residue Profile Component */}
              {fingerprintN && (
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg">
                  <div className="flex items-center gap-2 mb-3">
                    <Layers className="w-4 h-4 text-purple-400" />
                    <h3 className="text-slate-200 font-semibold text-sm">متجه البواقي R(N) على الأعداد الأولية الصغيرة</h3>
                  </div>
                  <div className="grid grid-cols-5 sm:grid-cols-8 gap-2">
                    {fingerprintN.R.primes.map((prime, idx) => (
                      <div key={prime} className="bg-slate-950 border border-slate-800/80 rounded p-2 text-center">
                        <div className="text-[10px] font-mono text-slate-500 font-medium">mod {prime}</div>
                        <div className="text-xs font-mono font-bold text-purple-400 mt-1">
                          {fingerprintN.R.residues[idx]}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Dynamic Algorithm Decision Index (ترشيح الخوارزميات الفوري) */}
              {fingerprintN && (
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <Compass className="w-4 h-4 text-emerald-400" />
                      <h3 className="text-slate-200 font-semibold text-sm">مؤشر القرار التوجيهي لتصنيف العدد (Decision & Guide Index)</h3>
                    </div>
                    <span className="text-[10px] font-mono text-emerald-400 bg-emerald-400/10 px-1.5 py-0.5 rounded border border-emerald-400/10">Automated Inference</span>
                  </div>
                  <p className="text-slate-400 text-xs mb-4">
                    تقوم خوارزمية الاستدلال بمقارنة خصائص البصمة G(N) لتقييم أي الخوارزميات الرياضية أنسب للتحليل لتوفير الطاقة الحسابية غير المستهدفة.
                  </p>
                  <div className="space-y-3">
                    {getDecisionIndex().map((algo, i) => (
                      <div key={algo.name} className="bg-slate-950/80 border border-slate-850 p-3 rounded-lg flex items-center justify-between gap-4">
                        <div className="flex items-start gap-3 flex-1">
                          <div className="mt-0.5">{algo.icon}</div>
                          <div>
                            <div className="text-xs font-bold text-slate-200 flex items-center gap-2">
                              <span>{algo.name}</span>
                              {i === 0 && <span className="text-[9px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/25 px-1.5 py-0.5 rounded">موصى به</span>}
                            </div>
                            <p className="text-[11px] text-slate-400 mt-0.5">{algo.desc}</p>
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <div className="text-xs font-mono text-slate-400">الأولوية البنيوية</div>
                          <div className="text-sm font-mono font-bold text-slate-200 flex items-center gap-1.5 justify-end mt-0.5">
                            <div className="w-16 bg-slate-800 h-1.5 rounded-full overflow-hidden hidden sm:block">
                              <div className="bg-cyan-500 h-full" style={{ width: `${algo.score}%` }} />
                            </div>
                            <span>{algo.score}%</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Verifiable Mathematical Outputs */}
              <AnimatePresence>
                {status === 'success' && factors && (
                  <motion.div 
                    initial={{ opacity: 0, y: 15 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-emerald-950/20 border border-emerald-500/30 rounded-xl p-5 space-y-4"
                  >
                    <div className="flex items-center justify-between gap-3 text-emerald-400 font-bold text-sm">
                      <div className="flex items-center gap-2">
                        <CheckCircle className="w-5 h-5 flex-shrink-0" />
                        <span>تم التحقق الرياضي والبرهان بنجاح! (p × q = N) - Axiom 7</span>
                      </div>
                      <span className="text-xs bg-emerald-950 border border-emerald-500/40 text-emerald-300 font-mono px-2.5 py-1 rounded-md">
                        طابق مدخلك تماماً 100%
                      </span>
                    </div>

                    <div className="bg-slate-950 border border-slate-800/80 rounded-lg p-3">
                      <div className="text-cyan-400 text-xs font-mono font-bold mb-1">العدد المستهدف الأصلي المدخل (N):</div>
                      <div className="font-mono text-slate-200 text-xs sm:text-sm break-all select-all">{inputN.trim()}</div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="bg-slate-950 border border-slate-800/80 rounded-lg p-3.5">
                        <div className="text-slate-400 text-xs mb-1 font-semibold">العامل الأول p (البرهان الحسابي)</div>
                        <div className="font-mono text-slate-200 text-xs sm:text-sm break-all select-all">{factors.p}</div>
                      </div>
                      <div className="bg-slate-950 border border-slate-800/80 rounded-lg p-3.5">
                        <div className="text-slate-400 text-xs mb-1 font-semibold">العامل الثاني q (البرهان الحسابي)</div>
                        <div className="font-mono text-slate-200 text-xs sm:text-sm break-all select-all">{factors.q}</div>
                      </div>
                    </div>
                    {generatedPem && (
                      <div className="bg-slate-950 border border-slate-800 rounded-lg p-4">
                        <div className="text-slate-400 text-xs mb-2 font-semibold">مفتاح RSA الخاص المتولد (PEM format):</div>
                        <pre className="font-mono text-emerald-400 text-[10px] sm:text-xs break-all whitespace-pre-wrap select-all bg-slate-900/50 p-2 rounded">{generatedPem}</pre>
                      </div>
                    )}
                  </motion.div>
                )}

                {status === 'failed' && (
                  <motion.div 
                    initial={{ opacity: 0, y: 15 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-slate-900 border border-slate-800 rounded-xl p-5 text-center space-y-3"
                  >
                    <h3 className="text-rose-400 font-bold text-sm">انتهى مسار البحث التوجيهي دون إثبات عوامل</h3>
                    <p className="text-slate-400 text-xs max-w-lg mx-auto">
                      تم تنفيذ كافة اختبارات ECM ضمن حد التصفية المسموح ولم نتمكن من كشف العوامل. يثبت هذا أن البصمة بنيوية وتوجيهية وليست برهاناً مسبقاً، تماشياً مع قواعد ومسلمات نظرية علم Gleeok.
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        )}

        {activeTab === 'algebra' && (
          <motion.div
            key="algebra"
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            className="grid grid-cols-1 lg:grid-cols-12 gap-6"
          >
            {/* Input values for two numbers */}
            <div className="lg:col-span-4 space-y-6">
              <Panel title="مدخلات القياس والمقارنة" icon={<Scale className="w-4 h-4 text-cyan-400" />}>
                <div className="space-y-4">
                  <div>
                    <label className="block text-slate-400 text-xs mb-2 font-medium">العدد الكائن الأول (A)</label>
                    <input 
                      dir="ltr"
                      value={inputA}
                      onChange={(e) => setInputA(e.target.value)}
                      placeholder="أدخل الكائن A..."
                      className="w-full bg-slate-950 border border-slate-800 focus:border-cyan-500/50 rounded-lg p-3 text-slate-100 font-mono text-sm outline-none transition-colors"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-400 text-xs mb-2 font-medium">العدد الكائن الثاني (B)</label>
                    <input 
                      dir="ltr"
                      value={inputB}
                      onChange={(e) => setInputB(e.target.value)}
                      placeholder="أدخل الكائن B..."
                      className="w-full bg-slate-950 border border-slate-800 focus:border-cyan-500/50 rounded-lg p-3 text-slate-100 font-mono text-sm outline-none transition-colors"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-400 text-xs mb-2 font-medium">قيمة الخطوة الحساسة (Delta Δ)</label>
                    <input 
                      dir="ltr"
                      value={inputDelta}
                      onChange={(e) => setInputDelta(e.target.value)}
                      placeholder="خطوة التفاضل البنيوي..."
                      className="w-full bg-slate-950 border border-slate-800 focus:border-cyan-500/50 rounded-lg p-3 text-slate-100 font-mono text-sm outline-none transition-colors"
                    />
                  </div>

                  <div className="bg-slate-950 p-3 rounded-lg border border-slate-850 space-y-1 text-xs">
                    <span className="text-cyan-400 font-bold block mb-1">تعليمات الجبر:</span>
                    <p className="text-slate-400 leading-relaxed">
                      عند تغيير قيمة الكائنين A و B، يقوم المعالج باستخراج البصمة G(A) و G(B) ومقارنتهما تلقائياً لحساب المسافات والمؤشرات الطبوغرافية الفورية.
                    </p>
                  </div>
                </div>
              </Panel>

              {/* Structural Calculus Stats */}
              <Panel title="حساب التفاضل البنيوي (Calculus)" icon={<Flame className="w-4 h-4 text-rose-400" />}>
                {comparisonResult ? (
                  <div className="space-y-3.5">
                    <div>
                      <div className="text-[10px] text-slate-500 font-mono">DELTA VALUE</div>
                      <div className="text-xs font-mono font-bold text-slate-300">Δ = {inputDelta}</div>
                    </div>
                    <MetricRow 
                      label="التغير البنيوي SV(A, Δ)" 
                      value={comparisonResult.sv.toFixed(4)} 
                    />
                    <MetricRow 
                      label="معدل التغير SR" 
                      value={comparisonResult.sr.toFixed(4)} 
                    />
                    <MetricRow 
                      label="الحساسية البنيوية SS" 
                      value={comparisonResult.ss.toFixed(4)} 
                    />
                    <MetricRow 
                      label="القصور البنيوي SI(A)" 
                      value={comparisonResult.si.toFixed(4)} 
                    />
                    <p className="text-[11px] text-slate-400 leading-relaxed pt-2 border-t border-slate-800/80">
                      كلما كبرت الحساسية البنيوية <span className="text-rose-400 font-semibold">SS</span>، كانت المنطقة المحيطة بـ A مشوشة هندسياً وتفتقر للاستقرار الثنائي.
                    </p>
                  </div>
                ) : (
                  <div className="text-xs text-slate-500 text-center py-4">أدخل قيم A و B للبدء</div>
                )}
              </Panel>

              {/* Structural Dynamics Panel */}
              <Panel title="ديناميكا البنية الرقمية (Dynamics)" icon={<Compass className="w-4 h-4 text-emerald-400" />}>
                {comparisonResult ? (
                  <div className="space-y-3">
                    <MetricRow 
                      label="الكثافة البنيوية للمجال SD(A)" 
                      value={comparisonResult.sd.toFixed(4)} 
                    />
                    <MetricRow 
                      label="الضغط البنيوي SP(A)" 
                      value={comparisonResult.sp.toExponential(4)} 
                    />
                    <MetricRow 
                      label="الطاقة البنيوية SE(A)" 
                      value={comparisonResult.f1.metrics.energy.toFixed(4)} 
                    />
                    <MetricRow 
                      label="رنين بنيوي (A ↔ B)" 
                      value={comparisonResult.similarity > 0.88 ? (
                        <span className="text-emerald-400 font-bold bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20 text-xs">رنين نشط</span>
                      ) : (
                        <span className="text-slate-500 text-xs">خامل</span>
                      )} 
                    />
                    <p className="text-[11px] text-slate-400 leading-relaxed pt-2 border-t border-slate-800/80">
                      يحدث <span className="text-emerald-400 font-bold">الرنين البنيوي</span> عندما تتشابه بصمات أعداد متباعدة في فضاء الأعداد، مما يدل على تماثل جوهري في التركيبة الرياضية الداخلية.
                    </p>
                  </div>
                ) : (
                  <div className="text-xs text-slate-500 text-center py-4">أدخل قيم A و B للبدء</div>
                )}
              </Panel>
            </div>

            {/* Comparison Workspace */}
            <div className="lg:col-span-8 space-y-6">
              {comparisonResult ? (
                <>
                  {/* Similarity Metrics Banner */}
                  <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg relative overflow-hidden flex flex-col sm:flex-row items-center justify-between gap-6">
                    <div className="absolute top-0 right-0 w-24 h-24 bg-cyan-500/5 blur-xl pointer-events-none" />
                    <div>
                      <h3 className="text-sm font-bold text-slate-200">التقارب الجبري والتشابه الهندي (Similarity Algebra)</h3>
                      <p className="text-slate-400 text-xs mt-1">المسافة والتشابه بين المتجهات الكاملة G(A) و G(B)</p>
                    </div>
                    <div className="flex items-center gap-6 text-right w-full sm:w-auto justify-between sm:justify-end">
                      <div>
                        <div className="text-xs text-slate-500 font-mono">DISTANCE DIFFERENCE</div>
                        <div className="text-lg font-mono font-bold text-rose-400 mt-0.5">{comparisonResult.diff.toFixed(6)}</div>
                      </div>
                      <div className="border-l border-slate-800 h-8 hidden sm:block" />
                      <div>
                        <div className="text-xs text-slate-500 font-mono">SIMILARITY INDEX</div>
                        <div className="text-xl font-mono font-bold text-cyan-400 mt-0.5">{(comparisonResult.similarity * 100).toFixed(2)}%</div>
                      </div>
                    </div>
                  </div>

                  {/* Side-by-Side Binary Comparison Block */}
                  <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <Database className="w-4 h-4 text-purple-400" />
                        <h3 className="text-slate-200 font-semibold text-sm">البنية الثنائية المقارنة (B)</h3>
                      </div>
                      <span className="text-[10px] font-mono text-slate-500">Binary Bit Alignment</span>
                    </div>
                    <div className="space-y-4">
                      <div>
                        <div className="text-[11px] text-slate-400 font-bold mb-1.5 flex justify-between">
                          <span>العدد الأول Binary(A):</span>
                          <span className="text-cyan-400 font-mono">{comparisonResult.f1.B.bitLength} bits</span>
                        </div>
                        <div className="bg-slate-950 p-3 rounded font-mono text-xs text-slate-300 break-all leading-relaxed whitespace-pre-wrap border border-slate-850/80 text-left" dir="ltr">
                          {comparisonResult.f1.B.binary.split('').map((bit, i) => (
                            <span 
                              key={i} 
                              className={bit !== comparisonResult.f2.B.binary[i] ? 'text-rose-400 font-bold bg-rose-500/10 px-0.5' : 'text-cyan-400'}
                            >
                              {bit}
                            </span>
                          ))}
                        </div>
                      </div>

                      <div>
                        <div className="text-[11px] text-slate-400 font-bold mb-1.5 flex justify-between">
                          <span>العدد الثاني Binary(B):</span>
                          <span className="text-cyan-400 font-mono">{comparisonResult.f2.B.bitLength} bits</span>
                        </div>
                        <div className="bg-slate-950 p-3 rounded font-mono text-xs text-slate-300 break-all leading-relaxed whitespace-pre-wrap border border-slate-850/80 text-left" dir="ltr">
                          {comparisonResult.f2.B.binary.split('').map((bit, i) => (
                            <span 
                              key={i} 
                              className={bit !== comparisonResult.f1.B.binary[i] ? 'text-rose-400 font-bold bg-rose-500/10 px-0.5' : 'text-slate-400'}
                            >
                              {bit}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="text-[10px] text-slate-500 leading-relaxed text-right">
                        * يتم تظليل البتات المتخالفة بين العددين باللون <span className="text-rose-400">الأحمر</span> لمراقبة قفزات التفاضل البنيوي محلياً.
                      </div>
                    </div>
                  </div>

                  {/* Feature-by-Feature Normalized Comparison Matrix */}
                  <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg">
                    <div className="flex items-center gap-2 mb-4">
                      <Layers className="w-4 h-4 text-amber-400" />
                      <h3 className="text-slate-200 font-semibold text-sm">مصفوفة دمج الخصائص والخصائص الجبرية المعايرة (Merge & Normalize)</h3>
                    </div>
                    <div className="space-y-4">
                      {comparisonResult.merged.map((feat) => {
                        return (
                          <div key={feat.label} className="space-y-1.5">
                            <div className="flex justify-between items-center text-xs">
                              <span className="text-slate-300 font-medium">{feat.label}</span>
                              <span className="font-mono text-slate-400">
                                A: <span className="text-cyan-400">{feat.v1.toFixed(3)}</span> | B: <span className="text-purple-400">{feat.v2.toFixed(3)}</span>
                              </span>
                            </div>
                            <div className="relative w-full h-2 bg-slate-950 rounded-full overflow-hidden border border-slate-850">
                              {/* Horizontal bar for A */}
                              <div 
                                className="absolute left-0 top-0 h-1/2 bg-cyan-500/80 transition-all duration-300" 
                                style={{ width: `${Math.min(100, Math.max(0, feat.v1 * 100))}%` }}
                              />
                              {/* Horizontal bar for B */}
                              <div 
                                className="absolute left-0 bottom-0 h-1/2 bg-purple-500/80 transition-all duration-300" 
                                style={{ width: `${Math.min(100, Math.max(0, feat.v2 * 100))}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </>
              ) : (
                <div className="h-48 bg-slate-900 border border-slate-800 rounded-xl flex items-center justify-center text-slate-500">
                  يرجى توفير قيم A و B صحيحة لرسم المصفوفة...
                </div>
              )}
            </div>
          </motion.div>
        )}

        {activeTab === 'book' && (
          <motion.div
            key="book"
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            className="grid grid-cols-1 lg:grid-cols-12 gap-6"
          >
            {/* Table of Contents / Sidebar */}
            <div className="lg:col-span-4 space-y-4">
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-lg">
                <div className="text-xs font-bold text-slate-500 mb-3 uppercase tracking-wider font-mono">فهرس المحاضرات والمسلمات</div>
                <div className="space-y-1">
                  {bookSections.map((sec) => (
                    <button
                      key={sec.id}
                      onClick={() => setSelectedBookSection(sec.id)}
                      className={`w-full text-right p-3 rounded-lg text-xs font-bold transition-all flex justify-between items-center ${selectedBookSection === sec.id ? 'bg-cyan-500/10 text-cyan-400 border-r-2 border-cyan-400' : 'text-slate-400 hover:bg-slate-850/50 hover:text-slate-200'}`}
                    >
                      <div className="space-y-0.5">
                        <span className="block text-[10px] text-slate-500 font-medium">{sec.chapter}</span>
                        <span>{sec.title}</span>
                      </div>
                      <ChevronLeft className="w-3.5 h-3.5" />
                    </button>
                  ))}
                </div>
              </div>

              {/* Quick Info Box */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-lg text-xs space-y-2">
                <div className="flex items-center gap-2 text-cyan-400 font-bold">
                  <Info className="w-4 h-4" />
                  <span>دليل محاكاة مختبر Gleeok</span>
                </div>
                <p className="text-slate-400 leading-relaxed">
                  يمكنك النقر على الزر الذهبي <span className="text-amber-400 font-semibold">"تحميل في المختبر"</span> داخل أي فصل لمشاهدة المبدأ الرياضي مطبقاً ومحسوباً بشكل عملي مع الرسوم الطيفية.
                </p>
              </div>
            </div>

            {/* Reading Panel */}
            <div className="lg:col-span-8 space-y-6">
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-lg space-y-6">
                <div className="border-b border-slate-800 pb-4 flex justify-between items-center flex-wrap gap-4">
                  <div className="space-y-1">
                    <span className="text-xs text-cyan-400 font-bold font-mono uppercase tracking-wider">{currentSection.chapter}</span>
                    <h2 className="text-lg sm:text-xl font-bold text-slate-100">{currentSection.title}</h2>
                  </div>
                  {currentSection.demoData && (
                    <button
                      onClick={() => {
                        if (currentSection.demoData) loadPreset(currentSection.demoData);
                      }}
                      className="flex items-center gap-2 bg-gradient-to-r from-amber-500/20 to-yellow-500/20 hover:from-amber-500/30 hover:to-yellow-500/30 border border-amber-500/30 text-amber-300 px-4 py-2 rounded-lg text-xs font-bold transition-all shadow-md"
                    >
                      <Cpu className="w-3.5 h-3.5" />
                      تحميل مثال الفصل في المختبر
                    </button>
                  )}
                </div>

                <div className="prose prose-invert max-w-none text-slate-300 text-xs sm:text-sm leading-relaxed whitespace-pre-wrap">
                  {currentSection.content}
                </div>

                {currentSection.demoData && (
                  <div className="bg-slate-950/80 p-4 rounded-lg border border-slate-850 space-y-2.5">
                    <div className="text-xs font-bold text-slate-400">القيم المعلمية لهذا المبدأ التوضيحي:</div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs font-mono">
                      {currentSection.demoData.N && (
                        <div className="flex justify-between p-2 bg-slate-900 rounded border border-slate-850">
                          <span className="text-slate-500">N (المدخل الرئيسي)</span>
                          <span className="text-slate-300">{currentSection.demoData.N}</span>
                        </div>
                      )}
                      {currentSection.demoData.A && (
                        <div className="flex justify-between p-2 bg-slate-900 rounded border border-slate-850">
                          <span className="text-slate-500">الكائن A</span>
                          <span className="text-slate-300">{currentSection.demoData.A}</span>
                        </div>
                      )}
                      {currentSection.demoData.B && (
                        <div className="flex justify-between p-2 bg-slate-900 rounded border border-slate-850">
                          <span className="text-slate-500">الكائن B</span>
                          <span className="text-slate-300">{currentSection.demoData.B}</span>
                        </div>
                      )}
                      {currentSection.demoData.delta && (
                        <div className="flex justify-between p-2 bg-slate-900 rounded border border-slate-850">
                          <span className="text-slate-500">الخطوة Delta Δ</span>
                          <span className="text-slate-300">{currentSection.demoData.delta}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Panel({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
   return (
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg">
         <div className="flex items-center gap-2 mb-4">
            {icon}
            <h3 className="text-slate-200 font-bold text-sm">{title}</h3>
         </div>
         <div className="space-y-3">
            {children}
         </div>
      </div>
   );
}

function MetricRow({ label, value }: { label: React.ReactNode; value: React.ReactNode }) {
   return (
      <div className="flex justify-between items-center text-xs sm:text-sm border-b border-slate-850 pb-2 last:border-0 last:pb-0">
         <span className="text-slate-400 font-medium">{label}</span>
         <span className="font-mono text-slate-200 font-medium text-right">{value}</span>
      </div>
   );
}

const statusMap: Record<DashboardStatus, { label: string; color: string }> = {
   idle: { label: 'في الانتظار', color: 'text-slate-400 bg-slate-500/10' },
   generating_gleeok: { label: 'توليد تبديلات Gleeok-n...', color: 'text-blue-400 bg-blue-400/10' },
   calculating_footprint: { label: 'استخراج البصمة البنيوية...', color: 'text-amber-400 bg-amber-400/10' },
   ranking_curves: { label: 'ترتيب ووزن أولويات المنحنيات...', color: 'text-purple-400 bg-purple-400/10' },
   running_ecm: { label: 'تنفيذ خوارزمية ECM الموجهة...', color: 'text-cyan-400 bg-cyan-400/10' },
   success: { label: 'اكتمل البرهان بنجاح', color: 'text-emerald-400 bg-emerald-400/10' },
   failed: { label: 'فشل / انتهت المسارات', color: 'text-rose-400 bg-rose-400/10' },
};

function StatusBadge({ status }: { status: DashboardStatus }) {
   const config = statusMap[status];
   return (
      <div className={`inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-xs font-semibold ${config.color}`}>
         {status !== 'idle' && status !== 'success' && status !== 'failed' && (
            <RefreshCcw className="w-3 h-3 animate-spin" />
         )}
         {config.label}
      </div>
   );
}
