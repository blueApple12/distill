// DISTILL — top-level component. Holds all state and renders:
//   ┌──────────────────────────────────────────────────────────────────┐
//   │ ◉ background blobs (animated radial glows, per section)          │
//   │ ┌────────────────────── .shell ─────────────────────────────┐   │
//   │ │ ┌────────────── Carousel (drag / swipe / tap) ───────────┐ │   │
//   │ │ │  SETTINGS   │    TREE    │  TRAINER (ANSWER or GUESS)  │ │   │
//   │ │ └──────────────────────────────────────────────────────────┘ │   │
//   │ │ .tab-bar — SETTINGS / TREE / TRAINER                        │   │
//   │ └────────────────────────────────────────────────────────────┘   │
//   │ ◉ CustomQEditor (floating, when editingCqId)                     │
//   └──────────────────────────────────────────────────────────────────┘
import { memo, useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { isHebrew, nW } from './algo.js';
import { getCollisionAdvice } from './solver.js';
import { INITIAL_SOLVER_STATE, beginSolverRequest, applySolverMessage } from './solverState.js';
import { advanceTree, traceWord } from './treeSession.js';
import { lsGet, lsSet, lsDel } from './storage.js';
import { C, buildTheme } from './theme.js';
import { Tag, SideRow, MiniStepper } from './ui.jsx';
import { TreeView } from './TreeView.jsx';
import { CustomQEditor } from './CustomQEditor.jsx';
import { Carousel } from './Carousel.jsx';
import { GLOBAL_CSS } from './globalStyles.js';

const SECTIONS = ['settings', 'tree', 'trainer'];

export default function App() {
  // ── state ─────────────────────────────────────────────────────────────────
  const [mode, setMode] = useState('5050');
  const [allowed, setAllowed] = useState({ cups: true, length: true, contains: true, position: true, dupe: true });
  const [allowNegative, setAllowNegative] = useState(true);
  const [maxNOs, setMaxNOs] = useState(0);
  const [stopAt, setStopAt] = useState(1);
  const [maxExclude, setMaxExclude] = useState(0);
  const [solverState, setSolverState] = useState(INITIAL_SOLVER_STATE);
  const [solutionVariantIdx, setSolutionVariantIdx] = useState(0);
  const requestIdRef = useRef(0);
  const [words, setWords] = useState([]);
  const [phase, setPhase] = useState('idle');         // idle | q | guess | result | quizReveal | quizResult
  const [remaining, setRemaining] = useState([]);
  const [currentNode, setCurrentNode] = useState(null);
  const [qn, setQn] = useState(0);
  const [noUsed, setNoUsed] = useState(0);
  const [hist, setHist] = useState([]);
  const [guesses, setGuesses] = useState([]);
  const [showList, setShowList] = useState(false);
  const [showSaved, setShowSaved] = useState(false);
  const [savedList, setSavedList] = useState([]);
  const [saveNameInp, setSaveNameInp] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [section, setSection] = useState('settings');       // 'settings' | 'tree' | 'trainer'
  const [trainerMode, setTrainerMode] = useState('answer'); // 'answer' | 'guess' — TRAINER sub-mode
  const [secretWord, setSecretWord] = useState(null);
  const [quizGuess, setQuizGuess] = useState(null);
  const [showHist, setShowHist] = useState(false);
  const [showDbg, setShowDbg] = useState(false);
  const [showQDrop, setShowQDrop] = useState(false);
  const [inp, setInp] = useState('');
  const [key, setKey] = useState(0);                   // forces re-mount for .fade animation
  const [customQs, setCustomQs] = useState([]);
  const [editingCqId, setEditingCqId] = useState(null);
  const [cqInp, setCqInp] = useState('');

  // ── derived ───────────────────────────────────────────────────────────────
  const wl = useMemo(() => [...new Set(words)], [words]);
  const heb = wl.length > 0 && isHebrew(wl[0]);
  const inGame = phase === 'q' || phase === 'guess';
  const exclVariants = solverState.solution?.variants || [];
  const exclVariantIdx = solutionVariantIdx;
  const setExclVariantIdx = setSolutionVariantIdx;
  const selectedVariant = exclVariants[Math.min(solutionVariantIdx, Math.max(0, exclVariants.length - 1))] || null;
  const selectedTree = selectedVariant?.tree || null;
  const exclSugg = solverState.advice;
  const excluded = useMemo(() => selectedVariant?.toExclude || [], [selectedVariant]);
  const excludedSet = useMemo(() => new Set(excluded), [excluded]);
  const effectiveWl = useMemo(() => wl.filter(w => !excludedSet.has(w)), [wl, excludedSet]);
  const T2 = useMemo(() => buildTheme(section), [section]);
  const conf = remaining.length
    ? Math.max(0, Math.min(100, Math.round(100 - (remaining.length / Math.max(wl.length, 1)) * 100 + qn * 2)))
    : 100;
  const curQ = currentNode?.q || null;
  const editingCq = customQs.find(q => q.id === editingCqId);

  const loadTreeAlternatives = useCallback((path, baseline) => new Promise((resolve, reject) => {
    if (typeof Worker === 'undefined') {
      reject(new Error('Alternative calculation is unavailable in this browser.'));
      return;
    }
    const requestId = `${requestIdRef.current}:${path.join('/')}:${Date.now()}`;
    const worker = new Worker(new URL('./alternativeWorker.js', import.meta.url), { type: 'module' });
    const finish = callback => value => { worker.terminate(); callback(value); };
    worker.addEventListener('message', finish(event => {
      if (event.data?.requestId !== requestId) return;
      if (event.data.type === 'error') reject(new Error(event.data.error));
      else resolve(event.data.alternatives || []);
    }));
    worker.addEventListener('error', finish(() => reject(new Error('Alternative calculation stopped unexpectedly.'))), { once: true });
    worker.postMessage({
      requestId, path, baseline,
      options: {
        words: wl, mode, maxNOs, stopAt, maxExclude, allowed, customQs, allowNegative,
        maxVariants: 5,
      },
    });
  }), [wl, mode, maxNOs, stopAt, maxExclude, allowed, customQs, allowNegative]);

  const applyTreeAlternative = useCallback(variant => {
    const variants = solverState.solution?.variants || [];
    const keyOf = item => JSON.stringify([item.toExclude || [], item.tree]);
    const key = keyOf(variant);
    let index = variants.findIndex(item => keyOf(item) === key);
    if (index < 0) {
      index = variants.length;
      setSolverState(state => ({
        ...state,
        solution: { ...state.solution, variants: [...(state.solution?.variants || []), variant] },
      }));
    }
    setSolutionVariantIdx(index);
    setCurrentNode(null);
    setPhase('idle');
  }, [solverState.solution]);

  // ── effects ───────────────────────────────────────────────────────────────
  // Build one authoritative tree off-thread whenever algorithm input changes.
  useEffect(() => {
    const requestId = ++requestIdRef.current;
    setSolutionVariantIdx(0);
    setCurrentNode(null);
    setPhase('idle');
    if (!wl.length) {
      setSolverState({ ...INITIAL_SOLVER_STATE, requestId });
      return undefined;
    }
    // O(words × questions) proof: do not flash a worker spinner when the
    // enabled question rules can never distinguish every word.
    if (maxExclude === 0) {
      const collision = getCollisionAdvice(wl, { allowed, customQs });
      if (collision.required > 0) {
        setSolverState({
          requestId,
          status: 'impossible',
          solution: { status: 'impossible', variants: [], tree: null, depth: null, excluded: [], validation: null },
          advice: { kind: 'required', count: collision.required, variants: [] },
          error: null,
        });
        return undefined;
      }
    }
    setSolverState(state => beginSolverRequest(state, requestId));
    if (typeof Worker === 'undefined') {
      setSolverState(state => applySolverMessage(state, {
        requestId, type: 'error', error: 'Optimization is unavailable in this browser.',
      }));
      return undefined;
    }
    const worker = new Worker(new URL('./exclusionWorker.js', import.meta.url), { type: 'module' });
    worker.addEventListener('message', event => {
      setSolverState(state => applySolverMessage(state, event.data));
      if (event.data?.type === 'advice' || event.data?.type === 'error') worker.terminate();
    });
    worker.addEventListener('error', () => {
      setSolverState(state => applySolverMessage(state, {
        requestId, type: 'error', error: 'The optimizer stopped unexpectedly.',
      }));
    }, { once: true });
    worker.postMessage({
      requestId,
      options: {
        words: wl, mode, maxNOs, stopAt, maxExclude, allowed, customQs, allowNegative,
        maxVariants: 5, suggestionDepth: 5, maxSuggestionExclude: 10,
      },
    });
    return () => worker.terminate();
  }, [words, mode, maxNOs, stopAt, maxExclude, allowNegative, JSON.stringify(allowed), JSON.stringify(customQs)]);

  // When exclusions change mid-game, drop those words from the remaining pool.
  useEffect(() => {
    if (!inGame) return;
    setRemaining(r => r.filter(w => !excluded.includes(w)));
  }, [excluded.join(',')]);

  // Load saved anagrams on mount.
  useEffect(() => {
    const raw = lsGet('anagram_index');
    if (raw) setSavedList(raw.map(id => lsGet(id)).filter(Boolean));
  }, []);

  // Sync body background + accent CSS vars with the active theme.
  useEffect(() => {
    document.body.style.backgroundColor = T2.bg;
    document.body.style.transition = 'background-color 0.4s var(--ease)';
    document.documentElement.style.setProperty('--accent', T2.sec);
    document.documentElement.style.setProperty('--accent-pri', T2.pri);
  }, [T2.bg, T2.sec, T2.pri]);

  // Page scroll resets to top when the visible section changes — the page is
  // the scroll container now (not the panels), so a scrolled-down Settings
  // must not leave the next section starting mid-scroll.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [section]);

  // ── trainer flow (ANSWER mode) ───────────────────────────────────────────
  const goToGuess = useCallback(r => { setGuesses(r); setPhase('guess'); }, []);

  const startGame = useCallback(() => {
    if (!selectedTree) return;
    setRemaining(selectedTree.words); setQn(0); setNoUsed(0);
    setHist([]); setGuesses([]); setKey(k => k + 1);
    setCurrentNode(selectedTree);
    if (selectedTree.q) setPhase('q');
    else goToGuess(selectedTree.words);
  }, [selectedTree, goToGuess]);

  const handleAnswer = useCallback(val => {
    const next = advanceTree(currentNode, val);
    if (next.status === 'no-match') {
      setRemaining([]); setGuesses([]); setPhase('guess');
      return;
    }
    const ans = currentNode.q.type === 'bin' ? (val ? 'YES' : 'NO') : String(val);
    setHist(h => [...h, {
      q: currentNode.q.text,
      ans,
      before: currentNode.words.length, after: next.node.words.length,
      isNo: next.noDelta === 1, type: currentNode.q.type,
    }]);
    setRemaining(next.node.words); setQn(n => n + 1);
    setNoUsed(used => used + next.noDelta); setKey(k => k + 1);
    setCurrentNode(next.node);
    if (next.status === 'leaf') goToGuess(next.node.words);
  }, [currentNode, goToGuess]);

  // ── trainer flow (GUESS mode) ─────────────────────────────────────────────
  // App secretly picks a random word and silently plays out the exact same
  // algorithm against it — the magician only sees the resulting Q&A trail and
  // has to call the word.
  const startQuiz = useCallback(() => {
    if (!selectedTree?.words.length) return;
    const secret = selectedTree.words[Math.floor(Math.random() * selectedTree.words.length)];
    const trace = traceWord(selectedTree, secret);
    setSecretWord(secret); setHist(trace.trail);
    setRemaining(trace.node?.words || []);
    setQn(trace.trail.length); setNoUsed(trace.noUsed); setKey(k => k + 1);
    setPhase('quizReveal');
  }, [selectedTree]);

  const submitQuizGuess = useCallback(w => {
    setQuizGuess(w);
    setPhase('quizResult');
  }, []);

  // ── persistence ───────────────────────────────────────────────────────────
  const saveAnagram = useCallback(name => {
    if (!name.trim() || !wl.length) return;
    const base = { name: name.trim(), words: wl, mode, maxNOs, stopAt, maxExclude, allowed, customQs, savedAt: Date.now() };
    if (editingId) {
      const item = { ...base, id: editingId };
      lsSet(editingId, item);
      setSavedList(s => s.map(x => x.id === editingId ? item : x));
      setEditingId(null);
    } else {
      const id = `ag_${Date.now()}`;
      const item = { ...base, id };
      lsSet(id, item);
      lsSet('anagram_index', [...(lsGet('anagram_index') || []), id]);
      setSavedList(s => [...s, item]);
    }
  }, [wl, mode, maxNOs, stopAt, maxExclude, allowed, customQs, savedList, editingId]);

  const applyAnagram = useCallback((item, edit = false) => {
    setWords(item.words); setMode(item.mode); setMaxNOs(item.maxNOs);
    if (item.stopAt) setStopAt(item.stopAt);
    if (item.maxExclude !== undefined) setMaxExclude(item.maxExclude);
    const a = item.allowed || item.allowedQTypes;
    if (a) setAllowed(a);
    setCustomQs(item.customQs || []);
    setEditingCqId(null);
    setPhase('idle'); setShowSaved(false);
    if (edit) { setEditingId(item.id); setSaveNameInp(item.name); setShowList(true); }
  }, []);

  const deleteAnagram = useCallback(id => {
    lsDel(id);
    const rem = savedList.filter(s => s.id !== id);
    lsSet('anagram_index', rem.map(s => s.id));
    setSavedList(rem);
  }, [savedList]);

  // ── word & custom-Q helpers ───────────────────────────────────────────────
  const addWords = useCallback(raw => {
    const ws = raw.split(/[,،\n\s]+/).map(w => w.trim()).filter(Boolean);
    if (ws.length) setWords(c => [...new Set([...c, ...ws])]);
  }, []);

  const addCustomQ = useCallback(() => {
    const id = `cu_${Date.now()}`;
    setCustomQs(qs => [...qs, { id, text: '', type: 'bin', answers: [], tags: {} }]);
    setAllowed(a => ({ ...a, [id]: true }));
    setEditingCqId(id);
    setShowList(false); setShowSaved(false);
  }, []);

  const updateCustomQ = useCallback((id, patch) => {
    setCustomQs(qs => qs.map(q => q.id === id ? { ...q, ...patch } : q));
  }, []);

  const deleteCustomQ = useCallback(id => {
    setCustomQs(qs => qs.filter(q => q.id !== id));
    setAllowed(a => { const n = { ...a }; delete n[id]; return n; });
    if (editingCqId === id) setEditingCqId(null);
  }, [editingCqId]);

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <div className="tx" style={{
      minHeight: '100dvh', background: T2.bg, color: '#e8e0ff',
      fontFamily: "'Space Mono',monospace", position: 'relative', overflowX: 'clip',
    }}>
      <BackgroundBlobs section={section} />
      <style>{GLOBAL_CSS}</style>

      <div className="shell">
        <Carousel index={SECTIONS.indexOf(section)} onChange={i => setSection(SECTIONS[i])}>
          <SettingsSection
            T2={T2}
            mode={mode} setMode={setMode}
            allowed={allowed} setAllowed={setAllowed}
            allowNegative={allowNegative} setAllowNegative={setAllowNegative}
            maxNOs={maxNOs} setMaxNOs={setMaxNOs}
            stopAt={stopAt} setStopAt={setStopAt}
            maxExclude={maxExclude} setMaxExclude={setMaxExclude}
            exclSugg={exclSugg}
            showQDrop={showQDrop} setShowQDrop={setShowQDrop}
            customQs={customQs} setEditingCqId={setEditingCqId} addCustomQ={addCustomQ} deleteCustomQ={deleteCustomQ}
            wl={wl} effectiveWl={effectiveWl} excluded={excluded}
            showList={showList} setShowList={setShowList}
            showSaved={showSaved} setShowSaved={setShowSaved}
            inp={inp} setInp={setInp} addWords={addWords} setWords={setWords} heb={heb}
            saveNameInp={saveNameInp} setSaveNameInp={setSaveNameInp}
            editingId={editingId} setEditingId={setEditingId}
            saveAnagram={saveAnagram} savedList={savedList}
            applyAnagram={applyAnagram} deleteAnagram={deleteAnagram}
          />

          <TreeSection
            T2={T2} active={section === 'tree'}
            wl={wl} effectiveWl={effectiveWl} excluded={excluded}
            mode={mode} maxNOs={maxNOs} allowed={allowed}
            solverState={solverState}
            variants={exclVariants} variantIdx={exclVariantIdx} setVariantIdx={setExclVariantIdx}
            loadTreeAlternatives={loadTreeAlternatives} applyTreeAlternative={applyTreeAlternative}
          />

          <TrainerSection
            T2={T2}
            phase={phase} setPhase={setPhase}
            wl={wl} effectiveWl={effectiveWl} excluded={excluded}
            mode={mode} maxNOs={maxNOs} allowed={allowed}
            curQ={curQ} qn={qn} noUsed={noUsed} remaining={remaining}
            guesses={guesses} hist={hist} conf={conf}
            gameKey={key} heb={heb}
            trainerMode={trainerMode} setTrainerMode={setTrainerMode}
            solverState={solverState}
            secretWord={secretWord} quizGuess={quizGuess}
            startGame={startGame} handleAnswer={handleAnswer}
            startQuiz={startQuiz} submitQuizGuess={submitQuizGuess}
            showHist={showHist} setShowHist={setShowHist}
            showDbg={showDbg} setShowDbg={setShowDbg}
          />
        </Carousel>

        <TabBar T2={T2} section={section} setSection={setSection} />
      </div>

      {editingCq && (
        <CustomQEditor
          cq={editingCq} T2={T2} wl={wl}
          cqInp={cqInp} setCqInp={setCqInp}
          onBack={() => setEditingCqId(null)}
          onUpdate={patch => updateCustomQ(editingCq.id, patch)}
          onDelete={() => {
            if (confirm(`Delete "${editingCq.text || 'untitled'}"?`)) deleteCustomQ(editingCq.id);
          }}
        />
      )}
    </div>
  );
}

