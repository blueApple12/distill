import { useState, useCallback, useEffect, useRef } from "react";

/* ── Hebrew normalization ── */
const HFIN={'ך':'כ','ם':'מ','ן':'נ','ף':'פ','ץ':'צ'};
const nC=c=>HFIN[c]||c;
const nW=w=>w.split('').map(nC).join('');
const hasDupe=w=>{const n=nW(w);return new Set(n.split('')).size<n.length};
const entropy=ds=>{const T=ds.reduce((a,b)=>a+b,0);if(!T)return 0;return -ds.filter(n=>n>0).reduce((s,n)=>{const p=n/T;return s+p*Math.log2(p)},0)};
const isHebrew=w=>/[\u05D0-\u05EA]/.test(w);

/* ── questions ── */
function buildQs(words){
  const qs=[];
  const hebrew=words.length>0&&isHebrew(words[0]);
  const alpha=hebrew?'אבגדהוזחטיכלמנסעפצקרשת'.split(''):'abcdefghijklmnopqrstuvwxyz'.split('');

  // "contains letter" — lowest priority within same score
  alpha.forEach(l=>qs.push({id:`has_${l}`,type:'bin',priority:0,
    text:`Contains "${l.toUpperCase()}"?`,
    test:w=>nW(w).includes(l)}));

  // exact length only
  [2,3,4,5,6,7,8].forEach(n=>
    qs.push({id:`leq${n}`,type:'bin',priority:1,text:`Exactly ${n} letters?`,test:w=>w.length===n}));

  qs.push({id:'dupe',type:'bin',priority:1,text:'Any letter appears more than once?',test:hasDupe});

  // letter at position — highest priority when score ties
  const maxLen=words.length?Math.max(...words.map(w=>w.length)):8;
  for(let pos=0;pos<Math.min(maxLen,8);pos++){
    alpha.forEach(l=>{
      const ordinal=['1st','2nd','3rd','4th','5th','6th','7th','8th'][pos]||`${pos+1}th`;
      qs.push({id:`pos_${pos}_${l}`,type:'bin',priority:2,
        text:`Is the ${ordinal} letter "${l.toUpperCase()}"?`,
        test:w=>w.length>pos&&nC(w[pos])===l});
    });
  }

  // CUPS
  qs.push({id:'c_len',type:'cup',priority:1,text:'How many letters?',
    grp:w=>String(w.length),cups:ws=>[...new Set(ws.map(w=>String(w.length)))].sort((a,b)=>+a-+b)});
  return qs;
}

function minYesRatio(noLeft){
  if(noLeft<=0)return 0.96;if(noLeft===1)return 0.82;if(noLeft===2)return 0.70;return 0;
}

function pickQ(remaining,mode,cupsOn,asked,maxNOs,noUsed){
  maxNOs=maxNOs||0;noUsed=noUsed||0;
  const qs=buildQs(remaining);const T=remaining.length;
  const noLeft=maxNOs>0?maxNOs-noUsed:Infinity;
  const budgetGone=maxNOs>0&&noUsed>=maxNOs;
  const floor=maxNOs>0?minYesRatio(noLeft):0;

  const pass=q=>{
    if(asked.has(q.id))return false;
    if(q.type==='bin'){
      const y=remaining.filter(w=>q.test(w)).length;
      if(y===0||y===T)return false;
      // YES floor only applies in sniper mode — 50/50 should still pick balanced questions freely
      if(mode!=='5050'&&floor>0&&y/T<floor)return false;
      return true;
    }
    if(q.type==='cup'&&cupsOn){return q.cups(remaining).filter(c=>c!=null).length>=2;}
    return false;
  };
  let pool=qs.filter(pass);
  if(!pool.length)pool=qs.filter(q=>{if(asked.has(q.id))return false;if(q.type==='bin'){const y=remaining.filter(w=>q.test(w)).length;return y>0&&y<T;}if(q.type==='cup'&&cupsOn){return q.cups(remaining).filter(c=>c!=null).length>=2;}return false;});
  if(!pool.length)return null;

  const scored=pool.map(q=>{
    let score,meta={};
    if(q.type==='bin'){
      const y=remaining.filter(w=>q.test(w)).length;const n=T-y;meta={yes:y,no:n};
      if(budgetGone){
        // budget exhausted: pure YES maximizer (+10 so it always beats normal scores)
        score=10+y/T;
      } else if(mode==='5050'){
        // 50/50: maximize entropy — pick the question that splits most evenly
        score=entropy([y,n]);
      } else {
        // SNIPER: maximize YES ratio — ask the question most words will answer YES to
        // each NO is devastating and reveals a lot; YES keeps the session going smoothly
        score=y/T;
      }
    }else{
      const cs=q.cups(remaining).filter(c=>c!=null);const dist=cs.map(c=>remaining.filter(w=>q.grp(w)===c).length);meta={cups:cs,dist};
      score=mode==='5050'?entropy(dist)+0.5:Math.max(...dist)/T+0.5;
    }
    return{...q,score,meta};
  });

  // sort: primary = score desc, tiebreak = priority desc (position > length/dupe > contains)
  const eps=1e-9;
  scored.sort((a,b)=>{
    const diff=b.score-a.score;
    if(Math.abs(diff)>eps)return diff;
    return (b.priority||0)-(a.priority||0);
  });
  return scored[0];
}

/* ── tree ── */
const MAX_TD=6;
const TL={lW:100,wH:20,wPad:8,cW:140,cH:38,dH:52,hG:32,vG:52,lblH:18};

function abbrevQ(t){
  const c=t.match(/Contains "([^"]+)"\?/i);if(c)return[`has "${c[1]}"?`,''];
  const p=t.match(/Is the (\w+) letter "([^"]+)"\?/i);if(p)return[`${p[1]} letter`,`= "${p[2]}"?`];
  const l=t.match(/Exactly (\d+) letters\?/i);if(l)return[`exactly ${l[1]}`,`letters?`];
  if(t.includes('more than once'))return['any letter','appears 2x?'];
  return[t.slice(0,15),t.slice(15,28)||''];
}

function buildTree(words,mode,cupsOn,asked,maxNOs,noUsed,depth,stopAt){
  stopAt=stopAt||2;
  if(depth>=MAX_TD||words.length<=stopAt)return{words,q:null,ch:{}};
  if(maxNOs>0&&noUsed>=maxNOs)return{words,q:null,ch:{}};
  const q=pickQ(words,mode,cupsOn,asked,maxNOs,noUsed);
  if(!q)return{words,q:null,ch:{}};
  const nA=new Set([...asked,q.id]);const ch={};
  if(q.type==='bin'){
    const yes=words.filter(w=>q.test(w));const no=words.filter(w=>!q.test(w));
    if(yes.length)ch['YES']=buildTree(yes,mode,cupsOn,nA,maxNOs,noUsed,depth+1,stopAt);
    if(no.length)ch['NO']=buildTree(no,mode,cupsOn,nA,maxNOs,noUsed+1,depth+1,stopAt);
  }else{
    q.cups(words).filter(c=>c!=null).forEach(cup=>{
      const sub=words.filter(w=>q.grp(w)===cup);
      if(sub.length)ch[cup]=buildTree(sub,mode,cupsOn,nA,maxNOs,noUsed,depth+1,stopAt);
    });
  }
  return{words,q,ch};
}

function layoutNode(node){
  const isLeaf=!node.q||!Object.keys(node.ch).length;
  if(isLeaf){
    const n=Math.min(node.words.length,5);
    return{tp:'leaf',w:TL.lW,h:TL.wPad*2+Math.max(1,n)*TL.wH,words:node.words};
  }
  const isCup=node.q.type==='cup';
  const ks=Object.keys(node.ch);
  const cs=ks.map(k=>layoutNode(node.ch[k]));
  const totCW=cs.reduce((s,l)=>s+l.w,0)+TL.hG*(ks.length-1);
  const qH=isCup?TL.cH:TL.dH*2;
  const myW=Math.max(isCup?TL.cW:TL.dH*2,totCW);
  return{tp:isCup?'cup':'bin',w:myW,h:qH+TL.vG+TL.lblH+Math.max(...cs.map(l=>l.h)),
    text:node.q.text,qH,ks,cs,totCW};
}

