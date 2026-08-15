// DISTILL — decision tree visualization (SVG flowchart with switcher chip).
import { useState, useEffect, useCallback, useRef } from 'react';
import { isHebrew } from './algo.js';

// Layout constants (px).
const TL = { lW: 100, wH: 20, wPad: 8, cW: 140, cH: 38, dH: 52, hG: 32, vG: 52, lblH: 18 };

// Abbreviated diamond label for binary questions.
function abbrevQ(t) {
  let m;
  if ((m = t.match(/Contains "([^"]+)"\?/i))) return [`has "${m[1]}"?`, ''];
  if ((m = t.match(/Is the (\w+) letter "([^"]+)"\?/i))) return [`${m[1]} letter`, `= "${m[2]}"?`];
  if ((m = t.match(/Exactly (\d+) letters\?/i))) return [`exactly ${m[1]}`, 'letters?'];
  if (t.includes('more than once')) return ['any letter', 'appears 2x?'];
  return [t.slice(0, 15), t.slice(15, 28) || ''];
}

// Recursively measure layout for each node.
function layoutNode(node) {
  const isLeaf = !node.q || !Object.keys(node.ch).length;
  if (isLeaf) {
    const n = node.words.length;
    return { tp: 'leaf', w: TL.lW, h: TL.wPad * 2 + Math.max(1, n) * TL.wH, words: node.words };
  }
  const isCup = node.q.type === 'cup';
  const ks = Object.keys(node.ch);
  const cs = ks.map(k => layoutNode(node.ch[k]));
  const totCW = cs.reduce((s, l) => s + l.w, 0) + TL.hG * (ks.length - 1);
  const qH = isCup ? TL.cH : TL.dH * 2;
  return {
    tp: isCup ? 'cup' : 'bin',
    w: Math.max(isCup ? TL.cW : TL.dH * 2, totCW),
    h: qH + TL.vG + TL.lblH + Math.max(...cs.map(l => l.h)),
    // The built-in letter-count question shows its short label here, not the
    // full "How many letters?" phrasing used on the live question card.
    text: isCup && node.q.id === 'cl' ? 'LETTER COUNT' : node.q.text, q: node.q,
    qH, ks, cs, totCW,
  };
}

// Flatten the laid-out tree into a list of SVG primitives.
function gatherEls(lo, cx, y, out, path = []) {
  if (lo.tp === 'leaf') { out.push({ t: 'lf', cx, y, w: lo.w, h: lo.h, sh: lo.words, ex: 0 }); return; }
  if (lo.tp === 'cup') {
    out.push({ t: 'cp', cx, y, w: TL.cW, h: TL.cH, text: lo.text, q: lo.q, path });
  } else {
    out.push({ t: 'di', cx, y, s: TL.dH, ln: abbrevQ(lo.text), q: lo.q, path });
  }
  const cy2 = y + lo.qH + TL.vG;
  let sx = cx - lo.totCW / 2;
  lo.ks.forEach((k, i) => {
    const cl = lo.cs[i], ccx = sx + cl.w / 2;
    out.push({
      t: 'ed', x1: cx, y1: y + lo.qH, x2: ccx, y2: cy2 + TL.lblH,
      lb: k, lx: (cx + ccx) / 2, ly: y + lo.qH + (cy2 - y - lo.qH) * 0.45,
    });
    gatherEls(cl, ccx, cy2 + TL.lblH, out, [...path, k]);
    sx += cl.w + TL.hG;
  });
}

function nodeAtPath(tree, path) {
  return path.reduce((node, key) => node?.ch?.[key], tree);
}

export function TreeView({
  active, variants, variantIdx, setVariantIdx, modeBorder,
  onLoadAlternatives, onApplyAlternative,
}) {
  const [els, setEls] = useState([]);
  const [dim, setDim] = useState({ w: 400, h: 300 });
  const [nodeAlternatives, setNodeAlternatives] = useState({});
  const svgRef = useRef(null);
  const loadingRef = useRef(new Set());
  const safeIndex = Math.min(variantIdx, Math.max(variants.length - 1, 0));
  const current = variants[safeIndex] || null;
  const wl = current?.tree?.words || [];
  const heb = wl.length > 0 && isHebrew(wl[0]);
  const fw = heb ? "'Noto Sans Hebrew',sans-serif" : "'Space Mono',monospace";
  const cacheKeyFor = path => `${safeIndex}:${path.join('\u001f')}`;
  const alternativesFor = path => {
    const existing = [
      { index: safeIndex, q: nodeAtPath(current?.tree, path)?.q },
      ...variants.map((variant, index) => ({ index, q: nodeAtPath(variant.tree, path)?.q })),
    ].filter(item => item.q)
      .filter((item, index, all) => all.findIndex(other => other.q.id === item.q.id) === index)
      .map(item => ({ key: `tree:${item.index}`, q: item.q, index: item.index }));
    const knownIds = new Set(existing.map(item => item.q.id));
    const loaded = nodeAlternatives[cacheKeyFor(path)]?.items || [];
    return [...existing, ...loaded
      .filter(item => !knownIds.has(item.question.id))
      .map((item, index) => ({ key: `solved:${index}`, q: item.question, variant: item.variant }))];
  };

  const loadForPath = path => {
    if (!onLoadAlternatives || !current) return;
    const key = cacheKeyFor(path);
    if (nodeAlternatives[key] || loadingRef.current.has(key)) return;
    loadingRef.current.add(key);
    setNodeAlternatives(state => ({ ...state, [key]: { loading: true, items: [] } }));
    onLoadAlternatives(path, current).then(items => {
      loadingRef.current.delete(key);
      setNodeAlternatives(state => ({ ...state, [key]: { loading: false, items } }));
    }).catch(error => {
      loadingRef.current.delete(key);
      setNodeAlternatives(state => ({
        ...state, [key]: { loading: false, items: [], error: error?.message || 'Unavailable' },
      }));
    });
  };

  const chooseAlternative = (value, options) => {
    const option = options.find(item => item.key === value);
    if (!option) return;
    if (option.variant) onApplyAlternative?.(option.variant);
    else setVariantIdx(option.index);
  };

  // Re-layout the SVG whenever the active variant changes.
  useEffect(() => {
    if (!active || !current?.tree) { setEls([]); return; }
    const excl = current.toExclude || [];
    const lo = layoutNode(current.tree);
    const PAD = 30, out = [];
    gatherEls(lo, lo.w / 2 + PAD, PAD, out);
    setEls(out);
    setDim({ w: lo.w + PAD * 2, h: lo.h + PAD * 2 + (excl.length > 0 ? 30 : 0) });
  }, [active, current]);

  const currentExcl = current?.toExclude || [];

  const downloadPNG = useCallback(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const clone = svg.cloneNode(true);
    clone.querySelectorAll('[data-ui-only]').forEach(node => node.remove());
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'style');
    s.textContent = "text{font-family:'Space Mono',monospace;}";
    clone.insertBefore(s, clone.firstChild);
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' }));
    const img = new Image();
    img.onload = () => {
      const sc = 2, c = document.createElement('canvas');
      c.width = dim.w * sc;
      c.height = dim.h * sc;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#090914';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.scale(sc, sc);
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      Object.assign(document.createElement('a'), {
        download: 'anagram-tree.png', href: c.toDataURL(),
      }).click();
    };
    img.src = url;
  }, [dim]);

  if (!els.length) return (
    <div style={{
      padding: 32, textAlign: 'center',
      color: 'rgba(200,200,220,0.3)',
      fontFamily: "'Space Mono',monospace", fontSize: 12, letterSpacing: 2,
    }}>BUILDING TREE...</div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', flex: 1, minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexShrink: 0, flexWrap: 'wrap' }}>
        {variants.length > 1 && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 4,
            background: 'rgba(122,223,46,0.08)',
            border: '0.5px solid rgba(122,223,46,0.3)',
            borderRadius: 6, padding: '2px 4px',
          }}>
            <button onClick={() => setVariantIdx((safeIndex - 1 + variants.length) % variants.length)}
              style={{ background: 'none', color: '#7adf2e', padding: '2px 6px', fontSize: 14, lineHeight: 1, fontWeight: 700 }}>◂</button>
            <span style={{
              fontSize: 10, color: '#7adf2e', fontFamily: "'Space Mono',monospace",
              fontWeight: 700, letterSpacing: 1, minWidth: 50, textAlign: 'center',
            }}>TREE {safeIndex + 1}/{variants.length}</span>
            <button onClick={() => setVariantIdx((safeIndex + 1) % variants.length)}
              style={{ background: 'none', color: '#7adf2e', padding: '2px 6px', fontSize: 14, lineHeight: 1, fontWeight: 700 }}>▸</button>
          </div>
        )}
        <button onClick={downloadPNG} style={{
          marginLeft: 'auto',
          background: 'rgba(122,223,46,0.1)', color: '#7adf2e',
          border: '0.5px solid rgba(122,223,46,0.35)', borderRadius: 5,
          padding: '5px 13px', fontSize: 11, fontWeight: 700, letterSpacing: 1,
          fontFamily: "'Space Mono',monospace",
        }}>↓ PNG</button>
      </div>
      <div data-no-swipe style={{
        overflowX: 'auto', overflowY: 'auto', flex: 1, minHeight: 0, width: '100%',
        background: '#090914', border: `0.5px solid ${modeBorder}`, borderRadius: 9,
        overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch',
        scrollBehavior: 'smooth', touchAction: 'pan-x pan-y',
      }}>
        <svg ref={svgRef} width={dim.w} height={dim.h} style={{ display: 'block', minWidth: dim.w }}>
          <defs>
            <marker id="arh" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
              <polygon points="0,0 7,3.5 0,7" fill="rgba(255,255,255,0.18)" />
            </marker>
          </defs>
          {els.map((el, i) => {
            if (el.t === 'ed') return (
              <g key={i}>
                <line x1={el.x1} y1={el.y1} x2={el.x2} y2={el.y2}
                  stroke="rgba(255,255,255,0.16)" strokeWidth={1.5} markerEnd="url(#arh)" />
                <rect x={el.lx - 16} y={el.ly - 9} width={32} height={17} rx={4} fill="#090914" />
                <text x={el.lx} y={el.ly + 5} textAnchor="middle" fontSize={10}
                  fontFamily="'Space Mono',monospace" fontWeight="700" fill="rgba(200,200,220,0.72)">{el.lb}</text>
              </g>
            );
            if (el.t === 'lf') return (
              <g key={i}>
                <rect x={el.cx - el.w / 2} y={el.y} width={el.w} height={el.h} rx={6}
                  fill="#0e0e1c" stroke="rgba(255,255,255,0.14)" strokeWidth={1} />
                {el.sh.map((w, j) => (
                  <text key={j} x={el.cx} y={el.y + TL.wPad + (j + 1) * TL.wH - 3}
                    textAnchor="middle" fontSize={12} fontFamily={fw} fill="#cccce0">{w}</text>
                ))}
              </g>
            );
            if (el.t === 'di') {
              const { cx, y, s, ln } = el; const [a, b] = ln;
              const opts = alternativesFor(el.path);
              return (
                <g key={i}>
                  <polygon points={`${cx},${y} ${cx + s},${y + s} ${cx},${y + s * 2} ${cx - s},${y + s}`}
                    fill="#0e0e1c" stroke="rgba(255,255,255,0.22)" strokeWidth={1.5} />
                  <text x={cx} y={y + s + (b ? -3 : 5)} textAnchor="middle" fontSize={9}
                    fontFamily="'Space Mono',monospace" fill="rgba(220,220,240,0.88)">{a}</text>
                  {b && (
                    <text x={cx} y={y + s + 11} textAnchor="middle" fontSize={9}
                      fontFamily="'Space Mono',monospace" fill="rgba(220,220,240,0.88)">{b}</text>
                  )}
                  <foreignObject data-ui-only="true" x={cx - 46} y={y + s + 15} width={92} height={22}>
                    <select value={`tree:${safeIndex}`} onFocus={() => loadForPath(el.path)}
                      onPointerDown={() => loadForPath(el.path)} onChange={e => chooseAlternative(e.target.value, opts)}
                      style={{ width: '100%', fontSize: 9, background: '#171126', color: '#baff85', border: '1px solid #456b2d', borderRadius: 4 }}>
                      {opts.map(o => <option key={o.key} value={o.key}>{o.q.text}</option>)}
                      {nodeAlternatives[cacheKeyFor(el.path)]?.loading && <option disabled>Finding equal trees...</option>}
                      {nodeAlternatives[cacheKeyFor(el.path)]?.error && <option disabled>{nodeAlternatives[cacheKeyFor(el.path)].error}</option>}
                    </select>
                  </foreignObject>
                </g>
              );
            }
            if (el.t === 'cp') {
              const opts = alternativesFor(el.path);
              return <g key={i}>
                <rect x={el.cx - el.w / 2} y={el.y} width={el.w} height={el.h}
                  rx={Math.min(el.h / 2, 14)}
                  fill="#0e0e1c" stroke="rgba(93,196,144,0.6)" strokeWidth={1.5} />
                <text x={el.cx} y={el.y + el.h / 2 + 5} textAnchor="middle" fontSize={11}
                  fontFamily="'Space Mono',monospace" fontWeight="700" fill="#5dc490">{el.text}</text>
                <foreignObject data-ui-only="true" x={el.cx - 48} y={el.y + 8} width={96} height={22}>
                  <select value={`tree:${safeIndex}`} onFocus={() => loadForPath(el.path)}
                    onPointerDown={() => loadForPath(el.path)} onChange={e => chooseAlternative(e.target.value, opts)}
                    style={{ width: '100%', fontSize: 9, background: '#171126', color: '#baff85', border: '1px solid #456b2d', borderRadius: 4 }}>
                    {opts.map(o => <option key={o.key} value={o.key}>{o.q.text}</option>)}
                    {nodeAlternatives[cacheKeyFor(el.path)]?.loading && <option disabled>Finding equal trees...</option>}
                    {nodeAlternatives[cacheKeyFor(el.path)]?.error && <option disabled>{nodeAlternatives[cacheKeyFor(el.path)].error}</option>}
                  </select>
                </foreignObject>
              </g>;
            }
            return null;
          })}
          {currentExcl.length > 0 && (
            <text x={dim.w / 2} y={dim.h - 10} textAnchor="middle" fontSize={10}
              fontFamily="'Space Mono',monospace" fill="rgba(122,223,46,0.55)">
              {`EXCLUDED: ${currentExcl.join(' · ')}`}
            </text>
          )}
        </svg>
      </div>
    </div>
  );
}