// ── Background animated radial blobs ────────────────────────────────────────
// Structural theme tokens (T2.pri/sec) are identical for 'settings' and
// 'trainer' (locked rule: modeColor always purple) — the two are told apart
// ambiently instead, right here: settings is pure purple and calm, trainer
// reuses the existing vivid purple+green blend for a "showtime" feel, tree
// stays green-led. No third hue anywhere.
const BackgroundBlobs = memo(function BackgroundBlobs({ section }) {
  const purple = 'rgba(155,109,255,0.22)';
  const green = 'rgba(122,223,46,0.22)';
  const purpleSub = 'rgba(155,109,255,0.13)';
  const greenSub = 'rgba(122,223,46,0.13)';
  const purpleCalm = 'rgba(155,109,255,0.15)';
  const purpleCalmDim = 'rgba(155,109,255,0.09)';
  const RECIPE = {
    tree: [green, purple, greenSub],
    trainer: [purple, green, purpleSub],
    settings: [purpleCalm, purpleCalmDim, purpleCalmDim],
  };
  const [c1, c2, c3] = RECIPE[section] || RECIPE.trainer;
  const blob = (cls, style, color) => (
    <div className={`tx blob ${cls}`} style={{
      position: 'fixed', borderRadius: '50%', pointerEvents: 'none', zIndex: 0,
      background: `radial-gradient(circle,${color} 0%,transparent 60%)`,
      ...style,
    }} />
  );
  return (
    <>
      {blob('blob1', { top: '10%', right: '5%', width: '55vw', height: '55vw' }, c1)}
      {blob('blob2', { bottom: '10%', left: '5%', width: '50vw', height: '50vw' }, c2)}
      {blob('blob3', { top: '50%', left: '30%', width: '35vw', height: '35vw' }, c3)}
    </>
  );
});