function gatherEls(lo,cx,y,out){
  if(lo.tp==='leaf'){
    const sh=lo.words.slice(0,5);
    out.push({t:'lf',cx,y,w:lo.w,h:lo.h,sh,ex:lo.words.length-sh.length});return;
  }
  if(lo.tp==='cup')out.push({t:'cp',cx,y,w:TL.cW,h:TL.cH,text:lo.text});
  else out.push({t:'di',cx,y,s:TL.dH,ln:abbrevQ(lo.text)});
  const cy2=y+lo.qH+TL.vG;
  let sx=cx-lo.totCW/2;
  lo.ks.forEach((k,i)=>{
    const cl=lo.cs[i];const ccx=sx+cl.w/2;
    out.push({t:'ed',x1:cx,y1:y+lo.qH,x2:ccx,y2:cy2+TL.lblH,lb:k,
      lx:(cx+ccx)/2,ly:y+lo.qH+(cy2-y-lo.qH)*0.45});
    gatherEls(cl,ccx,cy2+TL.lblH,out);
    sx+=cl.w+TL.hG;
  });
}

function TreeView({words,mode,cupsOn,maxNOs,stopAt,excluded,exclusionSugg,modeColor,modeBorder}){
  const [els,setEls]=useState([]);
  const [dim,setDim]=useState({w:400,h:300});
  const [badLeafCount,setBadLeafCount]=useState(0);
  const svgRef=useRef(null);
  const hebrew=words.length>0&&isHebrew(words[0]);
  const fw=hebrew?"'Noto Sans Hebrew',sans-serif":"'Space Mono',monospace";
  const excl=excluded||[];

  useEffect(()=>{
    if(!words.length)return;
    const tree=buildTree(words,mode,cupsOn,new Set(),maxNOs,0,0,stopAt);
    const lo=layoutNode(tree);
    const PAD=30;
    const out=[];
    gatherEls(lo,lo.w/2+PAD,PAD,out);
    setEls(out);
    // count bad leaves (leaves with >stopAt words)
    let bad=0;
    function countBad(node){
      const isLeaf=!node.q||!Object.keys(node.ch).length;
      if(isLeaf){if(node.words.length>stopAt)bad++;return;}
      Object.values(node.ch).forEach(countBad);
    }
    countBad(tree);
    setBadLeafCount(bad);
    // extra height for excluded footer if needed
    const footerH=excl.length>0?30:0;
    setDim({w:lo.w+PAD*2,h:lo.h+PAD*2+footerH});
  },[words,mode,cupsOn,maxNOs,stopAt,excl.join(',')]);

  const downloadPNG=useCallback(()=>{
    const svg=svgRef.current;if(!svg)return;
    // embed fonts by inlining a style tag
    const svgClone=svg.cloneNode(true);
    const style=document.createElementNS('http://www.w3.org/2000/svg','style');
    style.textContent=`text{font-family:'Space Mono',monospace;}`;
    svgClone.insertBefore(style,svgClone.firstChild);
    const svgData=new XMLSerializer().serializeToString(svgClone);
    const blob=new Blob([svgData],{type:'image/svg+xml;charset=utf-8'});
    const url=URL.createObjectURL(blob);
    const img=new Image();
    img.onload=()=>{
      const scale=2;
      const canvas=document.createElement('canvas');
      canvas.width=dim.w*scale;canvas.height=dim.h*scale;
      const ctx=canvas.getContext('2d');
      ctx.fillStyle='#090914';ctx.fillRect(0,0,canvas.width,canvas.height);
      ctx.scale(scale,scale);ctx.drawImage(img,0,0);
      URL.revokeObjectURL(url);
      const a=document.createElement('a');
      a.download='anagram-tree.png';a.href=canvas.toDataURL('image/png');a.click();
    };
    img.src=url;
  },[dim]);

  if(!els.length)return(
    <div style={{padding:32,textAlign:'center',color:'rgba(200,200,220,0.3)',
      fontFamily:"'Space Mono',monospace",fontSize:12,letterSpacing:2}}>
      BUILDING TREE...
    </div>
  );

  return(
    <div>
      <div style={{display:'flex',justifyContent:'flex-end',marginBottom:8}}>
        <button onClick={downloadPNG}
          style={{background:'rgba(122,223,46,0.1)',color:'#7adf2e',border:'0.5px solid rgba(122,223,46,0.35)',
            borderRadius:5,padding:'5px 13px',fontSize:11,fontWeight:700,letterSpacing:1,
            fontFamily:"'Space Mono',monospace",cursor:'pointer'}}>
          ↓ PNG
        </button>
      </div>
    <div style={{overflowX:'auto',overflowY:'auto',maxHeight:'66vh',
      background:'#090914',border:`0.5px solid ${modeBorder}`,borderRadius:9}}>
      <svg ref={svgRef} width={dim.w} height={dim.h} style={{display:'block',minWidth:dim.w}}>
        <defs>
          <marker id="arh" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
            <polygon points="0,0 7,3.5 0,7" fill="rgba(255,255,255,0.18)"/>
          </marker>
        </defs>
        {els.map((el,i)=>{
          if(el.t==='ed')return(
            <g key={i}>
              <line x1={el.x1} y1={el.y1} x2={el.x2} y2={el.y2}
                stroke="rgba(255,255,255,0.16)" strokeWidth={1.5} markerEnd="url(#arh)"/>
              <rect x={el.lx-16} y={el.ly-9} width={32} height={17} rx={4} fill="#090914"/>
              <text x={el.lx} y={el.ly+5} textAnchor="middle" fontSize={10}
                fontFamily="'Space Mono',monospace" fontWeight="700"
                fill="rgba(200,200,220,0.72)">{el.lb}</text>
            </g>
          );
          if(el.t==='lf')return(
            <g key={i}>
              <rect x={el.cx-el.w/2} y={el.y} width={el.w} height={el.h}
                rx={6} fill="#0e0e1c" stroke="rgba(255,255,255,0.14)" strokeWidth={1}/>
              {el.sh.map((w,j)=>(
                <text key={j} x={el.cx} y={el.y+TL.wPad+(j+1)*TL.wH-3}
                  textAnchor="middle" fontSize={12} fontFamily={fw} fill="#cccce0">{w}</text>
              ))}
              {el.ex>0&&(
                <text x={el.cx} y={el.y+TL.wPad+(el.sh.length+1)*TL.wH-3}
                  textAnchor="middle" fontSize={9} fontFamily="'Space Mono',monospace"
                  fill="rgba(200,200,220,0.32)">+{el.ex} more</text>
              )}
            </g>
          );
          if(el.t==='di'){
            const{cx,y,s,ln}=el;
            const pts=`${cx},${y} ${cx+s},${y+s} ${cx},${y+s*2} ${cx-s},${y+s}`;
            const[a,b]=ln;
            return(
              <g key={i}>
                <polygon points={pts} fill="#0e0e1c"
                  stroke="rgba(255,255,255,0.22)" strokeWidth={1.5}/>
                <text x={cx} y={y+s+(b?-3:5)} textAnchor="middle" fontSize={9}
                  fontFamily="'Space Mono',monospace" fill="rgba(220,220,240,0.88)">{a}</text>
                {b&&<text x={cx} y={y+s+11} textAnchor="middle" fontSize={9}
                  fontFamily="'Space Mono',monospace" fill="rgba(220,220,240,0.88)">{b}</text>}
              </g>
            );
          }
          if(el.t==='cp')return(
            <g key={i}>
              <rect x={el.cx-el.w/2} y={el.y} width={el.w} height={el.h}
                rx={el.h/2} fill="#0e0e1c" stroke="rgba(93,196,144,0.6)" strokeWidth={1.5}/>
              <text x={el.cx} y={el.y+el.h/2+5} textAnchor="middle" fontSize={11}
                fontFamily="'Space Mono',monospace" fontWeight="700" fill="#5dc490">
                {el.text}
              </text>
            </g>
          );
          return null;
        })}
        {excl.length>0&&(
          <text x={dim.w/2} y={dim.h-10} textAnchor="middle" fontSize={10}
            fontFamily="'Space Mono',monospace" fill="rgba(122,223,46,0.55)">
            {`EXCLUDED: ${excl.join(' · ')}`}
          </text>
        )}
      </svg>
    </div>
    </div>
  );
}

/* ── exclusion suggester ── */
function findExclusions(words,mode,cupsOn,maxNOs,stopAt,maxExclude){
  if(!words.length||!maxNOs)return null;
  const badLeaves=[];
  function traverse(node){
    const isLeaf=!node.q||!Object.keys(node.ch).length;
    if(isLeaf){if(node.words.length>stopAt)badLeaves.push([...node.words]);return;}
    Object.values(node.ch).forEach(traverse);
  }
  const tree=buildTree(words,mode,cupsOn,new Set(),maxNOs,0,0,stopAt);
  traverse(tree);
  if(!badLeaves.length)return null; // already clean

  // total excess across all bad leaves = minimum exclusions needed to fix
  const totalNeeded=badLeaves.reduce((s,l)=>s+l.length-stopAt,0);
  const neededToAdd=Math.max(0,totalNeeded-maxExclude); // how many more EXCL slots to add

  if(!maxExclude){
    // EXCL is off — just report what's needed, don't pick words
    return{toExclude:[],count:0,totalNeeded,neededToAdd,fullyFixed:false,badLeaves:badLeaves.length};
  }

  // pick words to exclude: from each bad leaf, remove the excess (sorted alphabetically, remove last)
  const toExclude=[];
  for(const leaf of badLeaves){
    const excess=leaf.length-stopAt;
    const sorted=[...leaf].sort();
    for(let i=sorted.length-excess;i<sorted.length;i++){
      if(!toExclude.includes(sorted[i]))toExclude.push(sorted[i]);
      if(toExclude.length>=maxExclude)break;
    }
    if(toExclude.length>=maxExclude)break;
  }
  return{toExclude,count:toExclude.length,totalNeeded,neededToAdd,
    fullyFixed:toExclude.length>=totalNeeded,badLeaves:badLeaves.length};
}

/* ── colours ── */
const C={
  bg:'#12082a',card:'#1a0f35',border:'rgba(160,120,255,0.15)',
  muted:'rgba(210,190,255,0.45)',dim:'rgba(160,120,255,0.12)',
  // purple = 50/50 mode colour
  blue:'#9b6dff',blueDim:'rgba(155,109,255,0.14)',blueBorder:'rgba(155,109,255,0.4)',
  // sniper mode color (match 50/50 as requested)
  red:'#9b6dff',redDim:'rgba(155,109,255,0.14)',redBorder:'rgba(155,109,255,0.4)',
  // green = brand green from logo
  green:'#7adf2e',greenDim:'rgba(122,223,46,0.12)',greenBorder:'rgba(122,223,46,0.38)',
  // gold = saved anagrams accent (reuse green-gold)
  gold:'#7adf2e',goldDim:'rgba(122,223,46,0.1)',goldBorder:'rgba(122,223,46,0.35)',
};