// ── Floating tab dock — SETTINGS / TREE / TRAINER, identical everywhere ────
const TabBar = memo(function TabBar({ T2, section, setSection }) {
  const tabs = [
    { k: 'settings', lbl: 'SETTINGS' },
    { k: 'tree', lbl: 'TREE' },
    { k: 'trainer', lbl: 'TRAINER' },
  ];
  return (
    <div className="tx tab-dock" style={{ background: T2.cardGlass, border: `1px solid ${T2.border}` }}>
      {tabs.map(b => {
        const active = section === b.k;
        return (
          <button key={b.k} onClick={() => setSection(b.k)} style={{
            background: active ? T2.pri : 'transparent',
            color: active ? '#10061f' : 'rgba(200,200,220,0.45)',
            boxShadow: active ? `0 2px 14px ${T2.pri}55` : 'none',
          }}>{b.lbl}</button>
        );
      })}
    </div>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// SETTINGS — mode / algorithm / questions / words, as a responsive card grid
// ─────────────────────────────────────────────────────────────────────────────
const SettingsSection = memo(function SettingsSection({
  T2,
  mode, setMode,
  allowed, setAllowed,
  allowNegative, setAllowNegative,
  maxNOs, setMaxNOs, stopAt, setStopAt, maxExclude, setMaxExclude, exclSugg,
  showQDrop, setShowQDrop,
  customQs, setEditingCqId, addCustomQ, deleteCustomQ,
  wl, effectiveWl, excluded,
  showList, setShowList, showSaved, setShowSaved,
  inp, setInp, addWords, setWords, heb,
  saveNameInp, setSaveNameInp, editingId, setEditingId,
  saveAnagram, savedList, applyAnagram, deleteAnagram,
}) {
  const builtIns = [
    ['length', 'Exact length', '"Exactly 4 letters?"'],
    ['contains', 'Contains letter', '"Contains E?"'],
    ['position', 'Letter at position', '"Is the 2nd letter T?"'],
    ['dupe', 'Repeated letter', '"Any letter appears twice?"'],
    ['cups', 'Letter count', '"How many letters?"'],
  ];
  const cardTitle = txt => (
    <div style={{
      padding: '12px 14px 8px', fontSize: 10, letterSpacing: 3, fontWeight: 700,
      color: 'rgba(200,200,220,0.32)', fontFamily: "'Space Mono',monospace",
    }}>{txt}</div>
  );
  const cardStyle = {
    background: T2.cardGlass,
    backdropFilter: 'blur(14px) saturate(140%)',
    WebkitBackdropFilter: 'blur(14px) saturate(140%)',
    border: `1px solid ${T2.border}`,
    borderRadius: 16, overflow: 'hidden',
    boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
  };

  return (
    <div>
      {/* Logo */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20, paddingTop: 4 }}>
        <img src={`${import.meta.env.BASE_URL}logo.png`} alt="" width={34} height={34}
          className="tx" style={{ borderRadius: 9, display: 'block', flexShrink: 0, border: `0.5px solid ${T2.border}` }} />
        <div>
          <div className="tx" style={{ fontFamily: "'Space Mono',monospace", fontSize: 18, fontWeight: 700, letterSpacing: 5, color: T2.pri, lineHeight: 1 }}>DISTILL</div>
          <div className="tx" style={{ height: 2, width: 48, marginTop: 6, borderRadius: 1, background: T2.sec, opacity: 0.7 }} />
        </div>
      </div>

      <div className="settings-grid">
        {/* MODE */}
        <div className="tx glass-surface" style={cardStyle}>
          {cardTitle('MODE')}
          <div style={{ padding: '0 14px 14px' }}>
            <div className="tx" style={{
              display: 'flex', borderRadius: 7, overflow: 'hidden',
              border: `0.5px solid ${T2.border}`, background: 'rgba(0,0,0,0.2)',
            }}>
              {[['5050', 'BALANCED'], ['sniper', 'PRECISION']].map(([v, lbl]) => (
                <button key={v} onClick={() => setMode(v)} style={{
                  flex: 1, padding: '8px 4px', fontSize: 10, fontWeight: 700, letterSpacing: 1,
                  background: mode === v ? T2.pri + '28' : 'transparent',
                  color: mode === v ? T2.pri : 'rgba(200,200,220,0.3)',
                  borderRight: v === '5050' ? `0.5px solid ${T2.border}` : 'none',
                  transition: 'all 0.4s',
                }}>{lbl}</button>
              ))}
            </div>
          </div>
        </div>

        {/* ALGORITHM steppers */}
        <div className="tx glass-surface" style={cardStyle}>
          {cardTitle('ALGORITHM')}
          <SideRow T2={T2} label="MAX NOs" desc="Stop after X no answers" labelColor={T2.pri}>
            <MiniStepper min={0} max={8} onChange={setMaxNOs} display={maxNOs === 0 ? '∞' : String(maxNOs)} color={T2.sec} />
          </SideRow>
          <SideRow T2={T2} label="STOP AT" desc={`End at ${stopAt} option${stopAt !== 1 ? 's' : ''}`} labelColor={T2.pri}>
            <MiniStepper min={1} max={8} onChange={setStopAt} display={String(stopAt)} color={T2.sec} />
          </SideRow>
          <SideRow T2={T2} label="EXCL" desc="Remove words that shorten tree" last labelColor={T2.pri}
            badge={exclSugg ? `${exclSugg.count} ${exclSugg.kind}` : null}>
            <MiniStepper min={0} max={10} onChange={setMaxExclude} display={maxExclude === 0 ? 'off' : String(maxExclude)} color={maxExclude > 0 ? T2.sec : undefined} />
          </SideRow>
        </div>

        {/* QUESTIONS — built-in toggles + custom Qs + add button */}
        <div className="tx glass-surface" style={cardStyle}>
          {cardTitle('QUESTIONS')}
          <div style={{ padding: '0 14px 14px' }}>
            <button onClick={() => setShowQDrop(d => !d)} className="tx" style={{
              width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '8px 12px', borderRadius: 7,
              background: showQDrop ? T2.secDim : 'rgba(255,255,255,0.04)',
              border: `0.5px solid ${showQDrop ? T2.secBorder : T2.border}`,
              color: 'rgba(200,200,220,0.7)', transition: 'all 0.2s',
            }}>
              <span style={{ fontSize: 11, fontFamily: "'Space Mono',monospace", letterSpacing: 1 }}>
                {Object.values(allowed).filter(Boolean).length} / {Object.keys(allowed).length} enabled
              </span>
              <span style={{
                fontSize: 10, display: 'inline-block',
                transform: showQDrop ? 'rotate(180deg)' : 'none',
                transition: 'transform 0.2s', color: T2.sec,
              }}>▾</span>
            </button>
            {showQDrop && (
              <div className="fade" style={{
                marginTop: 6, borderRadius: 7, overflow: 'hidden',
                border: `0.5px solid ${T2.border}`, background: 'rgba(0,0,0,0.25)',
              }}>
                {builtIns.map(([k, lbl, ex]) => {
                  const on = !!allowed[k];
                  return (
                    <div key={k} onClick={() => setAllowed(a => ({ ...a, [k]: !a[k] }))}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '9px 12px', cursor: 'pointer',
                        borderBottom: `0.5px solid ${T2.border}`,
                        transition: 'background 0.12s', userSelect: 'none',
                      }}>
                      <Checkbox on={on} T2={T2} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 12, color: on ? '#e8e0ff' : 'rgba(200,200,220,0.4)', fontFamily: "'Space Mono',monospace", transition: 'color 0.15s' }}>{lbl}</div>
                        <div style={{ fontSize: 9, color: 'rgba(200,200,220,0.28)', marginTop: 1, fontFamily: "'Space Mono',monospace" }}>{ex}</div>
                      </div>
                    </div>
                  );
                })}
                <div onClick={() => setAllowNegative(v => !v)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', cursor: 'pointer', userSelect: 'none' }}>
                  <Checkbox on={allowNegative} T2={T2} />
                  <div><div style={{ fontSize: 12, color: allowNegative ? '#e8e0ff' : 'rgba(200,200,220,0.4)', fontFamily: "'Space Mono',monospace" }}>Negative questions</div><div style={{ fontSize: 9, color: 'rgba(200,200,220,0.28)' }}>Last resort only</div></div>
                </div>
                {customQs.map(cq => {
                  const on = !!allowed[cq.id];
                  const tagCount = Object.keys(cq.tags || {}).length;
                  const ex = cq.type === 'bin'
                    ? `${tagCount} tagged YES`
                    : `${(cq.answers || []).length} answers · ${tagCount} tagged`;
                  return (
                    <div key={cq.id} style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '9px 12px', borderBottom: `0.5px solid ${T2.border}`,
                      transition: 'background 0.12s', userSelect: 'none',
                    }}>
                      <div onClick={() => setAllowed(a => ({ ...a, [cq.id]: !a[cq.id] }))} style={{ cursor: 'pointer' }}>
                        <Checkbox on={on} T2={T2} />
                      </div>
                      <div onClick={() => setEditingCqId(cq.id)} style={{ flex: 1, cursor: 'pointer', minWidth: 0 }}>
                        <div style={{ fontSize: 12, color: on ? T2.pri : 'rgba(200,200,220,0.4)', fontFamily: "'Space Mono',monospace", transition: 'color 0.15s', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cq.text || '(untitled)'}</div>
                        <div style={{ fontSize: 9, color: 'rgba(200,200,220,0.28)', marginTop: 1, fontFamily: "'Space Mono',monospace" }}>{cq.type === 'bin' ? 'yes/no' : 'multi'} · {ex}</div>
                      </div>
                      <button className="tap" onClick={() => setEditingCqId(cq.id)} style={{ background: 'rgba(255,255,255,0.05)', color: T2.pri, border: `0.5px solid ${T2.priBorder}`, borderRadius: 5, padding: '5px 9px', fontSize: 13, lineHeight: 1 }}>✎</button>
                      <button className="tap" onClick={() => { if (confirm(`Delete "${cq.text || 'untitled'}"?`)) deleteCustomQ(cq.id); }} style={{ background: 'rgba(224,107,77,0.1)', color: 'rgba(224,107,77,0.75)', border: '0.5px solid rgba(224,107,77,0.3)', borderRadius: 5, padding: '5px 9px', fontSize: 15, lineHeight: 1 }}>×</button>
                    </div>
                  );
                })}
                <button onClick={addCustomQ} className="tx" style={{
                  width: '100%', padding: '9px 12px', fontSize: 10, fontWeight: 700, letterSpacing: 1.5,
                  background: 'transparent', color: T2.pri, border: 'none', textAlign: 'center', cursor: 'pointer',
                }}>+ ADD CUSTOM</button>
              </div>
            )}
          </div>
        </div>

        {/* WORDS — count + edit/saved toggles + sub-panels */}
        <div className="tx glass-surface" style={cardStyle}>
          {cardTitle('WORDS')}
          <div style={{ padding: '0 14px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 12, color: T2.sec, opacity: 0.85 }}>
              {wl.length === 0 ? 'No words yet' : `${effectiveWl.length}${excluded.length > 0 ? ` / ${wl.length}` : ''} words`}
            </div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
              <button onClick={() => { setShowList(s => !s); setShowSaved(false); }} className="tx" style={{
                flex: 1, padding: '7px', fontSize: 10, fontWeight: 700, letterSpacing: 1, borderRadius: 6,
                background: showList ? T2.priDim : 'rgba(255,255,255,0.05)',
                color: showList ? T2.pri : 'rgba(200,200,220,0.45)',
                border: `0.5px solid ${showList ? T2.priBorder : 'rgba(255,255,255,0.08)'}`,
              }}>EDIT</button>
              <button onClick={() => { setShowSaved(s => !s); setShowList(false); }} className="tx" style={{
                flex: 1, padding: '7px', fontSize: 10, fontWeight: 700, letterSpacing: 1, borderRadius: 6,
                background: showSaved ? T2.secDim : 'rgba(255,255,255,0.05)',
                color: showSaved ? T2.sec : 'rgba(200,200,220,0.45)',
                border: `0.5px solid ${showSaved ? T2.secBorder : 'rgba(255,255,255,0.08)'}`,
              }}>SAVED{savedList.length ? ` (${savedList.length})` : ''}</button>
            </div>

            {showList && (
              <WordEditPanel
                T2={T2} wl={wl} heb={heb}
                inp={inp} setInp={setInp} addWords={addWords} setWords={setWords}
                saveNameInp={saveNameInp} setSaveNameInp={setSaveNameInp}
                editingId={editingId} setEditingId={setEditingId}
                saveAnagram={saveAnagram}
              />
            )}
            {showSaved && (
              <SavedListPanel T2={T2} savedList={savedList} applyAnagram={applyAnagram} deleteAnagram={deleteAnagram} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
});

function Checkbox({ on, T2 }) {
  return (
    <div style={{
      width: 16, height: 16, borderRadius: 4, flexShrink: 0,
      border: `1.5px solid ${on ? T2.sec : T2.border}`,
      background: on ? T2.sec : 'transparent',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      transition: 'all 0.15s',
    }}>
      {on && <span style={{ color: '#081a08', fontSize: 10, fontWeight: 900, lineHeight: 1 }}>✓</span>}
    </div>
  );
}

function WordEditPanel({
  T2, wl, heb,
  inp, setInp, addWords, setWords,
  saveNameInp, setSaveNameInp, editingId, setEditingId, saveAnagram,
}) {
  return (
    <div className="fade" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {/* Add words */}
      <div style={{ display: 'flex', gap: 4 }}>
        <input value={inp} onChange={e => setInp(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && inp.trim()) { addWords(inp); setInp(''); } }}
          placeholder="word(s)..."
          style={{ flex: 1, background: 'rgba(0,0,0,0.25)', border: `0.5px solid ${T2.border}`, borderRadius: 6, padding: '6px 8px', fontSize: 11 }} />
        <button onClick={() => { if (inp.trim()) { addWords(inp); setInp(''); } }} className="tx"
          style={{ background: T2.priDim, color: T2.pri, border: `0.5px solid ${T2.priBorder}`, borderRadius: 6, padding: '0 10px', fontSize: 11, fontWeight: 700, letterSpacing: 1 }}>ADD</button>
      </div>
      {/* Word chips */}
      <div style={{ background: 'rgba(0,0,0,0.2)', border: `0.5px solid ${T2.border}`, borderRadius: 6, padding: '8px 10px', maxHeight: 220, overflowY: 'auto' }}>
        {wl.length > 0 ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
            {wl.map(w => (
              <span key={w} style={{
                display: 'inline-flex', alignItems: 'center', gap: 3,
                background: 'rgba(255,255,255,0.05)', border: '0.5px solid rgba(255,255,255,0.09)',
                borderRadius: 3, padding: '2px 5px', fontSize: 10,
                fontFamily: heb ? "'Noto Sans Hebrew',sans-serif" : "'Space Mono',monospace",
                color: '#b8b8d0', direction: heb ? 'rtl' : 'ltr',
              }}>
                {w}
                <button className="tap" onClick={() => setWords(c => c.filter(x => x !== w))}
                  style={{ background: 'none', color: 'rgba(200,200,220,0.55)', padding: '0 4px', fontSize: 14, lineHeight: 1, minWidth: 18, minHeight: 18 }}>×</button>
              </span>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 10, color: 'rgba(200,200,220,0.3)', textAlign: 'center', padding: '4px 0' }}>No words yet — type above</div>
        )}
      </div>
      {/* Save / clear */}
      {wl.length > 0 && (
        <div style={{ display: 'flex', gap: 4 }}>
          <input value={saveNameInp} onChange={e => setSaveNameInp(e.target.value)}
            placeholder={editingId ? 'rename...' : 'save as...'}
            style={{ flex: 1, background: 'rgba(0,0,0,0.25)', border: `0.5px solid ${T2.border}`, borderRadius: 6, padding: '6px 8px', fontSize: 11 }} />
          <button onClick={() => { if (saveNameInp.trim()) { saveAnagram(saveNameInp); setSaveNameInp(''); } }} className="tx"
            style={{ background: T2.secDim, color: T2.sec, border: `0.5px solid ${T2.secBorder}`, borderRadius: 6, padding: '0 10px', fontSize: 11, fontWeight: 700, letterSpacing: 1 }}>
            {editingId ? 'UPDATE' : 'SAVE'}
          </button>
        </div>
      )}
      {wl.length > 0 && (
        <button onClick={() => {
          if (confirm('Clear all words?')) { setWords([]); setEditingId(null); setSaveNameInp(''); }
        }} className="tx" style={{
          background: 'rgba(224,107,77,0.08)', color: 'rgba(224,107,77,0.7)',
          border: '0.5px solid rgba(224,107,77,0.25)', borderRadius: 6,
          padding: '6px', fontSize: 10, fontWeight: 700, letterSpacing: 1,
        }}>CLEAR ALL</button>
      )}
    </div>
  );
}

function SavedListPanel({ T2, savedList, applyAnagram, deleteAnagram }) {
  if (savedList.length === 0) {
    return (
      <div className="fade" style={{ background: 'rgba(0,0,0,0.2)', border: `0.5px solid ${T2.border}`, borderRadius: 6, padding: '8px 10px' }}>
        <div style={{ fontSize: 9, color: 'rgba(200,200,220,0.3)', textAlign: 'center', padding: '8px 0' }}>No saved anagrams</div>
      </div>
    );
  }
  return (
    <div className="fade" style={{ background: 'rgba(0,0,0,0.2)', border: `0.5px solid ${T2.border}`, borderRadius: 6, padding: '8px 10px', maxHeight: 340, overflowY: 'auto' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {[...savedList].sort((a, b) => b.savedAt - a.savedAt).map(item => (
          <div key={item.id} onClick={() => applyAnagram(item)}
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              background: 'rgba(255,255,255,0.04)', border: '0.5px solid rgba(255,255,255,0.06)',
              borderRadius: 4, padding: '6px 8px', cursor: 'pointer', transition: 'background 0.1s',
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.08)'}
            onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.04)'}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontFamily: isHebrew(item.words[0] || '') ? "'Noto Sans Hebrew',sans-serif" : "'Space Mono',monospace",
                fontSize: 10, fontWeight: 700, color: '#e2e2f0',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 2,
              }}>{item.name}</div>
              <div style={{ fontSize: 8, color: 'rgba(200,200,220,0.3)' }}>{item.words.length} words</div>
            </div>
            <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
              <button className="tap" onClick={e => { e.stopPropagation(); applyAnagram(item, true); }}
                style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(200,200,220,0.7)', border: '0.5px solid rgba(255,255,255,0.1)', borderRadius: 5, fontSize: 13, padding: '4px 8px', cursor: 'pointer' }}>✎</button>
              <button className="tap" onClick={e => { e.stopPropagation(); deleteAnagram(item.id); }}
                style={{ background: 'rgba(224,107,77,0.1)', color: 'rgba(224,107,77,0.75)', border: '0.5px solid rgba(224,107,77,0.25)', borderRadius: 5, fontSize: 15, padding: '4px 8px', cursor: 'pointer', lineHeight: 1 }}>×</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── TREE view ───────────────────────────────────────────────────────────────
const TreeSection = memo(function TreeSection({
  T2, active,
  wl, effectiveWl, excluded,
  mode, maxNOs, allowed,
  solverState, variants, variantIdx, setVariantIdx,
  loadTreeAlternatives, applyTreeAlternative,
}) {
  const ready = solverState.solution?.status === 'solved';
  return (
    <div key="tree-view" className="softFade" style={{ display: 'flex', flexDirection: 'column', width: '100%', flex: 1, minHeight: 0 }}>
      <div style={{ alignSelf: 'flex-start', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Tag color={T2.pri}>TREE</Tag>
        {wl.length > 0 && (
          <>
            <Tag color={T2.sec}>{mode === '5050' ? 'BALANCED' : 'PRECISION'}</Tag>
            {allowed.cups && <Tag color={T2.sec}>LETTER COUNT</Tag>}
            {maxNOs > 0 && <Tag color={T2.sec}>NO×{maxNOs}</Tag>}
            {excluded.length > 0 && <Tag color={T2.sec}>−{excluded.length}</Tag>}
            <span style={{ fontSize: 10, color: 'rgba(200,200,220,0.25)' }}>{effectiveWl.length} words</span>
          </>
        )}
      </div>
      {wl.length === 0 ? <EmptyCard T2={T2} /> : (
        <>
          <div style={{ height: '70vh', maxHeight: 600, display: 'flex', flexDirection: 'column' }}>
            {ready ? (
              <TreeView
                active={active}
                variants={variants} variantIdx={variantIdx} setVariantIdx={setVariantIdx}
                onLoadAlternatives={loadTreeAlternatives} onApplyAlternative={applyTreeAlternative}
                modeBorder={T2.modeBorder}
              />
            ) : (
              <SolverStatusCard T2={T2} solverState={solverState} />
            )}
          </div>
          <div style={{ flex: 1, minHeight: 80, padding: '24px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start', gap: 8, opacity: 0.5 }}>
            <div style={{ fontSize: 10, letterSpacing: 2, color: 'rgba(200,200,220,0.3)' }}>◇ DISTILL ◇</div>
          </div>
        </>
      )}
    </div>
  );
});

const SolverStatusCard = memo(function SolverStatusCard({ T2, solverState }) {
  const advice = solverState.advice;
  const message = solverState.status === 'optimizing'
    ? 'Optimizing…'
    : solverState.status === 'impossible'
      ? advice?.kind === 'required'
        ? `These rules cannot distinguish all words. At least ${advice.count} word${advice.count === 1 ? '' : 's'} must be excluded.`
        : 'No valid tree can satisfy both MAX NOs and STOP AT with the enabled questions.'
      : solverState.error || 'Optimization unavailable.';
  return (
    <div style={{ flex: 1, display: 'grid', placeItems: 'center', padding: 24 }}>
      <div className="tx glass-surface" style={{
        background: T2.cardGlass,
        border: `1px solid ${T2.border}`,
        borderRadius: 16,
        padding: '24px 20px',
        width: 'min(100%, 420px)',
        textAlign: 'center',
        color: 'rgba(220,220,240,0.62)',
        lineHeight: 1.65,
      }}>{message}</div>
    </div>
  );
});

const EmptyCard = memo(function EmptyCard({ T2 }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', flex: 1, width: '100%', padding: '48px 0' }}>
      <div className="tx glass-surface" style={{
        background: T2.cardGlass, backdropFilter: 'blur(14px) saturate(140%)', WebkitBackdropFilter: 'blur(14px) saturate(140%)',
        border: `1px solid ${T2.border}`, borderRadius: 18, padding: '36px 28px',
        textAlign: 'center', width: '90%', maxWidth: 320, boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
      }}>
        <img src={`${import.meta.env.BASE_URL}logo.png`} alt="" width={52} height={52}
          style={{ borderRadius: 14, marginBottom: 14, opacity: 0.85 }} />
        <div style={{ fontSize: 14, color: 'rgba(200,200,220,0.5)', lineHeight: 1.7 }}>Add words in <span style={{ color: T2.pri, fontWeight: 700 }}>SETTINGS</span> to begin</div>
      </div>
    </div>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// TRAINER — magician-only rehearsal, two sub-modes: ANSWER / GUESS
// ─────────────────────────────────────────────────────────────────────────────
const TrainerSection = memo(function TrainerSection({
  T2,
  phase, setPhase,
  wl, effectiveWl, excluded,
  mode, maxNOs, allowed,
  curQ, qn, noUsed, remaining, guesses, hist, conf,
  gameKey, heb,
  trainerMode, setTrainerMode, secretWord, quizGuess,
  solverState,
  startGame, handleAnswer, startQuiz, submitQuizGuess,
  showHist, setShowHist, showDbg, setShowDbg,
}) {
  // Smooth-scroll back to top on question/phase change, so a scrolled-down
  // HIST/DBG expansion doesn't leave the next question off-screen. The page
  // itself is the scroll container.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [phase, curQ?.id]);

  return (
    <div style={{ width: '100%' }}>
      {phase === 'idle' && (
        <TrainerIdle T2={T2}
          wl={wl} effectiveWl={effectiveWl} mode={mode} allowed={allowed} maxNOs={maxNOs}
          solverState={solverState}
          trainerMode={trainerMode} setTrainerMode={setTrainerMode}
          startGame={startGame} startQuiz={startQuiz} />
      )}
      {phase === 'q' && curQ && (
        <TrainerQuestion
          key={gameKey}
          T2={T2} setPhase={setPhase}
          mode={mode} maxNOs={maxNOs} noUsed={noUsed}
          curQ={curQ} qn={qn} remaining={remaining} excluded={excluded} conf={conf} heb={heb}
          hist={hist} startGame={startGame} handleAnswer={handleAnswer}
          showHist={showHist} setShowHist={setShowHist}
          showDbg={showDbg} setShowDbg={setShowDbg}
        />
      )}
      {phase === 'guess' && (
        <TrainerGuess key={gameKey} T2={T2} mode={mode} qn={qn} guesses={guesses} heb={heb}
          startGame={startGame} setPhase={setPhase} />
      )}
      {phase === 'result' && (
        <TrainerResult key={gameKey} T2={T2} qn={qn} noUsed={noUsed} maxNOs={maxNOs}
          hist={hist} heb={heb} startGame={startGame} setPhase={setPhase} />
      )}
      {phase === 'quizReveal' && (
        <QuizReveal key={gameKey} T2={T2} hist={hist} heb={heb}
          onGuess={submitQuizGuess} />
      )}
      {phase === 'quizResult' && (
        <QuizResult key={gameKey} T2={T2} secretWord={secretWord} quizGuess={quizGuess}
          hist={hist} heb={heb} startQuiz={startQuiz} setPhase={setPhase} />
      )}
    </div>
  );
});

function TrainerIdle({ T2, wl, effectiveWl, mode, allowed, maxNOs, solverState, trainerMode, setTrainerMode, startGame, startQuiz }) {
  const isGuess = trainerMode === 'guess';
  const ready = solverState.status === 'solved';
  return (
    <div key="hunt-idle" className="softFade" style={{ display: 'flex', flexDirection: 'column', width: '100%', flex: 1, minHeight: 0, textAlign: 'center' }}>
      <div style={{ alignSelf: 'flex-start', marginBottom: 12 }}>
        <Tag color={T2.pri}>TRAINER</Tag>
      </div>
      <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', width: '100%' }}>
        {wl.length === 0 ? <EmptyCard T2={T2} /> : !ready ? (
          <SolverStatusCard T2={T2} solverState={solverState} />
        ) : (
          <div className="tx glass-surface" style={{
            background: T2.cardGlass, backdropFilter: 'blur(14px) saturate(140%)', WebkitBackdropFilter: 'blur(14px) saturate(140%)',
            border: `1px solid ${T2.border}`, borderRadius: 18, padding: '28px 24px',
            width: '90%', maxWidth: 420, boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
          }}>
            {/* ANSWER / GUESS — rehearsal sub-mode. Only changeable from idle. */}
            <div className="tx" style={{
              display: 'flex', borderRadius: 7, overflow: 'hidden', marginBottom: 18,
              border: `0.5px solid ${T2.border}`, background: 'rgba(0,0,0,0.2)',
            }}>
              {[['answer', 'ANSWER'], ['guess', 'GUESS']].map(([v, lbl]) => (
                <button key={v} onClick={() => setTrainerMode(v)} style={{
                  flex: 1, padding: '8px 4px', fontSize: 10, fontWeight: 700, letterSpacing: 1,
                  background: trainerMode === v ? T2.pri + '28' : 'transparent',
                  color: trainerMode === v ? T2.pri : 'rgba(200,200,220,0.3)',
                  borderRight: v === 'answer' ? `0.5px solid ${T2.border}` : 'none',
                  transition: 'all 0.4s',
                }}>{lbl}</button>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
              <Tag color={T2.sec}>{mode === '5050' ? 'BALANCED' : 'PRECISION'}</Tag>
              {allowed.cups && <Tag color={T2.sec}>LETTER COUNT</Tag>}
              {maxNOs > 0 && <Tag color={T2.sec}>NO ×{maxNOs}</Tag>}
              <Tag color='rgba(200,200,220,0.35)'>{effectiveWl.length} words</Tag>
            </div>
            <div style={{ fontSize: 15, color: 'rgba(200,200,220,0.55)', marginBottom: 22 }}>
              {isGuess ? "I'll pick a word — you call it." : 'Think of a word.'}
            </div>
            <button onClick={isGuess ? startQuiz : startGame} style={{
              background: T2.modeColor, color: '#10061f',
              borderRadius: 12, padding: '15px 28px', width: '100%',
              fontSize: 15, fontWeight: 700, letterSpacing: 1.5,
              boxShadow: `0 4px 20px ${T2.modeColor}44`,
            }}>
              {isGuess ? 'TEST ME →' : 'I HAVE A WORD →'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function TrainerQuestion({
  T2, setPhase,
  mode, maxNOs, noUsed,
  curQ, qn, remaining, excluded, conf, heb,
  hist, startGame, handleAnswer,
  showHist, setShowHist, showDbg, setShowDbg,
}) {
  return (
    <div className="fade">
      {/* Status strip */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        <Tag color={T2.pri}>TRAINER</Tag>
        <button onClick={() => { if (confirm('Exit session?')) setPhase('idle'); }} style={{
          background: 'rgba(255,255,255,0.04)', color: 'rgba(200,200,220,0.6)',
          border: '0.5px solid rgba(255,255,255,0.12)', borderRadius: 6,
          padding: '4px 10px', fontSize: 10, fontWeight: 700, letterSpacing: 1,
        }}>← BACK</button>
        <Tag color={T2.sec}>{mode === '5050' ? 'BALANCED' : 'PRECISION'}</Tag>
        {maxNOs > 0 && (
          <Tag color={noUsed >= maxNOs ? '#e06b4d' : T2.sec}>
            {noUsed >= maxNOs ? '⚡ MAX YES MODE' : `NO ${noUsed}/${maxNOs}`}
          </Tag>
        )}
        <div style={{ marginInlineStart: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          {excluded.length > 0 && (
            <span style={{ fontSize: 9, color: T2.sec, fontFamily: "'Space Mono',monospace", maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: 0.8 }}>−{excluded.join('·')}</span>
          )}
          <span style={{ fontSize: 10, color: 'rgba(200,200,220,0.28)' }}>Q{qn + 1}</span>
          <span style={{ fontSize: 10, color: remaining.length < 8 ? '#e06b4d' : T2.sec }}>{remaining.length} left</span>
          <span style={{ fontSize: 10, color: conf > 70 ? T2.sec : 'rgba(200,200,220,0.28)' }}>{conf}%</span>
          <button onClick={startGame} style={{ background: 'rgba(255,255,255,0.04)', color: 'rgba(200,200,220,0.35)', border: '0.5px solid rgba(255,255,255,0.09)', borderRadius: 4, padding: '3px 9px', fontSize: 10, letterSpacing: 1 }}>↺</button>
        </div>
      </div>

      {/* Confidence bar */}
      <div style={{ height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 2, marginBottom: 14, overflow: 'hidden' }}>
        <div style={{
          height: '100%', width: '100%', background: T2.sec, borderRadius: 2,
          boxShadow: `0 0 8px ${T2.sec}88`, transform: `scaleX(${conf / 100})`,
          transformOrigin: 'left center', transition: 'transform 0.35s var(--ease)',
        }} />
      </div>

      {/* Question card */}
      <div className="tx glass-surface" style={{
        background: T2.cardGlass, backdropFilter: 'blur(14px) saturate(140%)', WebkitBackdropFilter: 'blur(14px) saturate(140%)',
        border: `1px solid ${T2.modeBorder}`, borderRadius: 16, padding: '24px 22px', marginBottom: 14,
        boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
      }}>
        <div style={{
          fontFamily: heb ? "'Noto Sans Hebrew',sans-serif" : "'Space Mono',monospace",
          fontSize: 19, lineHeight: 1.6, fontWeight: 700, color: '#f0ecff', direction: heb ? 'rtl' : 'ltr',
        }}>{curQ.text}</div>
        {curQ.type === 'bin' && curQ.meta && (
          <div style={{ marginTop: 8, fontSize: 11, color: 'rgba(200,200,220,0.3)' }}>
            YES {curQ.meta.yes} ({Math.round(100 * curQ.meta.yes / remaining.length)}%) · NO {curQ.meta.no}
          </div>
        )}
      </div>

      {/* Answer buttons */}
      {curQ.type === 'bin' ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
          <button onClick={() => handleAnswer(true)} style={{
            background: T2.sec, color: '#0a1802', borderRadius: 14,
            padding: '18px 0', fontSize: 19, fontWeight: 700, letterSpacing: 2,
            boxShadow: `0 4px 20px ${T2.sec}33`,
          }}>YES</button>
          <button onClick={() => handleAnswer(false)} style={{
            background: 'transparent', color: T2.sec, border: `1.5px solid ${T2.secBorder}`,
            borderRadius: 14, padding: '18px 0', fontSize: 19, fontWeight: 700, letterSpacing: 2,
          }}>NO</button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(76px, 1fr))', gap: 10, marginBottom: 12 }}>
          {curQ.meta?.cups?.map((cup, ci) => {
            const cnt = curQ.meta.dist?.[ci] || 0;
            return (
              <button key={cup} onClick={() => handleAnswer(cup)} style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4,
                background: T2.secDim, color: T2.sec,
                border: `1px solid ${T2.secBorder}`, borderRadius: 999,
                padding: '14px 10px', minHeight: 56, fontWeight: 700, fontSize: 20,
                fontFamily: heb ? "'Noto Sans Hebrew',sans-serif" : "'Space Mono',monospace",
                direction: heb ? 'rtl' : 'ltr',
              }}>
                <span>{cup}</span>
                <span style={{
                  fontSize: 10, fontWeight: 700, color: T2.sec,
                  background: T2.sec + '1f', border: `0.5px solid ${T2.sec}66`,
                  borderRadius: 999, padding: '2px 8px',
                }}>{Math.round(100 * cnt / Math.max(remaining.length, 1))}%</span>
              </button>
            );
          })}
        </div>
      )}

      {/* History / debug expanders */}
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <button onClick={() => setShowHist(h => !h)} style={{ background: 'none', color: 'rgba(200,200,220,0.25)', fontSize: 10, letterSpacing: 1, padding: '2px 0' }}>▾ HIST ({hist.length})</button>
        <button onClick={() => setShowDbg(d => !d)} style={{ background: 'none', color: 'rgba(200,200,220,0.13)', fontSize: 10, padding: '2px 0' }}>DBG</button>
      </div>
      {showHist && hist.length > 0 && (
        <div style={{ marginTop: 6, background: '#090914', border: '0.5px solid rgba(255,255,255,0.06)', borderRadius: 6, padding: '8px 10px', maxHeight: 170, overflowY: 'auto' }}>
          {[...hist].reverse().map((h, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 44px 52px', gap: 6, alignItems: 'center', padding: '3px 0', borderBottom: '0.5px solid rgba(255,255,255,0.04)' }}>
              <div style={{ fontSize: 11, color: 'rgba(200,200,220,0.42)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: heb ? "'Noto Sans Hebrew',sans-serif" : "'Space Mono',monospace", direction: heb ? 'rtl' : 'ltr' }}>{h.q}</div>
              <div style={{ fontSize: 11, fontWeight: 700, textAlign: 'center', color: h.ans === 'YES' ? C.blue : h.type === 'cup' ? C.green : '#e06b4d' }}>{h.ans}</div>
              <div style={{ fontSize: 10, color: 'rgba(200,200,220,0.22)', textAlign: 'right' }}>{h.before}→{h.after}</div>
            </div>
          ))}
        </div>
      )}
      {showDbg && (
        <div style={{ marginTop: 4, background: '#090914', border: '0.5px solid rgba(255,255,255,0.05)', borderRadius: 6, padding: '7px 10px' }}>
          <div style={{ fontSize: 10, color: 'rgba(200,200,220,0.22)', letterSpacing: 1, marginBottom: 4 }}>REMAINING ({remaining.length})</div>
          <div style={{
            fontSize: 12, color: 'rgba(200,200,220,0.5)', lineHeight: 1.9, wordBreak: 'break-all',
            fontFamily: heb ? "'Noto Sans Hebrew',sans-serif" : "'Space Mono',monospace",
            direction: heb ? 'rtl' : 'ltr',
          }}>
            {remaining.slice(0, 50).join(' · ')}{remaining.length > 50 ? ` +${remaining.length - 50}` : ''}
          </div>
        </div>
      )}
    </div>
  );
}

function TrainerGuess({ T2, mode, qn, guesses, heb, startGame, setPhase }) {
  const headline = guesses.length === 0 ? 'NO MATCH FOUND'
    : guesses.length === 1 ? 'MY ANSWER'
    : guesses.length === 2 ? 'TWO REMAIN'
    : 'CANDIDATES';
  return (
    <div className="fade">
      <div className="tx glass-surface" style={{
        background: T2.cardGlass, backdropFilter: 'blur(14px) saturate(140%)', WebkitBackdropFilter: 'blur(14px) saturate(140%)',
        border: `1px solid ${T2.modeBorder}`, borderRadius: 18, padding: '26px 22px', boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
      }}>
        <div style={{ fontSize: 11, letterSpacing: 3, fontWeight: 700, color: T2.sec, marginBottom: 4, textAlign: 'center' }}>{headline}</div>
        <div style={{ fontSize: 11, color: 'rgba(200,200,220,0.28)', textAlign: 'center', marginBottom: 18 }}>
          {guesses.length === 0 ? 'Word not in list, or an answer was off.' : `${qn} questions · tap your word`}
        </div>
        {guesses.length === 0 ? (
          <div style={{ textAlign: 'center' }}>
            <button onClick={startGame} style={{ background: T2.secDim, color: T2.sec, border: `1px solid ${T2.secBorder}`, borderRadius: 7, padding: '10px 22px', fontSize: 13, fontWeight: 700 }}>Play Again</button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {guesses.map((w, i) => (
              <button key={w} onClick={() => setPhase('result')} style={{
                background: i === 0 ? `${T2.sec}18` : 'rgba(255,255,255,0.03)',
                color: i === 0 ? '#f0f0ff' : 'rgba(240,240,255,0.55)',
                border: `0.5px solid ${i === 0 ? T2.secBorder : 'rgba(255,255,255,0.07)'}`,
                borderRadius: 7, padding: i === 0 ? '18px 16px' : '13px 16px',
                fontFamily: heb ? "'Noto Sans Hebrew',sans-serif" : "'Space Mono',monospace",
                fontSize: i === 0 ? 34 : 24, fontWeight: 700,
                letterSpacing: heb ? 2 : 4, direction: heb ? 'rtl' : 'ltr', textAlign: 'center',
              }}>{w}</button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TrainerResult({ T2, qn, noUsed, maxNOs, hist, heb, startGame, setPhase }) {
  const reaction = qn <= 4 ? '🔥 Perfect' : qn <= 8 ? 'Nice' : 'Got there';
  const summary = `${qn} question${qn !== 1 ? 's' : ''}${noUsed > 0 && maxNOs > 0 ? ` · ${noUsed} NO${noUsed > 1 ? 's' : ''} used` : ''} · ${reaction}`;
  return (
    <div className="fade" style={{ textAlign: 'center' }}>
      <div className="tx glass-surface" style={{
        background: T2.cardGlass, backdropFilter: 'blur(14px) saturate(140%)', WebkitBackdropFilter: 'blur(14px) saturate(140%)',
        border: `1px solid ${C.greenBorder}`, borderRadius: 18, padding: '32px 26px', marginBottom: 12, boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
      }}>
        <img src={`${import.meta.env.BASE_URL}logo.png`} alt="" width={52} height={52} style={{ borderRadius: 14, marginBottom: 12 }} />
        <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: 2, marginBottom: 8, color: C.green }}>DONE</div>
        <div style={{ fontSize: 13, color: 'rgba(200,200,220,0.45)', lineHeight: 1.7, marginBottom: 18 }}>{summary}</div>
        {hist.length > 0 && (
          <div style={{ background: 'rgba(0,0,0,0.25)', borderRadius: 6, padding: '10px 12px', marginBottom: 18, textAlign: 'left', maxHeight: 150, overflowY: 'auto' }}>
            <div style={{ fontSize: 9, letterSpacing: 2, color: 'rgba(200,200,220,0.25)', marginBottom: 7 }}>LOG</div>
            {hist.map((h, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 0', borderBottom: '0.5px solid rgba(255,255,255,0.04)' }}>
                <div style={{ fontSize: 11, color: 'rgba(200,200,220,0.4)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: 8, fontFamily: heb ? "'Noto Sans Hebrew',sans-serif" : "'Space Mono',monospace", direction: heb ? 'rtl' : 'ltr' }}>{h.q}</div>
                <div style={{ fontSize: 11, fontWeight: 700, minWidth: 28, color: h.ans === 'YES' ? C.blue : h.type === 'cup' ? C.green : '#e06b4d' }}>{h.ans}</div>
              </div>
            ))}
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <button onClick={startGame} style={{ background: T2.sec, color: '#0a1802', borderRadius: 12, padding: '13px 0', fontSize: 13, fontWeight: 700, letterSpacing: 1.5, boxShadow: `0 4px 16px ${T2.sec}33` }}>AGAIN</button>
          <button onClick={() => setPhase('idle')} style={{ background: 'transparent', color: 'rgba(200,200,220,0.45)', border: '1px solid rgba(200,200,220,0.15)', borderRadius: 12, padding: '13px 0', fontSize: 12, fontWeight: 700, letterSpacing: 1 }}>BACK</button>
        </div>
      </div>
    </div>
  );
}

// ── TRAINER / GUESS mode — silent transcript, open recall ──────────────────
// No pre-filled candidate buttons: the magician has to actually name the
// word, not just tap the one option a narrow tree happens to leave.
function QuizReveal({ T2, hist, heb, onGuess }) {
  const [val, setVal] = useState('');
  const submit = () => { if (val.trim()) onGuess(val.trim()); };
  return (
    <div className="fade">
      <div className="tx glass-surface" style={{
        background: T2.cardGlass, backdropFilter: 'blur(14px) saturate(140%)', WebkitBackdropFilter: 'blur(14px) saturate(140%)',
        border: `1px solid ${T2.modeBorder}`, borderRadius: 18, padding: '24px 22px', boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
      }}>
        <div style={{ fontSize: 11, letterSpacing: 3, fontWeight: 700, color: T2.sec, marginBottom: 4, textAlign: 'center' }}>THE TRAIL</div>
        <div style={{ fontSize: 11, color: 'rgba(200,200,220,0.28)', textAlign: 'center', marginBottom: 18 }}>
          {hist.length} question{hist.length !== 1 ? 's' : ''} answered for you
        </div>
        {hist.length > 0 && (
          <div style={{ background: 'rgba(0,0,0,0.25)', borderRadius: 6, padding: '10px 12px', marginBottom: 20, textAlign: 'left', maxHeight: 200, overflowY: 'auto' }}>
            {hist.map((h, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 0', borderBottom: '0.5px solid rgba(255,255,255,0.04)' }}>
                <div style={{ fontSize: 11, color: 'rgba(200,200,220,0.4)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: 8, fontFamily: heb ? "'Noto Sans Hebrew',sans-serif" : "'Space Mono',monospace", direction: heb ? 'rtl' : 'ltr' }}>{h.q}</div>
                <div style={{ fontSize: 11, fontWeight: 700, minWidth: 28, textAlign: 'right', color: h.ans === 'YES' ? C.blue : h.type === 'cup' ? C.green : '#e06b4d' }}>{h.ans}</div>
              </div>
            ))}
          </div>
        )}
        <div style={{ fontSize: 9, letterSpacing: 2, color: 'rgba(200,200,220,0.28)', textAlign: 'center', marginBottom: 10 }}>WHAT'S THE WORD?</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input value={val} onChange={e => setVal(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submit(); }}
            autoFocus placeholder="type your guess..."
            style={{
              flex: 1, background: 'rgba(0,0,0,0.3)', border: `0.5px solid ${T2.border}`,
              borderRadius: 999, padding: '12px 18px', fontSize: 16, fontWeight: 700,
              textAlign: 'center', color: '#f0f0ff',
              fontFamily: heb ? "'Noto Sans Hebrew',sans-serif" : "'Space Mono',monospace",
              direction: heb ? 'rtl' : 'ltr',
            }} />
          <button onClick={submit} style={{
            background: T2.sec, color: '#0a1802',
            borderRadius: 999, padding: '0 26px', fontSize: 14, fontWeight: 700, letterSpacing: 1,
            boxShadow: `0 4px 16px ${T2.sec}33`,
          }}>GO</button>
        </div>
      </div>
    </div>
  );
}

function QuizResult({ T2, secretWord, quizGuess, hist, heb, startQuiz, setPhase }) {
  const correct = nW(quizGuess.trim()) === nW(secretWord);
  return (
    <div className="fade" style={{ textAlign: 'center' }}>
      <div className="tx glass-surface" style={{
        background: T2.cardGlass, backdropFilter: 'blur(14px) saturate(140%)', WebkitBackdropFilter: 'blur(14px) saturate(140%)',
        border: `1px solid ${correct ? C.greenBorder : 'rgba(224,107,77,0.4)'}`, borderRadius: 18, padding: '32px 26px', marginBottom: 12, boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
      }}>
        <img src={`${import.meta.env.BASE_URL}logo.png`} alt="" width={52} height={52}
          style={{ borderRadius: 14, marginBottom: 12, filter: correct ? 'none' : 'grayscale(0.8) opacity(0.6)' }} />
        <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: 2, marginBottom: 8, color: correct ? C.green : '#e06b4d' }}>
          {correct ? 'NAILED IT' : 'NOT QUITE'}
        </div>
        <div style={{
          fontSize: 13, color: 'rgba(200,200,220,0.45)', lineHeight: 1.7, marginBottom: 18,
          fontFamily: heb ? "'Noto Sans Hebrew',sans-serif" : "'Space Mono',monospace", direction: heb ? 'rtl' : 'ltr',
        }}>
          The word was <span style={{ color: '#f0f0ff', fontWeight: 700 }}>{secretWord}</span>
          {!correct && <> — you guessed <span style={{ color: 'rgba(224,107,77,0.85)', fontWeight: 700 }}>{quizGuess}</span></>}
          <br />{hist.length} question{hist.length !== 1 ? 's' : ''} in the trail
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <button onClick={startQuiz} style={{ background: T2.sec, color: '#0a1802', borderRadius: 12, padding: '13px 0', fontSize: 13, fontWeight: 700, letterSpacing: 1.5, boxShadow: `0 4px 16px ${T2.sec}33` }}>AGAIN</button>
          <button onClick={() => setPhase('idle')} style={{ background: 'transparent', color: 'rgba(200,200,220,0.45)', border: '1px solid rgba(200,200,220,0.15)', borderRadius: 12, padding: '13px 0', fontSize: 12, fontWeight: 700, letterSpacing: 1 }}>BACK</button>
        </div>
      </div>
    </div>
  );
}