export default function App(){
  const [mode,setMode]=useState('5050');
  const [cupsOn,setCupsOn]=useState(false);
  const [maxNOs,setMaxNOs]=useState(0);
  const [stopAt,setStopAt]=useState(2);
  const [maxExclude,setMaxExclude]=useState(0);
  const [exclusionSugg,setExclusionSugg]=useState(null);
  const [words,setWords]=useState([]);
  const [phase,setPhase]=useState('idle'); // idle|q|ploy|guess|result
  const [remaining,setRemaining]=useState([]);
  const [asked,setAsked]=useState(new Set());
  const [curQ,setCurQ]=useState(null);
  const [qn,setQn]=useState(0);
  const [noUsed,setNoUsed]=useState(0);
  const [hist,setHist]=useState([]);
  const [guesses,setGuesses]=useState([]);
  const [gi,setGi]=useState(0);
  const [won,setWon]=useState(false);
  const [showList,setShowList]=useState(false);
  const [showSettings,setShowSettings]=useState(false);
  const [showSaved,setShowSaved]=useState(false);
  const [savedList,setSavedList]=useState([]); // [{id,name,words,mode,cupsOn,maxNOs,savedAt}]
  const [saveNameInp,setSaveNameInp]=useState('');
  const [editingId,setEditingId]=useState(null); // id of saved anagram being edited
  const [viewMode,setViewMode]=useState('hunt');
  const [showHist,setShowHist]=useState(false);
  const [showDbg,setShowDbg]=useState(false);
  const [inp,setInp]=useState('');
  const [paste,setPaste]=useState('');
  const [showPaste,setShowPaste]=useState(false);
  const [key,setKey]=useState(0);
  const hebrew=words.length>0&&isHebrew(words[0]);

  const startGame=useCallback(()=>{
    const excl=exclusionSugg?.toExclude||[];
    const ew=[...new Set(words)].filter(w=>!excl.includes(w));
    setRemaining(ew);setAsked(new Set());setQn(0);setNoUsed(0);
    setHist([]);setGuesses([]);setGi(0);setWon(false);setKey(k=>k+1);
    const q=pickQ(ew,mode,cupsOn,new Set(),maxNOs,0);
    setCurQ(q);setPhase('q');
  },[words,mode,cupsOn,maxNOs,exclusionSugg]);

  const goToGuess=useCallback((newR)=>{
    // always show ALL remaining as candidates — no sequential guessing
    setGuesses(newR);setGi(0);setPhase('guess');
  },[]);

  const handleAnswer=useCallback((val)=>{
    let newR=curQ.type==='bin'?remaining.filter(w=>curQ.test(w)===val):remaining.filter(w=>curQ.grp(w)===val);
    const newA=new Set([...asked,curQ.id]);const newN=qn+1;
    const isNo=curQ.type==='bin'&&val===false;
    const newNU=isNo?noUsed+1:noUsed;
    const budgetGone=maxNOs>0&&newNU>=maxNOs;
    setHist(h=>[...h,{q:curQ.text,ans:curQ.type==='bin'?(val?'YES':'NO'):String(val),before:remaining.length,after:newR.length,isNo,type:curQ.type}]);
    setRemaining(newR);setAsked(newA);setQn(newN);setNoUsed(newNU);setKey(k=>k+1);
    if(!newR.length||newR.length<=stopAt||newN>=20||budgetGone){goToGuess(newR);}
    else{const nq=pickQ(newR,mode,cupsOn,newA,maxNOs,newNU);setCurQ(nq);}
  },[remaining,asked,curQ,qn,mode,cupsOn,maxNOs,noUsed,goToGuess,stopAt]);

  const handleGuess=useCallback((ok)=>{
    if(ok){setWon(true);setPhase('result');}
    else{const n=gi+1;if(n>=guesses.length){setWon(false);setPhase('result');}else setGi(n);}
  },[gi,guesses]);

  const addWords=useCallback(raw=>{
    const ws=raw.split(/[,،\n\s]+/).map(w=>w.trim()).filter(w=>w.length>=1);
    if(ws.length)setWords(c=>[...new Set([...c,...ws])]);
  },[]);

  const wl=[...new Set(words)];
  const inGame=phase==='q'||phase==='ploy'||phase==='guess';
  const excluded=exclusionSugg?.toExclude||[];
  const effectiveWl=wl.filter(w=>!excluded.includes(w));

  // ── exclusion suggestion ──
  useEffect(()=>{
    if(!maxNOs||!wl.length){setExclusionSugg(null);return;}
    const sugg=findExclusions(wl,mode,cupsOn,maxNOs,stopAt,maxExclude);
    setExclusionSugg(sugg);
  },[words,mode,cupsOn,maxNOs,stopAt,maxExclude]);

  // re-filter remaining live when excluded list changes
  useEffect(()=>{
    if(!inGame)return;
    setRemaining(r=>r.filter(w=>!excluded.includes(w)));
  },[excluded.join(',')]);

  // ── saved anagrams ──
  useEffect(()=>{
    try{
      const raw=localStorage.getItem('anagram_index');
      if(raw){
        const ids=JSON.parse(raw);
        const items=ids.map(id=>{
          try{const d=localStorage.getItem(id);return d?JSON.parse(d):null;}
          catch{return null;}
        });
        setSavedList(items.filter(Boolean));
      }
    }catch{}
  },[]);

  const saveAnagram=useCallback((name)=>{
    if(!name.trim()||!wl.length)return;
    try{
      if(editingId){
        const item={id:editingId,name:name.trim(),words:wl,mode,cupsOn,maxNOs,stopAt,maxExclude,savedAt:Date.now()};
        localStorage.setItem(editingId,JSON.stringify(item));
        setSavedList(s=>s.map(x=>x.id===editingId?item:x));
        setEditingId(null);
      }else{
        const id=`anagram_${Date.now()}`;
        const item={id,name:name.trim(),words:wl,mode,cupsOn,maxNOs,stopAt,maxExclude,savedAt:Date.now()};
        localStorage.setItem(id,JSON.stringify(item));
        const existing=savedList.map(s=>s.id);
        localStorage.setItem('anagram_index',JSON.stringify([...existing,id]));
        setSavedList(s=>[...s,item]);
      }
    }catch(e){console.error(e);}
  },[wl,mode,cupsOn,maxNOs,stopAt,maxExclude,savedList,editingId]);

  const editAnagram=useCallback((item)=>{
    setWords(item.words);setMode(item.mode);
    setCupsOn(item.cupsOn);setMaxNOs(item.maxNOs);
    if(item.stopAt)setStopAt(item.stopAt);
    if(item.maxExclude!==undefined)setMaxExclude(item.maxExclude);
    setEditingId(item.id);setSaveNameInp(item.name);
    setShowSaved(false);setShowList(true);setPhase('idle');
  },[]);

  const loadAnagram=useCallback((item)=>{
    setWords(item.words);setMode(item.mode);
    setCupsOn(item.cupsOn);setMaxNOs(item.maxNOs);
    if(item.stopAt)setStopAt(item.stopAt);
    if(item.maxExclude!==undefined)setMaxExclude(item.maxExclude);
    setPhase('idle');setShowSaved(false);
  },[]);

  const deleteAnagram=useCallback((id)=>{
    try{
      localStorage.removeItem(id);
      const remaining=savedList.filter(s=>s.id!==id);
      localStorage.setItem('anagram_index',JSON.stringify(remaining.map(s=>s.id)));
      setSavedList(remaining);
    }catch(e){console.error(e);}
  },[savedList]);

  const conf=remaining.length?Math.max(0,Math.min(100,Math.round(100-(remaining.length/Math.max(wl.length,1))*100+qn*2))):100;
  const modeColor=mode==='5050'?C.blue:C.red;
  const modeDim=mode==='5050'?C.blueDim:C.redDim;
  const modeBorder=mode==='5050'?C.blueBorder:C.redBorder;

  // full palette swap: HUNT=purple primary / green secondary, TREE=green primary / purple secondary
  const T2=viewMode==='tree'?{
    pri:C.green,priDim:C.greenDim,priBorder:C.greenBorder,
    sec:modeColor,secDim:modeDim,secBorder:modeBorder,
    bg:'#041204',card:'#081a08',border:'rgba(100,200,80,0.18)',
  }:{
    pri:modeColor,priDim:modeDim,priBorder:modeBorder,
    sec:C.green,secDim:C.greenDim,secBorder:C.greenBorder,
    bg:'#0d061c',card:'#150c2a',border:'rgba(160,120,255,0.15)',
  };

  useEffect(()=>{
    document.body.style.backgroundColor=T2.bg;
    document.body.style.transition='background-color 0.4s ease';
  },[T2.bg]);

  /* ── tiny shared components ── */
  const Tog=({on,color,onClick,children})=>(
    <button onClick={onClick} style={{cursor:'pointer',border:`0.5px solid ${on?color+'88':'rgba(255,255,255,0.09)'}`,
      borderRadius:5,padding:'5px 11px',fontFamily:"'Space Mono',monospace",fontSize:11,fontWeight:700,
      letterSpacing:1.5,background:on?color+'1a':'transparent',color:on?color:'rgba(200,200,220,0.32)',
      transition:'all 0.13s',whiteSpace:'nowrap'}}>
      {children}
    </button>
  );

  const Tag=({color,children})=>(
    <span style={{display:'inline-flex',alignItems:'center',gap:4,fontFamily:"'Space Mono',monospace",
      fontSize:10,letterSpacing:1.5,fontWeight:700,color,background:color+'18',
      border:`0.5px solid ${color}44`,borderRadius:10,padding:'2px 8px'}}>
      {children}
    </span>
  );

  /* ── sidebar helpers ── */
  const SideRow=({label,desc,children,last,badge,labelColor})=>(
    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',
      padding:'9px 14px',borderBottom:last?'none':`0.5px solid ${C.border}`,gap:8}}>
      <div style={{flex:1,minWidth:0}}>
        <div style={{display:'flex',alignItems:'center',gap:6}}>
          <span style={{fontSize:12,color:labelColor||'#e8e0ff'}}>{label}</span>
          {badge&&<span style={{fontSize:8,color:C.green,fontFamily:"'Space Mono',monospace",
            background:C.greenDim,border:`0.5px solid ${C.greenBorder}`,borderRadius:8,padding:'1px 5px'}}>
            {badge}
          </span>}
        </div>
        {desc&&<div style={{fontSize:9,color:'rgba(200,200,220,0.35)',marginTop:1}}>{desc}</div>}
      </div>
      {children}
    </div>
  );

  const IosToggle=({on,color,onToggle})=>(
    <div onClick={onToggle} style={{cursor:'pointer',width:40,height:22,borderRadius:11,
      position:'relative',flexShrink:0,
      background:on?color:'rgba(255,255,255,0.1)',transition:'background 0.2s'}}>
      <div style={{position:'absolute',top:2,left:on?20:2,width:18,height:18,
        borderRadius:'50%',background:'white',transition:'left 0.2s',
        boxShadow:'0 1px 3px rgba(0,0,0,0.4)'}}/>
    </div>
  );

  const MiniStepper=({val,min,max,onChange,display,color})=>(
    <div style={{display:'flex',alignItems:'center',gap:5,flexShrink:0}}>
      <button onClick={()=>onChange(v=>Math.max(min,v-1))}
        style={{width:24,height:24,borderRadius:5,background:'rgba(255,255,255,0.05)',
          color:color||'rgba(200,200,220,0.55)',border:`0.5px solid ${color?color+'44':'rgba(255,255,255,0.1)'}`,
          fontSize:16,display:'flex',alignItems:'center',justifyContent:'center',padding:0}}>−</button>
      <span style={{fontFamily:"'Space Mono',monospace",fontSize:13,fontWeight:700,
        minWidth:28,textAlign:'center',color:color||'rgba(200,200,220,0.38)'}}>{display}</span>
      <button onClick={()=>onChange(v=>Math.min(max,v+1))}
        style={{width:24,height:24,borderRadius:5,background:'rgba(255,255,255,0.05)',
          color:color||'rgba(200,200,220,0.55)',border:`0.5px solid ${color?color+'44':'rgba(255,255,255,0.1)'}`,
          fontSize:16,display:'flex',alignItems:'center',justifyContent:'center',padding:0}}>+</button>
    </div>
  );

  return(
    <div className="tx" style={{minHeight:'100vh',background:T2.bg,color:'#e8e0ff',
      fontFamily:"'Space Mono',monospace",display:'flex',flexDirection:'column',
      alignItems:'center',justifyContent:'center',padding:'16px 12px',
      position:'relative',overflow:'hidden'}}>
      {/* dynamic glow */}
      <div className="tx" style={{position:'fixed',top:'-30%',right:'-20%',width:'70vw',height:'70vw',
        borderRadius:'50%',background:viewMode==='tree'
          ?'radial-gradient(circle,rgba(122,223,46,0.22) 0%,transparent 65%)'
          :'radial-gradient(circle,rgba(155,109,255,0.2) 0%,transparent 65%)',
        pointerEvents:'none',zIndex:0}}/>
      <div className="tx" style={{position:'fixed',bottom:'-25%',left:'-15%',width:'65vw',height:'65vw',
        borderRadius:'50%',background:viewMode==='tree'
          ?'radial-gradient(circle,rgba(122,223,46,0.15) 0%,transparent 65%)'
          :'radial-gradient(circle,rgba(122,223,46,0.12) 0%,transparent 65%)',
        pointerEvents:'none',zIndex:0}}/>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+Hebrew:wght@400;700&family=Space+Mono:wght@400;700&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        @keyframes up{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
        @keyframes pop{from{opacity:0;transform:scale(0.95)}to{opacity:1;transform:scale(1)}}
        .fade{animation:up 0.25s ease forwards}
        .pop{animation:pop 0.32s cubic-bezier(0.34,1.5,0.64,1) forwards}
        button{cursor:pointer;border:none;font-family:'Space Mono',monospace;transition:all 0.12s}
        button:active{transform:scale(0.96)!important}
        input,textarea{outline:none;font-family:'Noto Sans Hebrew','Space Mono',monospace;font-size:13px;color:#e8e0ff}
        input:focus,textarea:focus{border-color:rgba(122,223,46,0.4)!important}
        ::-webkit-scrollbar{width:3px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:rgba(155,109,255,0.3);border-radius:2px}
        .layout{display:flex;gap:14px;width:100%;max-width:860px;align-items:flex-start}
        .sidebar{width:200px;flex-shrink:0}
        .main{flex:1;min-width:0}
        .tx{transition:background 0.4s ease,border-color 0.4s ease,color 0.4s ease,box-shadow 0.4s ease}
        @media(max-width:600px){
          .layout{flex-direction:column}
          .sidebar{width:100%}
        }
      `}</style>

      <div className="layout" style={{position:'relative',zIndex:1}}>

        {/* ══ LEFT SIDEBAR ══ */}
        <div className="sidebar">
          {/* Logo */}
          <div style={{marginBottom:18,paddingTop:4}}>
            <div className="tx" style={{fontFamily:"'Space Mono',monospace",fontSize:18,fontWeight:700,
              letterSpacing:5,color:T2.pri}}>DISTILL</div>
            <div className="tx" style={{height:2,width:48,marginTop:5,borderRadius:1,
              background:T2.sec,opacity:0.7}}/>
          </div>

          {/* View toggle */}
          <div style={{marginBottom:18}}>
            <div style={{fontSize:9,letterSpacing:3,color:'rgba(200,200,220,0.3)',
              fontFamily:"'Space Mono',monospace",marginBottom:8}}>VIEW</div>
            <div className="tx" style={{display:'flex',borderRadius:8,overflow:'hidden',
              border:`0.5px solid ${T2.border}`,background:T2.card}}>
              {[['hunt','HUNT'],['tree','TREE']].map(([v,label])=>{
                const col=v==='hunt'?modeColor:C.green;
                return(
                  <button key={v} onClick={()=>setViewMode(v)}
                    style={{flex:1,padding:'9px 4px',fontSize:10,fontWeight:700,letterSpacing:1,
                      background:viewMode===v?col+'28':'transparent',
                      color:viewMode===v?col:'rgba(200,200,220,0.35)',
                      borderRight:v==='hunt'?`0.5px solid ${T2.border}`:'none',
                      transition:'all 0.4s'}}>
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Settings card */}
          <div className="tx" style={{background:T2.card,border:`0.5px solid ${T2.border}`,borderRadius:12,overflow:'hidden',marginBottom:14}}>

            {/* MODE section */}
            <div style={{padding:'10px 14px 6px',fontSize:9,letterSpacing:3,
              color:'rgba(200,200,220,0.28)',fontFamily:"'Space Mono',monospace"}}>MODE</div>
            <div style={{padding:'0 14px 12px'}}>
              <div className="tx" style={{display:'flex',borderRadius:7,overflow:'hidden',
                border:`0.5px solid ${T2.border}`,background:'rgba(0,0,0,0.2)'}}>
                {[['5050','50/50',C.blue],['sniper','SNIPER',C.red]].map(([v,label,col])=>(
                  <button key={v} onClick={()=>setMode(v)}
                    style={{flex:1,padding:'8px 4px',fontSize:10,fontWeight:700,letterSpacing:1,
                      background:mode===v?T2.pri+'28':'transparent',
                      color:mode===v?T2.pri:'rgba(200,200,220,0.3)',
                      borderRight:v==='5050'?`0.5px solid ${T2.border}`:'none',
                      transition:'all 0.4s'}}>
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="tx" style={{height:'0.5px',background:T2.border}}/>

            <div style={{padding:'10px 14px 6px',fontSize:9,letterSpacing:3,
              color:'rgba(200,200,220,0.28)',fontFamily:"'Space Mono',monospace"}}>ALGORITHM</div>

            <SideRow label="CUPS" desc="Multi-choice letter count" labelColor={T2.pri}>
              <IosToggle on={cupsOn} color={T2.sec} onToggle={()=>setCupsOn(c=>!c)}/>
            </SideRow>

            <SideRow label="MAX NOs" desc="Stop after X no answers" labelColor={T2.pri}>
              <MiniStepper val={maxNOs} min={0} max={8} onChange={setMaxNOs}
                display={maxNOs===0?'∞':String(maxNOs)} color={T2.sec}/>
            </SideRow>

            <SideRow label="STOP AT" desc={`End at ${stopAt} option${stopAt!==1?'s':''}`} labelColor={T2.pri}>
              <MiniStepper val={stopAt} min={1} max={8} onChange={setStopAt}
                display={String(stopAt)} color={T2.sec}/>
            </SideRow>

            <SideRow label="EXCL" desc="Auto-exclude to clean endings" last labelColor={T2.pri}
              badge={exclusionSugg?.neededToAdd>0?`+${exclusionSugg.neededToAdd} needed`:
                     exclusionSugg?.totalNeeded>0&&maxExclude===0?`${exclusionSugg.totalNeeded} needed`:null}>
              <MiniStepper val={maxExclude} min={0} max={10} onChange={setMaxExclude}
                display={maxExclude===0?'off':String(maxExclude)} color={T2.sec}/>
            </SideRow>

            <div className="tx" style={{height:'0.5px',background:T2.border}}/>

            <div style={{padding:'10px 14px 6px',fontSize:9,letterSpacing:3,
              color:T2.pri,opacity:0.7,fontFamily:"'Space Mono',monospace"}}>WORDS</div>
            <div style={{padding:'0 14px 12px',display:'flex',flexDirection:'column',gap:6}}>
              <div style={{fontSize:12,color:T2.sec,opacity:0.85}}>
                {wl.length===0?'No words yet':`${effectiveWl.length}${excluded.length>0?` / ${wl.length}`:''} words`}
              </div>
              <div style={{display:'flex',gap:6}}>
                <button onClick={()=>{setShowList(s=>!s);setShowSaved(false);}}
                  className="tx" style={{flex:1,padding:'7px',fontSize:10,fontWeight:700,letterSpacing:1,borderRadius:6,
                    background:showList?T2.priDim:'rgba(255,255,255,0.05)',
                    color:showList?T2.pri:'rgba(200,200,220,0.45)',
                    border:`0.5px solid ${showList?T2.priBorder:'rgba(255,255,255,0.08)'}`,
                  }}>EDIT</button>
                <button onClick={()=>{setShowSaved(s=>!s);setShowList(false);}}
                  className="tx" style={{flex:1,padding:'7px',fontSize:10,fontWeight:700,letterSpacing:1,borderRadius:6,
                    background:showSaved?T2.priDim:'rgba(255,255,255,0.05)',
                    color:showSaved?T2.pri:'rgba(200,200,220,0.45)',
                    border:`0.5px solid ${showSaved?T2.priBorder:'rgba(255,255,255,0.08)'}`,
                  }}>SAVED{savedList.length>0?` (${savedList.length})`:''}</button>
              </div>
            </div>
          </div>
        </div>

        {/* ══ MAIN CONTENT ══ */}
        <div className="main">

        {showList&&(
          <div className="fade" style={{background:T2.card,border:`0.5px solid ${T2.border}`,
            borderRadius:9,padding:'14px 16px',marginBottom:14}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
              <span style={{fontSize:10,letterSpacing:2,color:T2.pri,fontFamily:"'Space Mono',monospace",fontWeight:700}}>WORD LIST</span>
              {wl.length>0&&<span style={{fontSize:10,color:'rgba(200,200,220,0.25)'}}>{wl.length} words</span>}
            </div>
            {/* chips */}
            {wl.length>0&&(
              <div style={{maxHeight:110,overflowY:'auto',padding:'5px 6px',background:'rgba(0,0,0,0.2)',
                borderRadius:6,border:'0.5px solid rgba(255,255,255,0.05)',marginBottom:10,
                display:'flex',flexWrap:'wrap',gap:4}}>
                {wl.slice(0,80).map(w=>(
                  <span key={w} style={{display:'inline-flex',alignItems:'center',gap:3,
                    background:'rgba(255,255,255,0.05)',border:'0.5px solid rgba(255,255,255,0.09)',
                    borderRadius:4,padding:'2px 6px',fontSize:12,
                    fontFamily:hebrew?"'Noto Sans Hebrew',sans-serif":"'Space Mono',monospace",
                    color:'#b8b8d0',direction:hebrew?'rtl':'ltr'}}>
                    {w}
                    <button onClick={()=>setWords(c=>c.filter(x=>x!==w))}
                      style={{background:'none',color:'rgba(200,200,220,0.3)',padding:0,fontSize:11,lineHeight:1}}>×</button>
                  </span>
                ))}
                {wl.length>80&&<span style={{fontSize:10,color:'rgba(200,200,220,0.25)',padding:'3px 4px'}}>+{wl.length-80}</span>}
              </div>
            )}
            {/* input */}
            <div style={{display:'flex',gap:6,marginBottom:6}}>
              <input value={inp} onChange={e=>setInp(e.target.value)} dir={hebrew?'rtl':'ltr'}
                onKeyDown={e=>{if(e.key==='Enter'&&inp.trim()){addWords(inp);setInp('');}}}
                placeholder="Add word(s)..."
                style={{flex:1,background:'rgba(255,255,255,0.04)',border:'0.5px solid rgba(255,255,255,0.12)',
                  borderRadius:5,padding:'7px 10px'}}/>
              <button onClick={()=>{if(inp.trim()){addWords(inp);setInp('');}}}
                style={{background:'rgba(255,255,255,0.06)',color:'#e2e2f0',
                  border:'0.5px solid rgba(255,255,255,0.12)',borderRadius:5,padding:'0 14px',fontSize:13,fontWeight:700}}>+</button>
            </div>
            {wl.length>0&&(
              <div style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap'}}>
                <button onClick={()=>setWords([])}
                  style={{background:'transparent',color:'rgba(224,107,77,0.4)',
                    border:'0.5px solid rgba(224,107,77,0.15)',borderRadius:5,padding:'4px 10px',fontSize:11}}>Clear all</button>
                <div style={{display:'flex',gap:5,marginInlineStart:'auto',alignItems:'center',flexWrap:'wrap'}}>
                  {editingId&&(
                    <button onClick={()=>{setEditingId(null);setSaveNameInp('');}}
                      style={{background:'transparent',color:'rgba(200,200,220,0.3)',border:'0.5px solid rgba(200,200,220,0.12)',
                        borderRadius:5,padding:'4px 8px',fontSize:10}}>✕ cancel edit</button>
                  )}
                  <input value={saveNameInp} onChange={e=>setSaveNameInp(e.target.value)}
                    onKeyDown={e=>{if(e.key==='Enter'&&saveNameInp.trim()){saveAnagram(saveNameInp);setSaveNameInp('');}}}
                    placeholder={editingId?'Edit name...':'Name this anagram...'}
                    style={{background:'rgba(255,255,255,0.04)',
                      border:`0.5px solid ${editingId?T2.priBorder:T2.pri+'44'}`,
                      borderRadius:5,padding:'4px 9px',fontSize:11,color:'#e2e2f0',width:140}}/>
                  <button onClick={()=>{if(saveNameInp.trim()){saveAnagram(saveNameInp);setSaveNameInp('');}}}
                    style={{background:T2.priDim,color:T2.pri,border:`0.5px solid ${T2.priBorder}`,
                      borderRadius:5,padding:'4px 10px',fontSize:11,fontWeight:700}}>
                    {editingId?'★ UPDATE':'★ SAVE'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ══ SAVED PANEL ══ */}
        {showSaved&&(
          <div className="fade" style={{background:T2.card,border:`0.5px solid ${T2.secBorder}`,
            borderRadius:9,padding:'14px 16px',marginBottom:14}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
              <span style={{fontSize:10,letterSpacing:2,color:T2.sec,fontFamily:"'Space Mono',monospace",fontWeight:700}}>★ SAVED ANAGRAMS</span>
              <span style={{fontSize:10,color:'rgba(200,200,220,0.25)'}}>{savedList.length} saved</span>
            </div>
            {savedList.length===0?(
              <div style={{fontSize:12,color:'rgba(200,200,220,0.3)',textAlign:'center',padding:'16px 0',lineHeight:1.7}}>
                No saved anagrams yet.<br/>
                Add words via <span style={{color:T2.pri}}>⚙ LIST</span>, then save.
              </div>
            ):(
              <div style={{display:'flex',flexDirection:'column',gap:6}}>
                {[...savedList].sort((a,b)=>b.savedAt-a.savedAt).map(item=>(
                  <div key={item.id} style={{display:'flex',alignItems:'center',gap:8,
                    background:'rgba(255,255,255,0.03)',border:'0.5px solid rgba(255,255,255,0.07)',
                    borderRadius:7,padding:'9px 12px',cursor:'pointer',transition:'background 0.1s'}}
                    onClick={()=>loadAnagram(item)}
                    onMouseEnter={e=>e.currentTarget.style.background=T2.secDim}
                    onMouseLeave={e=>e.currentTarget.style.background='rgba(255,255,255,0.03)'}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontFamily:isHebrew(item.words[0]||'')?"'Noto Sans Hebrew',sans-serif":"'Space Mono',monospace",
                        fontSize:13,fontWeight:700,color:'#e2e2f0',marginBottom:4,
                        overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                        {item.name}
                      </div>
                      <div style={{display:'flex',gap:5,flexWrap:'wrap'}}>
                        <span style={{fontSize:9,color:'rgba(200,200,220,0.35)',fontFamily:"'Space Mono',monospace"}}>
                          {item.words.length} words
                        </span>
                        <span style={{fontSize:9,color:item.mode==='5050'?C.blue:C.red,fontFamily:"'Space Mono',monospace"}}>
                          {item.mode==='5050'?'⚖ 50/50':'◎ SNIPER'}
                        </span>
                        {item.cupsOn&&<span style={{fontSize:9,color:C.green,fontFamily:"'Space Mono',monospace"}}>☰ CUPS</span>}
                        {item.maxNOs>0&&<span style={{fontSize:9,color:C.red,fontFamily:"'Space Mono',monospace"}}>NO×{item.maxNOs}</span>}
                        {item.stopAt&&<span style={{fontSize:9,color:'rgba(200,200,220,0.3)',fontFamily:"'Space Mono',monospace"}}>STOP:{item.stopAt}</span>}
                        {item.maxExclude>0&&<span style={{fontSize:9,color:'rgba(200,200,220,0.3)',fontFamily:"'Space Mono',monospace"}}>EXCL:{item.maxExclude}</span>}
                        <span style={{fontSize:9,color:'rgba(200,200,220,0.22)',fontFamily:"'Space Mono',monospace",
                          marginInlineStart:'auto'}}>
                          {new Date(item.savedAt).toLocaleDateString()}
                        </span>
                      </div>
                      <div style={{fontSize:10,color:'rgba(200,200,220,0.28)',marginTop:4,
                        fontFamily:isHebrew(item.words[0]||'')?"'Noto Sans Hebrew',sans-serif":"'Space Mono',monospace",
                        direction:isHebrew(item.words[0]||'')?'rtl':'ltr',
                        overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                        {item.words.slice(0,8).join(', ')}{item.words.length>8?'...':''}
                      </div>
                    </div>
                    <div style={{display:'flex',flexDirection:'column',gap:4,flexShrink:0}}>
                      <button onClick={e=>{e.stopPropagation();editAnagram(item);}}
                        style={{background:T2.secDim,color:T2.sec,
                          border:`0.5px solid ${T2.secBorder}`,borderRadius:4,
                          fontSize:10,padding:'3px 7px',fontWeight:700,fontFamily:"'Space Mono',monospace"}}>
                        EDIT
                      </button>
                      <button onClick={e=>{e.stopPropagation();deleteAnagram(item.id);}}
                        style={{background:'transparent',color:'rgba(224,107,77,0.35)',border:'none',
                          fontSize:15,padding:'2px 4px',lineHeight:1}}
                        onMouseEnter={e=>e.currentTarget.style.color='rgba(224,107,77,0.7)'}
                        onMouseLeave={e=>e.currentTarget.style.color='rgba(224,107,77,0.35)'}>×</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ══ TREE VIEW ══ */}
        {viewMode==='tree'&&(
          <div>
            {wl.length===0?(
          <div className="tx" style={{background:T2.card,border:`0.5px solid ${T2.border}`,borderRadius:9,
                padding:'32px 24px',textAlign:'center'}}>
                <div style={{fontSize:28,marginBottom:12,opacity:0.25}}>◇</div>
                <div style={{fontSize:14,color:'rgba(200,200,220,0.4)',lineHeight:1.7}}>
                  Add words via <span style={{color:T2.pri}}>EDIT</span> to begin
                </div>
              </div>
            ):(
              <>
                <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:10,flexWrap:'wrap'}}>
                  <Tag color={T2.pri}>TREE</Tag>
                  <Tag color={T2.sec}>{mode==='5050'?'50/50':'SNIPER'}</Tag>
                  {cupsOn&&<Tag color={T2.sec}>CUPS</Tag>}
                  {maxNOs>0&&<Tag color={T2.sec}>NO×{maxNOs}</Tag>}
                  {excluded.length>0&&<Tag color={T2.sec}>−{excluded.length}</Tag>}
                  <span style={{fontSize:10,color:'rgba(200,200,220,0.25)',marginInlineStart:'auto'}}>
                    {effectiveWl.length} words
                  </span>
                </div>
                <TreeView words={effectiveWl} mode={mode} cupsOn={cupsOn} maxNOs={maxNOs} stopAt={stopAt}
                  excluded={excluded} exclusionSugg={exclusionSugg} modeColor={modeColor} modeBorder={modeBorder}/>
              </>
            )}
          </div>
        )}

        {/* ══ IDLE ══ */}
        {viewMode==='hunt'&&phase==='idle'&&(
          <div style={{textAlign:'center'}}>
            {wl.length===0?(
              <div className="tx" style={{background:T2.card,border:`0.5px solid ${T2.border}`,borderRadius:9,padding:'32px 24px'}}>
                <div style={{fontSize:28,marginBottom:12,opacity:0.25}}>◇</div>
                <div style={{fontSize:14,color:'rgba(200,200,220,0.4)',lineHeight:1.7}}>
                  Add words via <span style={{color:T2.pri}}>EDIT</span> to begin
                </div>
              </div>
            ):(
              <div className="tx" style={{background:T2.card,border:`0.5px solid ${T2.priBorder}`,borderRadius:9,padding:'28px 24px'}}>
                <div style={{display:'flex',gap:8,justifyContent:'center',flexWrap:'wrap',marginBottom:16}}>
                  <Tag color={T2.sec}>{mode==='5050'?'⚖ 50/50':'◎ SNIPER'}</Tag>
                  {cupsOn&&<Tag color={T2.sec}>☰ CUPS</Tag>}
                  {maxNOs>0&&<Tag color={T2.sec}>NO ×{maxNOs}</Tag>}
                  <Tag color='rgba(200,200,220,0.35)'>{wl.length} words</Tag>
                </div>
                <div style={{fontSize:13,color:'rgba(200,200,220,0.4)',marginBottom:20,lineHeight:1.6}}>
                  Think of a word from the list.<br/>
                  <span style={{color:'rgba(200,200,220,0.6)'}}>Don't say it out loud.</span>
                </div>
                <button onClick={startGame}
                  style={{background:modeDim,color:modeColor,border:`1px solid ${modeBorder}`,
                    borderRadius:7,padding:'12px 28px',fontSize:15,fontWeight:700,letterSpacing:1}}>
                  I HAVE A WORD →
                </button>
              </div>
            )}
          </div>
        )}

        {/* ══ QUESTIONING ══ */}
        {viewMode==='hunt'&&phase==='q'&&curQ&&(
          <div key={key} className="fade">
            {/* status strip */}
            <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:12,flexWrap:'wrap'}}>
              <Tag color={T2.sec}>{mode==='5050'?'⚖ 50/50':'◎ SNIPER'}</Tag>
              {cupsOn&&<Tag color={T2.sec}>☰ CUPS</Tag>}
              {maxNOs>0&&(
                <Tag color={noUsed>=maxNOs?C.red:T2.sec}>
                  {noUsed>=maxNOs?'⚡ MAX YES MODE':`NO ${noUsed}/${maxNOs}`}
                </Tag>
              )}
              <div style={{marginInlineStart:'auto',display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
                {excluded.length>0&&(
                  <span style={{fontSize:9,color:T2.sec,fontFamily:"'Space Mono',monospace",
                    letterSpacing:0.5,maxWidth:130,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',
                    opacity:0.8}}>
                    −{excluded.join('·')}
                  </span>
                )}
                <span style={{fontSize:10,color:'rgba(200,200,220,0.28)'}}>Q{qn+1}</span>
                <span style={{fontSize:10,color:remaining.length<8?C.red:T2.sec}}>{remaining.length} left</span>
                <span style={{fontSize:10,color:conf>70?T2.sec:'rgba(200,200,220,0.28)'}}>{conf}%</span>
                <button onClick={startGame}
                  style={{background:'rgba(255,255,255,0.04)',color:'rgba(200,200,220,0.35)',
                    border:'0.5px solid rgba(255,255,255,0.09)',borderRadius:4,
                    padding:'3px 9px',fontSize:10,letterSpacing:1}}>↺</button>
              </div>
            </div>

            {/* confidence bar */}
            <div style={{height:2,background:'rgba(255,255,255,0.05)',borderRadius:1,marginBottom:12,overflow:'hidden'}}>
              <div style={{height:'100%',width:`${conf}%`,background:T2.sec,borderRadius:1,transition:'width 0.5s ease'}}/>
            </div>

            {/* question card */}
            <div style={{background:C.card,border:`0.5px solid ${modeBorder}`,borderRadius:8,
              padding:'18px 20px',marginBottom:12}}>
              {curQ.type==='cup'&&<Tag color={T2.sec} style={{marginBottom:10,display:'inline-flex'}}>☰ CUPS</Tag>}
              <div style={{fontFamily:hebrew?"'Noto Sans Hebrew',sans-serif":"'Space Mono',monospace",
                fontSize:16,lineHeight:1.7,color:'#eaeaf8',marginTop:curQ.type==='cup'?8:0,
                direction:hebrew?'rtl':'ltr'}}>
                {curQ.text}
              </div>
              {curQ.type==='bin'&&curQ.meta&&(
                <div style={{marginTop:6,fontSize:10,color:'rgba(200,200,220,0.25)'}}>
                  YES {curQ.meta.yes} ({Math.round(100*curQ.meta.yes/remaining.length)}%) · NO {curQ.meta.no}
                </div>
              )}
            </div>

            {/* answer buttons */}
            {curQ.type==='bin'?(
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:12}}>
                <button onClick={()=>handleAnswer(true)}
                  style={{background:T2.secDim,color:T2.sec,border:`1px solid ${T2.secBorder}`,
                    borderRadius:7,padding:'14px 0',fontSize:19,fontWeight:700,letterSpacing:2}}>
                  ✓ YES
                </button>
                <button onClick={()=>handleAnswer(false)}
                  style={{background:T2.secDim,color:T2.sec,border:`1px solid ${T2.secBorder}`,
                    borderRadius:7,padding:'14px 0',fontSize:19,fontWeight:700,letterSpacing:2,opacity:0.8}}>
                  ✗ NO
                </button>
              </div>
            ):(
              <div style={{display:'flex',flexWrap:'wrap',gap:7,justifyContent:'center',marginBottom:12}}>
                {curQ.meta?.cups?.map((cup,ci)=>{
                  const cnt=curQ.meta?.dist?.[ci]||0;
                  const pct=Math.round(100*cnt/Math.max(remaining.length,1));
                  const big=curQ.meta.cups.length<=7;
                  return(
                    <button key={cup} onClick={()=>handleAnswer(cup)}
                      style={{background:T2.secDim,color:T2.sec,border:`0.5px solid ${T2.secBorder}`,
                        borderRadius:6,padding:big?'10px 18px':'7px 12px',
                        fontSize:big?22:16,minWidth:big?54:40,fontWeight:700,
                        fontFamily:hebrew?"'Noto Sans Hebrew',sans-serif":"'Space Mono',monospace",
                        direction:hebrew?'rtl':'ltr'}}>
                      <div>{cup}</div>
                      <div style={{fontSize:9,color:'rgba(93,196,144,0.4)',marginTop:2}}>{pct}%</div>
                    </button>
                  );
                })}
              </div>
            )}

            {/* history / debug footer */}
            <div style={{display:'flex',justifyContent:'space-between'}}>
              <button onClick={()=>setShowHist(h=>!h)}
                style={{background:'none',color:'rgba(200,200,220,0.25)',fontSize:10,letterSpacing:1,padding:'2px 0'}}>
                ▾ HIST ({hist.length})
              </button>
              <button onClick={()=>setShowDbg(d=>!d)}
                style={{background:'none',color:'rgba(200,200,220,0.13)',fontSize:10,padding:'2px 0'}}>DBG</button>
            </div>

            {showHist&&hist.length>0&&(
              <div style={{marginTop:6,background:'#090914',border:'0.5px solid rgba(255,255,255,0.06)',
                borderRadius:6,padding:'8px 10px',maxHeight:170,overflowY:'auto'}}>
                {[...hist].reverse().map((h,i)=>(
                  <div key={i} style={{display:'grid',gridTemplateColumns:'1fr 44px 52px',gap:6,
                    alignItems:'center',padding:'3px 0',borderBottom:'0.5px solid rgba(255,255,255,0.04)'}}>
                    <div style={{fontSize:11,color:'rgba(200,200,220,0.42)',overflow:'hidden',
                      textOverflow:'ellipsis',whiteSpace:'nowrap',
                      fontFamily:hebrew?"'Noto Sans Hebrew',sans-serif":"'Space Mono',monospace",
                      direction:hebrew?'rtl':'ltr'}}>{h.q}</div>
                    <div style={{fontSize:11,fontWeight:700,textAlign:'center',
                      color:h.ans==='YES'?C.blue:h.type==='cup'?C.green:C.red}}>{h.ans}</div>
                    <div style={{fontSize:10,color:'rgba(200,200,220,0.22)',textAlign:'right'}}>{h.before}→{h.after}</div>
                  </div>
                ))}
              </div>
            )}
            {showDbg&&(
              <div style={{marginTop:4,background:'#090914',border:'0.5px solid rgba(255,255,255,0.05)',borderRadius:6,padding:'7px 10px'}}>
                <div style={{fontSize:10,color:'rgba(200,200,220,0.22)',letterSpacing:1,marginBottom:4}}>REMAINING ({remaining.length})</div>
                <div style={{fontSize:12,color:'rgba(200,200,220,0.5)',lineHeight:1.9,wordBreak:'break-all',
                  fontFamily:hebrew?"'Noto Sans Hebrew',sans-serif":"'Space Mono',monospace",direction:hebrew?'rtl':'ltr'}}>
                  {remaining.slice(0,50).join(' · ')}{remaining.length>50?` +${remaining.length-50}`:''}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ══ CANDIDATES ══ */}
        {viewMode==='hunt'&&phase==='guess'&&(
          <div key={key} className="fade">
            <div style={{background:C.card,border:`1px solid ${modeBorder}`,borderRadius:9,padding:'24px 20px'}}>
              <div style={{fontSize:10,letterSpacing:3,color:T2.sec,marginBottom:4,textAlign:'center'}}>
                {guesses.length===0?'NO MATCH FOUND':guesses.length===1?'MY ANSWER':guesses.length===2?'TWO REMAIN':'CANDIDATES'}
              </div>
              <div style={{fontSize:11,color:'rgba(200,200,220,0.28)',textAlign:'center',marginBottom:18}}>
                {guesses.length===0
                  ?'Word not in list, or an answer was off.'
                  :`${qn} questions · tap your word`}
              </div>

              {guesses.length===0?(
                <div style={{textAlign:'center'}}>
                  <button onClick={startGame}
                    style={{background:T2.secDim,color:T2.sec,border:`1px solid ${T2.secBorder}`,
                      borderRadius:7,padding:'10px 22px',fontSize:13,fontWeight:700}}>Play Again</button>
                </div>
              ):(
                <div style={{display:'flex',flexDirection:'column',gap:8}}>
                  {guesses.map((w,i)=>(
                    <button key={w} onClick={()=>{setWon(true);setPhase('result');}}
                      style={{
                        background:i===0?`${T2.sec}18`:'rgba(255,255,255,0.03)',
                        color:i===0?'#f0f0ff':'rgba(240,240,255,0.55)',
                        border:`0.5px solid ${i===0?T2.secBorder:'rgba(255,255,255,0.07)'}`,
                        borderRadius:7,padding:i===0?'18px 16px':'13px 16px',
                        fontFamily:hebrew?"'Noto Sans Hebrew',sans-serif":"'Space Mono',monospace",
                        fontSize:i===0?34:24,fontWeight:700,
                        letterSpacing:hebrew?2:4,
                        direction:hebrew?'rtl':'ltr',
                        textAlign:'center',
                        transition:'background 0.1s',
                      }}>
                      {w}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ══ RESULT ══ */}
        {viewMode==='hunt'&&phase==='result'&&(
          <div key={key} className="fade" style={{textAlign:'center'}}>
            <div style={{background:C.card,border:`1px solid ${won?C.greenBorder:C.redBorder}`,
              borderRadius:9,padding:'32px 26px',marginBottom:12}}>
              <div style={{fontSize:38,marginBottom:12}}>{won?'◆':'◇'}</div>
              <div style={{fontSize:18,fontWeight:700,letterSpacing:2,marginBottom:8,color:won?C.green:C.red}}>
                {won?'GOT IT!':'YOU WIN'}
              </div>
              <div style={{fontSize:13,color:'rgba(200,200,220,0.45)',lineHeight:1.7,marginBottom:won?18:22}}>
                {won
                  ?`Identified in ${qn} question${qn!==1?'s':''}${noUsed>0&&maxNOs>0?` · ${noUsed} NO${noUsed>1?'s':''} used`:''}. ${qn<=4?'🔥 Perfect':qn<=8?'Nice':'Got there'}`
                  :'Word not found — either not in list or an answer was off.'}
              </div>
              {won&&hist.length>0&&(
                <div style={{background:'rgba(0,0,0,0.25)',borderRadius:6,padding:'10px 12px',marginBottom:18,
                  textAlign:'left',maxHeight:150,overflowY:'auto'}}>
                  <div style={{fontSize:9,letterSpacing:2,color:'rgba(200,200,220,0.25)',marginBottom:7}}>LOG</div>
                  {hist.map((h,i)=>(
                    <div key={i} style={{display:'flex',justifyContent:'space-between',alignItems:'center',
                      padding:'3px 0',borderBottom:'0.5px solid rgba(255,255,255,0.04)'}}>
                      <div style={{fontSize:11,color:'rgba(200,200,220,0.4)',flex:1,overflow:'hidden',
                        textOverflow:'ellipsis',whiteSpace:'nowrap',marginRight:8,
                        fontFamily:hebrew?"'Noto Sans Hebrew',sans-serif":"'Space Mono',monospace",
                        direction:hebrew?'rtl':'ltr'}}>{h.q}</div>
                      <div style={{fontSize:11,fontWeight:700,minWidth:28,
                        color:h.ans==='YES'?C.blue:h.type==='cup'?C.green:C.red}}>{h.ans}</div>
                    </div>
                  ))}
                </div>
              )}
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                <button onClick={startGame}
                  style={{background:T2.secDim,color:T2.sec,border:`1px solid ${T2.secBorder}`,
                    borderRadius:7,padding:'11px 0',fontSize:13,fontWeight:700,letterSpacing:1}}>AGAIN</button>
                <button onClick={()=>setPhase('idle')}
                  style={{background:'transparent',color:'rgba(200,200,220,0.35)',
                    border:'0.5px solid rgba(200,200,220,0.12)',borderRadius:7,padding:'11px 0',fontSize:12}}>BACK</button>
              </div>
            </div>
          </div>
        )}

      </div>{/* end .main */}
      </div>{/* end .layout */}
    </div>
  );
}
