import { useState, useCallback, useEffect, useRef } from "react";

const HFIN={'ך':'כ','ם':'מ','ן':'נ','ף':'פ','ץ':'צ'};
const nC=c=>HFIN[c]||c;
const nW=w=>w.split('').map(nC).join('');
const hasDupe=w=>{const n=nW(w);return new Set(n).size<n.length};
const entropy=ds=>{const T=ds.reduce((a,b)=>a+b,0);if(!T)return 0;return -ds.filter(n=>n>0).reduce((s,n)=>{const p=n/T;return s+p*Math.log2(p)},0)};
const isHebrew=w=>/[א-ת]/.test(w);
const ALPHA_HE='אבגדהוזחטיכלמנסעפצקרשת'.split('');
const ALPHA_EN='abcdefghijklmnopqrstuvwxyz'.split('');
const ORD=['1st','2nd','3rd','4th','5th','6th','7th','8th'];

function buildQs(words,allowed){
  const a=allowed||{cups:true,length:true,contains:true,position:true,dupe:true};
  const qs=[];
  const heb=words.length>0&&isHebrew(words[0]);
  const alpha=heb?ALPHA_HE:ALPHA_EN;

  if(a.contains)alpha.forEach(l=>qs.push({id:`h${l}`,type:'bin',priority:0,
    text:`Contains "${l.toUpperCase()}"?`,test:w=>nW(w).includes(l)}));

  if(a.length)[2,3,4,5,6,7,8].forEach(n=>qs.push({id:`l${n}`,type:'bin',priority:1,
    text:`Exactly ${n} letters?`,test:w=>w.length===n}));

  if(a.dupe)qs.push({id:'dp',type:'bin',priority:1,
    text:'Any letter appears more than once?',test:hasDupe});

  if(a.position){
    const mx=words.length?Math.min(Math.max(...words.map(w=>w.length)),8):8;
    for(let p=0;p<mx;p++)alpha.forEach(l=>qs.push({id:`p${p}${l}`,type:'bin',priority:2,
      text:`Is the ${ORD[p]||p+1+'th'} letter "${l.toUpperCase()}"?`,
      test:w=>w.length>p&&nC(w[p])===l}));
  }

  if(a.cups)qs.push({id:'cl',type:'cup',priority:1,text:'How many letters?',
    grp:w=>String(w.length),cups:ws=>[...new Set(ws.map(w=>String(w.length)))].sort((a,b)=>+a-+b)});
  return qs;
}

const YES_FLOOR=[0.96,0.82,0.70];
function pickQ(rem,mode,asked,maxNOs,noUsed,allowed){
  const noLeft=maxNOs>0?maxNOs-noUsed:Infinity;
  const budgetGone=maxNOs>0&&noUsed>=maxNOs;
  const floor=maxNOs>0?(YES_FLOOR[maxNOs-noLeft]||0):0;
  const T=rem.length;
  const qs=buildQs(rem,allowed);

  const valid=q=>{
    if(asked.has(q.id))return false;
    if(q.type==='bin'){
      const y=rem.filter(w=>q.test(w)).length;
      if(!y||y===T)return false;
      if(mode!=='5050'&&floor>0&&y/T<floor)return false;
      return true;
    }
    return q.type==='cup'&&(allowed?.cups)&&q.cups(rem).filter(Boolean).length>=2;
  };

  let pool=qs.filter(valid);
  if(!pool.length)pool=qs.filter(q=>{
    if(asked.has(q.id))return false;
    if(q.type==='bin'){const y=rem.filter(w=>q.test(w)).length;return y>0&&y<T;}
    return q.type==='cup'&&(allowed?.cups)&&q.cups(rem).filter(Boolean).length>=2;
  });
  if(!pool.length)return null;

  const scored=pool.map(q=>{
    let score,meta={};
    if(q.type==='bin'){
      const y=rem.filter(w=>q.test(w)).length,n=T-y;meta={yes:y,no:n};
      score=budgetGone?10+y/T:mode==='5050'?entropy([y,n]):y/T+(n===1?.15:n===2?.08:0);
    }else{
      const cs=q.cups(rem).filter(Boolean);
      const dist=cs.map(c=>rem.filter(w=>q.grp(w)===c).length);
      meta={cups:cs,dist};
      score=(mode==='5050'?entropy(dist):Math.max(...dist)/T)+0.5;
    }
    return{...q,score,meta};
  });

  scored.sort((a,b)=>{
    const d=b.score-a.score;
    return Math.abs(d)>1e-9?d:(b.priority||0)-(a.priority||0);
  });
  return scored[0];
}

const MAX_TD=6;
const TL={lW:100,wH:20,wPad:8,cW:140,cH:38,dH:52,hG:32,vG:52,lblH:18};

function abbrevQ(t){
  let m;
  if((m=t.match(/Contains "([^"]+)"\?/i)))return[`has "${m[1]}"?`,''];
  if((m=t.match(/Is the (\w+) letter "([^"]+)"\?/i)))return[`${m[1]} letter`,`= "${m[2]}"?`];
  if((m=t.match(/Exactly (\d+) letters\?/i)))return[`exactly ${m[1]}`,'letters?'];
  if(t.includes('more than once'))return['any letter','appears 2x?'];
  return[t.slice(0,15),t.slice(15,28)||''];
}

function buildTree(words,mode,asked,maxNOs,noUsed,depth,stopAt,allowed){
  if(depth>=MAX_TD||words.length<=stopAt)return{words,q:null,ch:{}};
  if(maxNOs>0&&noUsed>=maxNOs)return{words,q:null,ch:{}};
  const q=pickQ(words,mode,asked,maxNOs,noUsed,allowed);
  if(!q)return{words,q:null,ch:{}};
  const nA=new Set([...asked,q.id]),ch={};
  if(q.type==='bin'){
    const yes=words.filter(w=>q.test(w)),no=words.filter(w=>!q.test(w));
    if(yes.length)ch.YES=buildTree(yes,mode,nA,maxNOs,noUsed,depth+1,stopAt,allowed);
    if(no.length)ch.NO=buildTree(no,mode,nA,maxNOs,noUsed+1,depth+1,stopAt,allowed);
  }else{
    q.cups(words).filter(Boolean).forEach(cup=>{
      const sub=words.filter(w=>q.grp(w)===cup);
      if(sub.length)ch[cup]=buildTree(sub,mode,nA,maxNOs,noUsed,depth+1,stopAt,allowed);
    });
  }
  return{words,q,ch};
}

function countTreeQ(words,mode,maxNOs,stopAt,allowed){
  if(!words.length)return 0;
  let n=0;
  const walk=node=>{if(node.q)n++;Object.values(node.ch).forEach(walk);};
  walk(buildTree(words,mode,new Set(),maxNOs,0,0,stopAt,allowed));
  return n;
}

function findExclusions(words,mode,maxNOs,stopAt,maxExclude,allowed){
  if(!words.length)return null;
  const badCount=ws=>{
    let b=0;
    const walk=node=>{
      if(!node.q||!Object.keys(node.ch).length){if(node.words.length>stopAt)b++;return;}
      Object.values(node.ch).forEach(walk);
    };
    walk(buildTree(ws,mode,new Set(),maxNOs,0,0,stopAt,allowed));
    return b;
  };

  const bad=badCount(words);
  const neededToAdd=Math.max(0,bad-maxExclude);

  if(!maxExclude){
    if(!bad)return null;
    return{toExclude:[],count:0,totalNeeded:bad,neededToAdd,fullyFixed:false,badLeaves:bad};
  }

  const toExclude=[];
  let pool=[...words];
  for(let i=0;i<maxExclude&&pool.length>stopAt;i++){
    let bestWord=null,bestQ=Infinity;
    for(const w of pool){
      const q=countTreeQ(pool.filter(x=>x!==w),mode,maxNOs,stopAt,allowed);
      if(q<bestQ){bestQ=q;bestWord=w;}
    }
    if(!bestWord)break;
    toExclude.push(bestWord);
    pool=pool.filter(w=>w!==bestWord);
  }

  return{toExclude,count:toExclude.length,totalNeeded:bad,neededToAdd,
    fullyFixed:badCount(pool)===0,badLeaves:bad};
}

function layoutNode(node){
  const isLeaf=!node.q||!Object.keys(node.ch).length;
  if(isLeaf){const n=Math.min(node.words.length,5);return{tp:'leaf',w:TL.lW,h:TL.wPad*2+Math.max(1,n)*TL.wH,words:node.words};}
  const isCup=node.q.type==='cup';
  const ks=Object.keys(node.ch);
  const cs=ks.map(k=>layoutNode(node.ch[k]));
  const totCW=cs.reduce((s,l)=>s+l.w,0)+TL.hG*(ks.length-1);
  const qH=isCup?TL.cH:TL.dH*2;
  return{tp:isCup?'cup':'bin',w:Math.max(isCup?TL.cW:TL.dH*2,totCW),
    h:qH+TL.vG+TL.lblH+Math.max(...cs.map(l=>l.h)),text:node.q.text,qH,ks,cs,totCW};
}

function gatherEls(lo,cx,y,out){
  if(lo.tp==='leaf'){out.push({t:'lf',cx,y,w:lo.w,h:lo.h,sh:lo.words.slice(0,5),ex:Math.max(0,lo.words.length-5)});return;}
  lo.tp==='cup'?out.push({t:'cp',cx,y,w:TL.cW,h:TL.cH,text:lo.text}):out.push({t:'di',cx,y,s:TL.dH,ln:abbrevQ(lo.text)});
  const cy2=y+lo.qH+TL.vG;let sx=cx-lo.totCW/2;
  lo.ks.forEach((k,i)=>{
    const cl=lo.cs[i],ccx=sx+cl.w/2;
    out.push({t:'ed',x1:cx,y1:y+lo.qH,x2:ccx,y2:cy2+TL.lblH,lb:k,lx:(cx+ccx)/2,ly:y+lo.qH+(cy2-y-lo.qH)*0.45});
    gatherEls(cl,ccx,cy2+TL.lblH,out);sx+=cl.w+TL.hG;
  });
}

function TreeView({words,mode,maxNOs,stopAt,excluded,modeColor,modeBorder,allowed}){
  const [els,setEls]=useState([]);
  const [dim,setDim]=useState({w:400,h:300});
  const svgRef=useRef(null);
  const heb=words.length>0&&isHebrew(words[0]);
  const fw=heb?"'Noto Sans Hebrew',sans-serif":"'Space Mono',monospace";
  const excl=excluded||[];

  useEffect(()=>{
    if(!words.length)return;
    const tree=buildTree(words,mode,new Set(),maxNOs,0,0,stopAt,allowed);
    const lo=layoutNode(tree);const PAD=30,out=[];
    gatherEls(lo,lo.w/2+PAD,PAD,out);
    setEls(out);
    setDim({w:lo.w+PAD*2,h:lo.h+PAD*2+(excl.length>0?30:0)});
  },[words,mode,maxNOs,stopAt,excl.join(','),JSON.stringify(allowed)]);

  const downloadPNG=useCallback(()=>{
    const svg=svgRef.current;if(!svg)return;
    const clone=svg.cloneNode(true);
    const s=document.createElementNS('http://www.w3.org/2000/svg','style');
    s.textContent="text{font-family:'Space Mono',monospace;}";
    clone.insertBefore(s,clone.firstChild);
    const url=URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)],{type:'image/svg+xml'}));
    const img=new Image();
    img.onload=()=>{
      const sc=2,c=document.createElement('canvas');
      c.width=dim.w*sc;c.height=dim.h*sc;
      const ctx=c.getContext('2d');
      ctx.fillStyle='#090914';ctx.fillRect(0,0,c.width,c.height);
      ctx.scale(sc,sc);ctx.drawImage(img,0,0);
      URL.revokeObjectURL(url);
      Object.assign(document.createElement('a'),{download:'anagram-tree.png',href:c.toDataURL()}).click();
    };
    img.src=url;
  },[dim]);

  if(!els.length)return <div style={{padding:32,textAlign:'center',color:'rgba(200,200,220,0.3)',fontFamily:"'Space Mono',monospace",fontSize:12,letterSpacing:2}}>BUILDING TREE...</div>;

  return(
    <div>
      <div style={{display:'flex',justifyContent:'flex-end',marginBottom:8}}>
        <button onClick={downloadPNG} style={{background:'rgba(122,223,46,0.1)',color:'#7adf2e',border:'0.5px solid rgba(122,223,46,0.35)',borderRadius:5,padding:'5px 13px',fontSize:11,fontWeight:700,letterSpacing:1,fontFamily:"'Space Mono',monospace"}}>↓ PNG</button>
      </div>
      <div style={{overflowX:'auto',overflowY:'auto',maxHeight:'75vh',width:'100%',background:'#090914',border:`0.5px solid ${modeBorder}`,borderRadius:9,overscrollBehavior:'contain',WebkitOverscrollBehavior:'contain'}}>
        <svg ref={svgRef} width={dim.w} height={dim.h} style={{display:'block',minWidth:dim.w,touchAction:'none'}}>
          <defs><marker id="arh" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><polygon points="0,0 7,3.5 0,7" fill="rgba(255,255,255,0.18)"/></marker></defs>
          {els.map((el,i)=>{
            if(el.t==='ed')return(<g key={i}><line x1={el.x1} y1={el.y1} x2={el.x2} y2={el.y2} stroke="rgba(255,255,255,0.16)" strokeWidth={1.5} markerEnd="url(#arh)"/><rect x={el.lx-16} y={el.ly-9} width={32} height={17} rx={4} fill="#090914"/><text x={el.lx} y={el.ly+5} textAnchor="middle" fontSize={10} fontFamily="'Space Mono',monospace" fontWeight="700" fill="rgba(200,200,220,0.72)">{el.lb}</text></g>);
            if(el.t==='lf')return(<g key={i}><rect x={el.cx-el.w/2} y={el.y} width={el.w} height={el.h} rx={6} fill="#0e0e1c" stroke="rgba(255,255,255,0.14)" strokeWidth={1}/>{el.sh.map((w,j)=><text key={j} x={el.cx} y={el.y+TL.wPad+(j+1)*TL.wH-3} textAnchor="middle" fontSize={12} fontFamily={fw} fill="#cccce0">{w}</text>)}{el.ex>0&&<text x={el.cx} y={el.y+TL.wPad+(el.sh.length+1)*TL.wH-3} textAnchor="middle" fontSize={9} fontFamily="'Space Mono',monospace" fill="rgba(200,200,220,0.32)">+{el.ex} more</text>}</g>);
            if(el.t==='di'){const{cx,y,s,ln}=el;const[a,b]=ln;return(<g key={i}><polygon points={`${cx},${y} ${cx+s},${y+s} ${cx},${y+s*2} ${cx-s},${y+s}`} fill="#0e0e1c" stroke="rgba(255,255,255,0.22)" strokeWidth={1.5}/><text x={cx} y={y+s+(b?-3:5)} textAnchor="middle" fontSize={9} fontFamily="'Space Mono',monospace" fill="rgba(220,220,240,0.88)">{a}</text>{b&&<text x={cx} y={y+s+11} textAnchor="middle" fontSize={9} fontFamily="'Space Mono',monospace" fill="rgba(220,220,240,0.88)">{b}</text>}</g>);}
            if(el.t==='cp')return(<g key={i}><rect x={el.cx-el.w/2} y={el.y} width={el.w} height={el.h} rx={el.h/2} fill="#0e0e1c" stroke="rgba(93,196,144,0.6)" strokeWidth={1.5}/><text x={el.cx} y={el.y+el.h/2+5} textAnchor="middle" fontSize={11} fontFamily="'Space Mono',monospace" fontWeight="700" fill="#5dc490">{el.text}</text></g>);
            return null;
          })}
          {excl.length>0&&<text x={dim.w/2} y={dim.h-10} textAnchor="middle" fontSize={10} fontFamily="'Space Mono',monospace" fill="rgba(122,223,46,0.55)">{`EXCLUDED: ${excl.join(' · ')}`}</text>}
        </svg>
      </div>
    </div>
  );
}

const C={
  bg:'#12082a',card:'#1a0f35',border:'rgba(160,120,255,0.15)',
  blue:'#9b6dff',blueDim:'rgba(155,109,255,0.14)',blueBorder:'rgba(155,109,255,0.4)',
  green:'#7adf2e',greenDim:'rgba(122,223,46,0.12)',greenBorder:'rgba(122,223,46,0.38)',
};

function lsGet(k){try{const v=localStorage.getItem(k);return v?JSON.parse(v):null;}catch{return null;}}
function lsSet(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch{}}
function lsDel(k){try{localStorage.removeItem(k);}catch{}}

export default function App(){
  const [mode,setMode]=useState('5050');
  const [allowed,setAllowed]=useState({cups:false,length:true,contains:true,position:true,dupe:true});
  const [maxNOs,setMaxNOs]=useState(0);
  const [stopAt,setStopAt]=useState(2);
  const [maxExclude,setMaxExclude]=useState(0);
  const [exclSugg,setExclSugg]=useState(null);
  const [words,setWords]=useState([]);
  const [phase,setPhase]=useState('idle');
  const [remaining,setRemaining]=useState([]);
  const [asked,setAsked]=useState(new Set());
  const [curQ,setCurQ]=useState(null);
  const [qn,setQn]=useState(0);
  const [noUsed,setNoUsed]=useState(0);
  const [hist,setHist]=useState([]);
  const [guesses,setGuesses]=useState([]);
  const [showList,setShowList]=useState(false);
  const [showSaved,setShowSaved]=useState(false);
  const [savedList,setSavedList]=useState([]);
  const [saveNameInp,setSaveNameInp]=useState('');
  const [editingId,setEditingId]=useState(null);
  const [viewMode,setViewMode]=useState('hunt');
  const [mobilePanel,setMobilePanel]=useState('settings');
  const swipeStart=useRef(null);
  const [showHist,setShowHist]=useState(false);
  const [showDbg,setShowDbg]=useState(false);
  const [showQDrop,setShowQDrop]=useState(false);
  const [inp,setInp]=useState('');
  const [key,setKey]=useState(0);
  const heb=words.length>0&&isHebrew(words[0]);

  const wl=[...new Set(words)];
  const inGame=phase==='q'||phase==='guess';
  const excluded=exclSugg?.toExclude||[];
  const effectiveWl=wl.filter(w=>!excluded.includes(w));

  useEffect(()=>{
    if(!wl.length){setExclSugg(null);return;}
    setExclSugg(findExclusions(wl,mode,maxNOs,stopAt,maxExclude,allowed));
  },[words,mode,maxNOs,stopAt,maxExclude,JSON.stringify(allowed)]);

  useEffect(()=>{
    if(!inGame)return;
    setRemaining(r=>r.filter(w=>!excluded.includes(w)));
  },[excluded.join(',')]);

  useEffect(()=>{
    const raw=lsGet('anagram_index');
    if(raw)setSavedList(raw.map(id=>lsGet(id)).filter(Boolean));
  },[]);

  const startGame=useCallback(()=>{
    const ew=effectiveWl;
    setRemaining(ew);setAsked(new Set());setQn(0);setNoUsed(0);
    setHist([]);setGuesses([]);setKey(k=>k+1);
    setCurQ(pickQ(ew,mode,new Set(),maxNOs,0,allowed));
    setPhase('q');
  },[words,mode,maxNOs,allowed,exclSugg]);

  const goToGuess=useCallback(r=>{setGuesses(r);setPhase('guess');},[]);

  const handleAnswer=useCallback(val=>{
    const newR=curQ.type==='bin'?remaining.filter(w=>curQ.test(w)===val):remaining.filter(w=>curQ.grp(w)===val);
    const newA=new Set([...asked,curQ.id]);
    const newNU=curQ.type==='bin'&&val===false?noUsed+1:noUsed;
    setHist(h=>[...h,{q:curQ.text,ans:curQ.type==='bin'?(val?'YES':'NO'):String(val),before:remaining.length,after:newR.length,isNo:curQ.type==='bin'&&val===false,type:curQ.type}]);
    setRemaining(newR);setAsked(newA);setQn(n=>n+1);setNoUsed(newNU);setKey(k=>k+1);
    if(!newR.length||newR.length<=stopAt||qn+1>=20||(maxNOs>0&&newNU>=maxNOs))goToGuess(newR);
    else setCurQ(pickQ(newR,mode,newA,maxNOs,newNU,allowed));
  },[remaining,asked,curQ,qn,mode,maxNOs,noUsed,goToGuess,stopAt,allowed]);

  const saveAnagram=useCallback(name=>{
    if(!name.trim()||!wl.length)return;
    const base={name:name.trim(),words:wl,mode,maxNOs,stopAt,maxExclude,allowed,savedAt:Date.now()};
    if(editingId){
      const item={...base,id:editingId};lsSet(editingId,item);
      setSavedList(s=>s.map(x=>x.id===editingId?item:x));setEditingId(null);
    }else{
      const id=`ag_${Date.now()}`;const item={...base,id};lsSet(id,item);
      lsSet('anagram_index',[...(lsGet('anagram_index')||[]),id]);
      setSavedList(s=>[...s,item]);
    }
  },[wl,mode,maxNOs,stopAt,maxExclude,allowed,savedList,editingId]);

  const applyAnagram=useCallback((item,edit=false)=>{
    setWords(item.words);setMode(item.mode);setMaxNOs(item.maxNOs);
    if(item.stopAt)setStopAt(item.stopAt);
    if(item.maxExclude!==undefined)setMaxExclude(item.maxExclude);
    const a=item.allowed||item.allowedQTypes;
    if(a)setAllowed(a);
    setPhase('idle');setShowSaved(false);
    if(edit){setEditingId(item.id);setSaveNameInp(item.name);setShowList(true);}
  },[]);

  const deleteAnagram=useCallback(id=>{
    lsDel(id);const rem=savedList.filter(s=>s.id!==id);
    lsSet('anagram_index',rem.map(s=>s.id));setSavedList(rem);
  },[savedList]);

  const addWords=useCallback(raw=>{
    const ws=raw.split(/[,،\n\s]+/).map(w=>w.trim()).filter(Boolean);
    if(ws.length)setWords(c=>[...new Set([...c,...ws])]);
  },[]);

  const conf=remaining.length?Math.max(0,Math.min(100,Math.round(100-(remaining.length/Math.max(wl.length,1))*100+qn*2))):100;
  const modeColor=C.blue,modeBorder=C.blueBorder;

  const T2=viewMode==='tree'?{
    pri:C.green,priDim:C.greenDim,priBorder:C.greenBorder,
    sec:modeColor,secDim:C.blueDim,secBorder:modeBorder,
    bg:'#041204',card:'#081a08',border:'rgba(100,200,80,0.18)',
  }:{
    pri:modeColor,priDim:C.blueDim,priBorder:modeBorder,
    sec:C.green,secDim:C.greenDim,secBorder:C.greenBorder,
    bg:'#0d061c',card:'#150c2a',border:'rgba(160,120,255,0.15)',
  };

  useEffect(()=>{document.body.style.cssText=`background-color:${T2.bg};transition:background-color 0.4s`;},[T2.bg]);

  const Tag=({color,children})=>(
    <span style={{display:'inline-flex',alignItems:'center',fontFamily:"'Space Mono',monospace",fontSize:10,letterSpacing:1.5,fontWeight:700,color,background:color+'18',border:`0.5px solid ${color}44`,borderRadius:10,padding:'2px 8px'}}>{children}</span>
  );
  const SideRow=({label,desc,children,last,badge,labelColor})=>(
    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'9px 14px',borderBottom:last?'none':`0.5px solid ${T2.border}`,gap:8}}>
      <div style={{flex:1,minWidth:0}}>
        <div style={{display:'flex',alignItems:'center',gap:6}}>
          <span style={{fontSize:12,color:labelColor||'#e8e0ff'}}>{label}</span>
          {badge&&<span style={{fontSize:8,color:C.green,fontFamily:"'Space Mono',monospace",background:C.greenDim,border:`0.5px solid ${C.greenBorder}`,borderRadius:8,padding:'1px 5px'}}>{badge}</span>}
        </div>
        {desc&&<div style={{fontSize:9,color:'rgba(200,200,220,0.35)',marginTop:1}}>{desc}</div>}
      </div>
      {children}
    </div>
  );
  const IosToggle=({on,color,onToggle})=>(
    <div onClick={onToggle} style={{cursor:'pointer',width:40,height:22,borderRadius:11,position:'relative',flexShrink:0,background:on?color:'rgba(255,255,255,0.1)',transition:'background 0.2s'}}>
      <div style={{position:'absolute',top:2,left:on?20:2,width:18,height:18,borderRadius:'50%',background:'white',transition:'left 0.2s',boxShadow:'0 1px 3px rgba(0,0,0,0.4)'}}/>
    </div>
  );
  const MiniStepper=({min,max,onChange,display,color})=>(
    <div style={{display:'flex',alignItems:'center',gap:5,flexShrink:0}}>
      <button onClick={()=>onChange(v=>Math.max(min,v-1))} style={{width:24,height:24,borderRadius:5,background:'rgba(255,255,255,0.05)',color:color||'rgba(200,200,220,0.55)',border:`0.5px solid ${color?color+'44':'rgba(255,255,255,0.1)'}`,fontSize:16,display:'flex',alignItems:'center',justifyContent:'center',padding:0}}>−</button>
      <span style={{fontFamily:"'Space Mono',monospace",fontSize:13,fontWeight:700,minWidth:28,textAlign:'center',color:color||'rgba(200,200,220,0.38)'}}>{display}</span>
      <button onClick={()=>onChange(v=>Math.min(max,v+1))} style={{width:24,height:24,borderRadius:5,background:'rgba(255,255,255,0.05)',color:color||'rgba(200,200,220,0.55)',border:`0.5px solid ${color?color+'44':'rgba(255,255,255,0.1)'}`,fontSize:16,display:'flex',alignItems:'center',justifyContent:'center',padding:0}}>+</button>
    </div>
  );

  return(
    <div className="tx" style={{minHeight:'100vh',background:T2.bg,color:'#e8e0ff',fontFamily:"'Space Mono',monospace",display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:'16px 12px',position:'relative',overflow:'hidden'}}>
      <div className="tx" style={{position:'fixed',top:'10%',right:'5%',width:'55vw',height:'55vw',borderRadius:'50%',background:viewMode==='tree'?'radial-gradient(circle,rgba(122,223,46,0.2) 0%,transparent 60%)':'radial-gradient(circle,rgba(155,109,255,0.2) 0%,transparent 60%)',pointerEvents:'none',zIndex:0}}/>
      <div className="tx" style={{position:'fixed',bottom:'10%',left:'5%',width:'50vw',height:'50vw',borderRadius:'50%',background:viewMode==='tree'?'radial-gradient(circle,rgba(155,109,255,0.2) 0%,transparent 60%)':'radial-gradient(circle,rgba(122,223,46,0.2) 0%,transparent 60%)',pointerEvents:'none',zIndex:0}}/>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+Hebrew:wght@400;700&family=Space+Mono:wght@400;700&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        @keyframes up{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
        @keyframes pop{from{opacity:0;transform:scale(0.95)}to{opacity:1;transform:none}}
        .fade{animation:up 0.25s ease forwards}.pop{animation:pop 0.32s cubic-bezier(0.34,1.5,0.64,1) forwards}
        button{cursor:pointer;border:none;font-family:'Space Mono',monospace;transition:all 0.12s}
        button:active{transform:scale(0.96)!important}
        input{outline:none;font-family:'Noto Sans Hebrew','Space Mono',monospace;font-size:13px;color:#e8e0ff}
        input:focus{border-color:rgba(122,223,46,0.4)!important}
        ::-webkit-scrollbar{width:3px}::-webkit-scrollbar-thumb{background:rgba(155,109,255,0.3);border-radius:2px}
        .layout{display:flex;gap:20px;width:100%;max-width:1000px;align-items:flex-start}
        .sidebar{width:260px;flex-shrink:0}.main{flex:1;min-width:0}
        .tx{transition:background 0.4s ease,border-color 0.4s ease,color 0.4s ease}
        @media(max-width:640px){.layout{flex-direction:column;gap:0}.sidebar{width:100%}.mob-hide{display:none!important}}
        @media(min-width:641px){.mob-bar{display:none!important}}
      `}</style>

      <div className="layout" style={{position:'relative',zIndex:1}}
        onTouchStart={e=>{swipeStart.current=e.touches[0].clientX;}}
        onTouchEnd={e=>{
          if(swipeStart.current===null)return;
          const dx=e.changedTouches[0].clientX-swipeStart.current;
          if(Math.abs(dx)>50)setMobilePanel(dx<0?'view':'settings');
          swipeStart.current=null;
        }}>

        {/* SIDEBAR */}
        <div className={`sidebar${mobilePanel!=='settings'?' mob-hide':''}`}>
          <div style={{marginBottom:18,paddingTop:4}}>
            <div className="tx" style={{fontFamily:"'Space Mono',monospace",fontSize:18,fontWeight:700,letterSpacing:5,color:T2.pri}}>DISTILL</div>
            <div className="tx" style={{height:2,width:48,marginTop:5,borderRadius:1,background:T2.sec,opacity:0.7}}/>
          </div>
          <div style={{marginBottom:18}}>
            <div style={{fontSize:9,letterSpacing:3,color:'rgba(200,200,220,0.3)',fontFamily:"'Space Mono',monospace",marginBottom:8}}>VIEW</div>
            <div className="tx" style={{display:'flex',borderRadius:8,overflow:'hidden',border:`0.5px solid ${T2.border}`,background:T2.card}}>
              {[['hunt','HUNT'],['tree','TREE']].map(([v,lbl])=>{
                const col=v==='hunt'?modeColor:C.green;
                return <button key={v} onClick={()=>setViewMode(v)} style={{flex:1,padding:'9px 4px',fontSize:10,fontWeight:700,letterSpacing:1,background:viewMode===v?col+'28':'transparent',color:viewMode===v?col:'rgba(200,200,220,0.35)',borderRight:v==='hunt'?`0.5px solid ${T2.border}`:'none',transition:'all 0.4s'}}>{lbl}</button>;
              })}
            </div>
          </div>
          <div className="tx" style={{background:T2.card,border:`0.5px solid ${T2.border}`,borderRadius:12,overflow:'hidden',marginBottom:14}}>
            <div style={{padding:'10px 14px 6px',fontSize:9,letterSpacing:3,color:'rgba(200,200,220,0.28)',fontFamily:"'Space Mono',monospace"}}>MODE</div>
            <div style={{padding:'0 14px 12px'}}>
              <div className="tx" style={{display:'flex',borderRadius:7,overflow:'hidden',border:`0.5px solid ${T2.border}`,background:'rgba(0,0,0,0.2)'}}>
                {[['5050','50/50'],['sniper','SNIPER']].map(([v,lbl])=>(
                  <button key={v} onClick={()=>setMode(v)} style={{flex:1,padding:'8px 4px',fontSize:10,fontWeight:700,letterSpacing:1,background:mode===v?T2.pri+'28':'transparent',color:mode===v?T2.pri:'rgba(200,200,220,0.3)',borderRight:v==='5050'?`0.5px solid ${T2.border}`:'none',transition:'all 0.4s'}}>{lbl}</button>
                ))}
              </div>
            </div>
            <div className="tx" style={{height:'0.5px',background:T2.border}}/>
            <div style={{padding:'10px 14px 6px',fontSize:9,letterSpacing:3,color:'rgba(200,200,220,0.28)',fontFamily:"'Space Mono',monospace"}}>QUESTIONS</div>
            <div style={{padding:'0 14px 12px'}}>
              <button onClick={()=>setShowQDrop(d=>!d)} className="tx" style={{width:'100%',display:'flex',alignItems:'center',justifyContent:'space-between',padding:'8px 12px',borderRadius:7,background:showQDrop?T2.secDim:'rgba(255,255,255,0.04)',border:`0.5px solid ${showQDrop?T2.secBorder:T2.border}`,color:'rgba(200,200,220,0.7)',transition:'all 0.2s'}}>
                <span style={{fontSize:11,fontFamily:"'Space Mono',monospace",letterSpacing:1}}>{Object.values(allowed).filter(Boolean).length} / {Object.keys(allowed).length} enabled</span>
                <span style={{fontSize:10,display:'inline-block',transform:showQDrop?'rotate(180deg)':'none',transition:'transform 0.2s',color:T2.sec}}>▾</span>
              </button>
              {showQDrop&&(
                <div className="fade" style={{marginTop:6,borderRadius:7,overflow:'hidden',border:`0.5px solid ${T2.border}`,background:'rgba(0,0,0,0.25)'}}>
                  {[['cups','CUPS','"How many letters?"'],['length','Exact length','"Exactly 4 letters?"'],['contains','Contains letter','"Contains E?"'],['position','Letter at position','"Is the 2nd letter T?"'],['dupe','Repeated letter','"Any letter appears twice?"']].map(([k,lbl,ex],i,arr)=>{
                    const on=!!allowed[k];
                    return(
                      <div key={k} onClick={()=>setAllowed(a=>({...a,[k]:!a[k]}))}
                        style={{display:'flex',alignItems:'center',gap:10,padding:'9px 12px',cursor:'pointer',borderBottom:i<arr.length-1?`0.5px solid ${T2.border}`:'none',transition:'background 0.12s',userSelect:'none'}}
                        onMouseEnter={e=>e.currentTarget.style.background='rgba(255,255,255,0.04)'}
                        onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                        <div style={{width:16,height:16,borderRadius:4,flexShrink:0,border:`1.5px solid ${on?T2.sec:T2.border}`,background:on?T2.sec:'transparent',display:'flex',alignItems:'center',justifyContent:'center',transition:'all 0.15s'}}>
                          {on&&<span style={{color:'#081a08',fontSize:10,fontWeight:900,lineHeight:1}}>✓</span>}
                        </div>
                        <div style={{flex:1}}>
                          <div style={{fontSize:12,color:on?'#e8e0ff':'rgba(200,200,220,0.4)',fontFamily:"'Space Mono',monospace",transition:'color 0.15s'}}>{lbl}</div>
                          <div style={{fontSize:9,color:'rgba(200,200,220,0.28)',marginTop:1,fontFamily:"'Space Mono',monospace"}}>{ex}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="tx" style={{height:'0.5px',background:T2.border}}/>
            <div style={{padding:'10px 14px 6px',fontSize:9,letterSpacing:3,color:'rgba(200,200,220,0.28)',fontFamily:"'Space Mono',monospace"}}>ALGORITHM</div>
            <SideRow label="MAX NOs" desc="Stop after X no answers" labelColor={T2.pri}>
              <MiniStepper min={0} max={8} onChange={setMaxNOs} display={maxNOs===0?'∞':String(maxNOs)} color={T2.sec}/>
            </SideRow>
            <SideRow label="STOP AT" desc={`End at ${stopAt} option${stopAt!==1?'s':''}`} labelColor={T2.pri}>
              <MiniStepper min={1} max={8} onChange={setStopAt} display={String(stopAt)} color={T2.sec}/>
            </SideRow>
            <SideRow label="EXCL" desc="Remove words that shorten tree" last labelColor={T2.pri}
              badge={exclSugg?.neededToAdd>0?`+${exclSugg.neededToAdd} needed`:exclSugg?.totalNeeded>0&&maxExclude===0?`${exclSugg.totalNeeded} needed`:null}>
              <MiniStepper min={0} max={10} onChange={setMaxExclude} display={maxExclude===0?'off':String(maxExclude)} color={maxExclude>0?T2.sec:undefined}/>
            </SideRow>
            <div className="tx" style={{height:'0.5px',background:T2.border}}/>
            <div style={{padding:'10px 14px 6px',fontSize:9,letterSpacing:3,color:T2.pri,opacity:0.7,fontFamily:"'Space Mono',monospace"}}>WORDS</div>
            <div style={{padding:'0 14px 12px',display:'flex',flexDirection:'column',gap:6}}>
              <div style={{fontSize:12,color:T2.sec,opacity:0.85}}>{wl.length===0?'No words yet':`${effectiveWl.length}${excluded.length>0?` / ${wl.length}`:''} words`}</div>
              <div style={{display:'flex',gap:6,marginBottom:6}}>
                <button onClick={()=>{setShowList(s=>!s);setShowSaved(false);}} className="tx" style={{flex:1,padding:'7px',fontSize:10,fontWeight:700,letterSpacing:1,borderRadius:6,background:showList?T2.priDim:'rgba(255,255,255,0.05)',color:showList?T2.pri:'rgba(200,200,220,0.45)',border:`0.5px solid ${showList?T2.priBorder:'rgba(255,255,255,0.08)'}`}}>EDIT</button>
                <button onClick={()=>{setShowSaved(s=>!s);setShowList(false);}} className="tx" style={{flex:1,padding:'7px',fontSize:10,fontWeight:700,letterSpacing:1,borderRadius:6,background:showSaved?T2.secDim:'rgba(255,255,255,0.05)',color:showSaved?T2.sec:'rgba(200,200,220,0.45)',border:`0.5px solid ${showSaved?T2.secBorder:'rgba(255,255,255,0.08)'}`}}>SAVED{savedList.length?` (${savedList.length})`:''}</button>
              </div>
              {showList&&(
                <div className="fade" style={{background:'rgba(0,0,0,0.2)',border:`0.5px solid ${T2.border}`,borderRadius:6,padding:'8px 10px',maxHeight:200,overflowY:'auto'}}>
                  {wl.length>0?(
                    <div style={{display:'flex',flexWrap:'wrap',gap:3}}>
                      {wl.slice(0,40).map(w=>(
                        <span key={w} style={{display:'inline-flex',alignItems:'center',gap:2,background:'rgba(255,255,255,0.05)',border:'0.5px solid rgba(255,255,255,0.09)',borderRadius:3,padding:'2px 4px',fontSize:9,fontFamily:heb?"'Noto Sans Hebrew',sans-serif":"'Space Mono',monospace",color:'#b8b8d0',direction:heb?'rtl':'ltr'}}>
                          {w}<button onClick={()=>setWords(c=>c.filter(x=>x!==w))} style={{background:'none',color:'rgba(200,200,220,0.3)',padding:0,fontSize:9,lineHeight:1}}>×</button>
                        </span>
                      ))}
                      {wl.length>40&&<span style={{fontSize:8,color:'rgba(200,200,220,0.25)',padding:'2px 4px'}}>+{wl.length-40}</span>}
                    </div>
                  ):<div style={{fontSize:9,color:'rgba(200,200,220,0.3)'}}>No words added</div>}
                </div>
              )}
              {showSaved&&(
                <div className="fade" style={{background:'rgba(0,0,0,0.2)',border:`0.5px solid ${T2.border}`,borderRadius:6,padding:'8px 10px',maxHeight:280,overflowY:'auto'}}>
                  {savedList.length===0?(
                    <div style={{fontSize:9,color:'rgba(200,200,220,0.3)',textAlign:'center',padding:'8px 0'}}>No saved anagrams</div>
                  ):(
                    <div style={{display:'flex',flexDirection:'column',gap:4}}>
                      {[...savedList].sort((a,b)=>b.savedAt-a.savedAt).map(item=>(
                        <div key={item.id} onClick={()=>applyAnagram(item)} style={{display:'flex',alignItems:'center',gap:4,background:'rgba(255,255,255,0.04)',border:'0.5px solid rgba(255,255,255,0.06)',borderRadius:4,padding:'6px 8px',cursor:'pointer',transition:'background 0.1s'}}
                          onMouseEnter={e=>e.currentTarget.style.background='rgba(255,255,255,0.08)'}
                          onMouseLeave={e=>e.currentTarget.style.background='rgba(255,255,255,0.04)'}>
                          <div style={{flex:1,minWidth:0}}>
                            <div style={{fontFamily:isHebrew(item.words[0]||'')?"'Noto Sans Hebrew',sans-serif":"'Space Mono',monospace",fontSize:10,fontWeight:700,color:'#e2e2f0',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',marginBottom:2}}>{item.name}</div>
                            <div style={{fontSize:8,color:'rgba(200,200,220,0.3)'}}>{item.words.length} words</div>
                          </div>
                          <div style={{display:'flex',gap:2,flexShrink:0}}>
                            <button onClick={e=>{e.stopPropagation();applyAnagram(item,true);}} style={{background:'none',color:'rgba(200,200,220,0.4)',border:'none',fontSize:10,padding:'0 3px',cursor:'pointer'}}>✎</button>
                            <button onClick={e=>{e.stopPropagation();deleteAnagram(item.id);}} style={{background:'none',color:'rgba(224,107,77,0.35)',border:'none',fontSize:12,padding:'0 3px',cursor:'pointer',lineHeight:1}}>×</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* MAIN */}
        <div className={`main${mobilePanel!=='view'?' mob-hide':''}`}>

          {viewMode==='tree'&&(
            <div style={{display:'flex',flexDirection:'column',justifyContent:'center',alignItems:'center',minHeight:'calc(100vh - 120px)',width:'100%'}}>
              {wl.length===0?(
                <div className="tx" style={{background:T2.card,border:`0.5px solid ${T2.border}`,borderRadius:9,padding:'32px 24px',textAlign:'center',width:'90%',maxWidth:300}}>
                  <div style={{fontSize:28,marginBottom:12,opacity:0.25}}>◇</div>
                  <div style={{fontSize:14,color:'rgba(200,200,220,0.4)',lineHeight:1.7}}>Add words via <span style={{color:T2.pri}}>EDIT</span> to begin</div>
                </div>
              ):(
                <>
                  <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:10,flexWrap:'wrap'}}>
                    <Tag color={T2.pri}>TREE</Tag>
                    <Tag color={T2.sec}>{mode==='5050'?'50/50':'SNIPER'}</Tag>
                    {allowed.cups&&<Tag color={T2.sec}>CUPS</Tag>}
                    {maxNOs>0&&<Tag color={T2.sec}>NO×{maxNOs}</Tag>}
                    {excluded.length>0&&<Tag color={T2.sec}>−{excluded.length}</Tag>}
                    <span style={{fontSize:10,color:'rgba(200,200,220,0.25)',marginInlineStart:'auto'}}>{effectiveWl.length} words</span>
                  </div>
                  <TreeView words={effectiveWl} mode={mode} maxNOs={maxNOs} stopAt={stopAt}
                    excluded={excluded} modeColor={modeColor} modeBorder={modeBorder} allowed={allowed}/>
                </>
              )}
            </div>
          )}

          {viewMode==='hunt'&&phase==='idle'&&(
            <div style={{display:'flex',flexDirection:'column',justifyContent:'center',alignItems:'center',minHeight:'calc(100vh - 120px)',width:'100%',textAlign:'center'}}>
              {wl.length===0?(
                <div className="tx" style={{background:T2.card,border:`0.5px solid ${T2.border}`,borderRadius:9,padding:'32px 24px',width:'90%',maxWidth:300}}>
                  <div style={{fontSize:28,marginBottom:12,opacity:0.25}}>◇</div>
                  <div style={{fontSize:14,color:'rgba(200,200,220,0.4)',lineHeight:1.7}}>Add words via <span style={{color:T2.pri}}>EDIT</span> to begin</div>
                </div>
              ):(
                <div className="tx" style={{background:T2.card,border:`0.5px solid ${T2.priBorder}`,borderRadius:9,padding:'28px 24px',width:'90%',maxWidth:400}}>
                  <div style={{display:'flex',gap:8,justifyContent:'center',flexWrap:'wrap',marginBottom:16}}>
                    <Tag color={T2.sec}>{mode==='5050'?'50/50':'SNIPER'}</Tag>
                    {allowed.cups&&<Tag color={T2.sec}>CUPS</Tag>}
                    {maxNOs>0&&<Tag color={T2.sec}>NO ×{maxNOs}</Tag>}
                    <Tag color='rgba(200,200,220,0.35)'>{effectiveWl.length} words</Tag>
                  </div>
                  <div style={{fontSize:13,color:'rgba(200,200,220,0.4)',marginBottom:20,lineHeight:1.6}}>Think of a word from the list.<br/><span style={{color:'rgba(200,200,220,0.6)'}}>Don't say it out loud.</span></div>
                  <button onClick={startGame} style={{background:C.blueDim,color:modeColor,border:`1px solid ${modeBorder}`,borderRadius:7,padding:'12px 28px',fontSize:15,fontWeight:700,letterSpacing:1}}>I HAVE A WORD →</button>
                </div>
              )}
            </div>
          )}

          {viewMode==='hunt'&&phase==='q'&&curQ&&(
            <div key={key} className="fade">
              <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:12,flexWrap:'wrap'}}>
                <Tag color={T2.sec}>{mode==='5050'?'50/50':'SNIPER'}</Tag>
                {allowed.cups&&<Tag color={T2.sec}>CUPS</Tag>}
                {maxNOs>0&&<Tag color={noUsed>=maxNOs?'#e06b4d':T2.sec}>{noUsed>=maxNOs?'⚡ MAX YES MODE':`NO ${noUsed}/${maxNOs}`}</Tag>}
                <div style={{marginInlineStart:'auto',display:'flex',gap:8,alignItems:'center'}}>
                  {excluded.length>0&&<span style={{fontSize:9,color:T2.sec,fontFamily:"'Space Mono',monospace",maxWidth:130,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',opacity:0.8}}>−{excluded.join('·')}</span>}
                  <span style={{fontSize:10,color:'rgba(200,200,220,0.28)'}}>Q{qn+1}</span>
                  <span style={{fontSize:10,color:remaining.length<8?'#e06b4d':T2.sec}}>{remaining.length} left</span>
                  <span style={{fontSize:10,color:conf>70?T2.sec:'rgba(200,200,220,0.28)'}}>{conf}%</span>
                  <button onClick={startGame} style={{background:'rgba(255,255,255,0.04)',color:'rgba(200,200,220,0.35)',border:'0.5px solid rgba(255,255,255,0.09)',borderRadius:4,padding:'3px 9px',fontSize:10,letterSpacing:1}}>↺</button>
                </div>
              </div>
              <div style={{height:2,background:'rgba(255,255,255,0.05)',borderRadius:1,marginBottom:12,overflow:'hidden'}}>
                <div style={{height:'100%',width:`${conf}%`,background:T2.sec,borderRadius:1,transition:'width 0.5s ease'}}/>
              </div>
              <div style={{background:C.card,border:`0.5px solid ${modeBorder}`,borderRadius:8,padding:'18px 20px',marginBottom:12}}>
                {curQ.type==='cup'&&<Tag color={T2.sec}>CUPS</Tag>}
                <div style={{fontFamily:heb?"'Noto Sans Hebrew',sans-serif":"'Space Mono',monospace",fontSize:16,lineHeight:1.7,color:'#eaeaf8',marginTop:curQ.type==='cup'?8:0,direction:heb?'rtl':'ltr'}}>{curQ.text}</div>
                {curQ.type==='bin'&&curQ.meta&&(
                  <div style={{marginTop:6,fontSize:10,color:'rgba(200,200,220,0.25)'}}>YES {curQ.meta.yes} ({Math.round(100*curQ.meta.yes/remaining.length)}%) · NO {curQ.meta.no}</div>
                )}
              </div>
              {curQ.type==='bin'?(
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:12}}>
                  <button onClick={()=>handleAnswer(true)} style={{background:T2.secDim,color:T2.sec,border:`1px solid ${T2.secBorder}`,borderRadius:7,padding:'14px 0',fontSize:19,fontWeight:700,letterSpacing:2}}>✓ YES</button>
                  <button onClick={()=>handleAnswer(false)} style={{background:T2.secDim,color:T2.sec,border:`1px solid ${T2.secBorder}`,borderRadius:7,padding:'14px 0',fontSize:19,fontWeight:700,letterSpacing:2,opacity:0.8}}>✗ NO</button>
                </div>
              ):(
                <div style={{display:'flex',flexWrap:'wrap',gap:7,justifyContent:'center',marginBottom:12}}>
                  {curQ.meta?.cups?.map((cup,ci)=>{
                    const cnt=curQ.meta.dist?.[ci]||0,big=curQ.meta.cups.length<=7;
                    return(
                      <button key={cup} onClick={()=>handleAnswer(cup)} style={{background:T2.secDim,color:T2.sec,border:`0.5px solid ${T2.secBorder}`,borderRadius:6,padding:big?'10px 18px':'7px 12px',fontSize:big?22:16,minWidth:big?54:40,fontWeight:700,fontFamily:heb?"'Noto Sans Hebrew',sans-serif":"'Space Mono',monospace",direction:heb?'rtl':'ltr'}}>
                        <div>{cup}</div><div style={{fontSize:9,color:'rgba(93,196,144,0.4)',marginTop:2}}>{Math.round(100*cnt/Math.max(remaining.length,1))}%</div>
                      </button>
                    );
                  })}
                </div>
              )}
              <div style={{display:'flex',justifyContent:'space-between'}}>
                <button onClick={()=>setShowHist(h=>!h)} style={{background:'none',color:'rgba(200,200,220,0.25)',fontSize:10,letterSpacing:1,padding:'2px 0'}}>▾ HIST ({hist.length})</button>
                <button onClick={()=>setShowDbg(d=>!d)} style={{background:'none',color:'rgba(200,200,220,0.13)',fontSize:10,padding:'2px 0'}}>DBG</button>
              </div>
              {showHist&&hist.length>0&&(
                <div style={{marginTop:6,background:'#090914',border:'0.5px solid rgba(255,255,255,0.06)',borderRadius:6,padding:'8px 10px',maxHeight:170,overflowY:'auto'}}>
                  {[...hist].reverse().map((h,i)=>(
                    <div key={i} style={{display:'grid',gridTemplateColumns:'1fr 44px 52px',gap:6,alignItems:'center',padding:'3px 0',borderBottom:'0.5px solid rgba(255,255,255,0.04)'}}>
                      <div style={{fontSize:11,color:'rgba(200,200,220,0.42)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',fontFamily:heb?"'Noto Sans Hebrew',sans-serif":"'Space Mono',monospace",direction:heb?'rtl':'ltr'}}>{h.q}</div>
                      <div style={{fontSize:11,fontWeight:700,textAlign:'center',color:h.ans==='YES'?C.blue:h.type==='cup'?C.green:'#e06b4d'}}>{h.ans}</div>
                      <div style={{fontSize:10,color:'rgba(200,200,220,0.22)',textAlign:'right'}}>{h.before}→{h.after}</div>
                    </div>
                  ))}
                </div>
              )}
              {showDbg&&(
                <div style={{marginTop:4,background:'#090914',border:'0.5px solid rgba(255,255,255,0.05)',borderRadius:6,padding:'7px 10px'}}>
                  <div style={{fontSize:10,color:'rgba(200,200,220,0.22)',letterSpacing:1,marginBottom:4}}>REMAINING ({remaining.length})</div>
                  <div style={{fontSize:12,color:'rgba(200,200,220,0.5)',lineHeight:1.9,wordBreak:'break-all',fontFamily:heb?"'Noto Sans Hebrew',sans-serif":"'Space Mono',monospace",direction:heb?'rtl':'ltr'}}>{remaining.slice(0,50).join(' · ')}{remaining.length>50?` +${remaining.length-50}`:''}</div>
                </div>
              )}
            </div>
          )}

          {viewMode==='hunt'&&phase==='guess'&&(
            <div key={key} className="fade">
              <div style={{background:C.card,border:`1px solid ${modeBorder}`,borderRadius:9,padding:'24px 20px'}}>
                <div style={{fontSize:10,letterSpacing:3,color:T2.sec,marginBottom:4,textAlign:'center'}}>{guesses.length===0?'NO MATCH FOUND':guesses.length===1?'MY ANSWER':guesses.length===2?'TWO REMAIN':'CANDIDATES'}</div>
                <div style={{fontSize:11,color:'rgba(200,200,220,0.28)',textAlign:'center',marginBottom:18}}>{guesses.length===0?'Word not in list, or an answer was off.':`${qn} questions · tap your word`}</div>
                {guesses.length===0?(
                  <div style={{textAlign:'center'}}><button onClick={startGame} style={{background:T2.secDim,color:T2.sec,border:`1px solid ${T2.secBorder}`,borderRadius:7,padding:'10px 22px',fontSize:13,fontWeight:700}}>Play Again</button></div>
                ):(
                  <div style={{display:'flex',flexDirection:'column',gap:8}}>
                    {guesses.map((w,i)=>(
                      <button key={w} onClick={()=>setPhase('result')} style={{background:i===0?`${T2.sec}18`:'rgba(255,255,255,0.03)',color:i===0?'#f0f0ff':'rgba(240,240,255,0.55)',border:`0.5px solid ${i===0?T2.secBorder:'rgba(255,255,255,0.07)'}`,borderRadius:7,padding:i===0?'18px 16px':'13px 16px',fontFamily:heb?"'Noto Sans Hebrew',sans-serif":"'Space Mono',monospace",fontSize:i===0?34:24,fontWeight:700,letterSpacing:heb?2:4,direction:heb?'rtl':'ltr',textAlign:'center'}}>{w}</button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {viewMode==='hunt'&&phase==='result'&&(
            <div key={key} className="fade" style={{textAlign:'center'}}>
              <div style={{background:C.card,border:`1px solid ${C.greenBorder}`,borderRadius:9,padding:'32px 26px',marginBottom:12}}>
                <div style={{fontSize:38,marginBottom:12}}>◆</div>
                <div style={{fontSize:18,fontWeight:700,letterSpacing:2,marginBottom:8,color:C.green}}>DONE</div>
                <div style={{fontSize:13,color:'rgba(200,200,220,0.45)',lineHeight:1.7,marginBottom:18}}>{`${qn} question${qn!==1?'s':''}${noUsed>0&&maxNOs>0?` · ${noUsed} NO${noUsed>1?'s':''} used`:''} · ${qn<=4?'🔥 Perfect':qn<=8?'Nice':'Got there'}`}</div>
                {hist.length>0&&(
                  <div style={{background:'rgba(0,0,0,0.25)',borderRadius:6,padding:'10px 12px',marginBottom:18,textAlign:'left',maxHeight:150,overflowY:'auto'}}>
                    <div style={{fontSize:9,letterSpacing:2,color:'rgba(200,200,220,0.25)',marginBottom:7}}>LOG</div>
                    {hist.map((h,i)=>(
                      <div key={i} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'3px 0',borderBottom:'0.5px solid rgba(255,255,255,0.04)'}}>
                        <div style={{fontSize:11,color:'rgba(200,200,220,0.4)',flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',marginRight:8,fontFamily:heb?"'Noto Sans Hebrew',sans-serif":"'Space Mono',monospace",direction:heb?'rtl':'ltr'}}>{h.q}</div>
                        <div style={{fontSize:11,fontWeight:700,minWidth:28,color:h.ans==='YES'?C.blue:h.type==='cup'?C.green:'#e06b4d'}}>{h.ans}</div>
                      </div>
                    ))}
                  </div>
                )}
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                  <button onClick={startGame} style={{background:T2.secDim,color:T2.sec,border:`1px solid ${T2.secBorder}`,borderRadius:7,padding:'11px 0',fontSize:13,fontWeight:700,letterSpacing:1}}>AGAIN</button>
                  <button onClick={()=>setPhase('idle')} style={{background:'transparent',color:'rgba(200,200,220,0.35)',border:'0.5px solid rgba(200,200,220,0.12)',borderRadius:7,padding:'11px 0',fontSize:12}}>BACK</button>
                </div>
              </div>
            </div>
          )}

        </div>{/* end .main */}

        <div className="mob-bar" style={{position:'fixed',bottom:0,left:0,right:0,display:'flex',zIndex:100,background:T2.card,borderTop:`0.5px solid ${T2.border}`,padding:'0 0 env(safe-area-inset-bottom,0)'}}>
          {[['settings','SETTINGS'],['view','VIEW']].map(([p,lbl])=>(
            <button key={p} onClick={()=>setMobilePanel(p)} style={{flex:1,padding:'12px 0',fontSize:11,fontWeight:700,letterSpacing:2,background:'transparent',color:mobilePanel===p?T2.pri:'rgba(200,200,220,0.3)',borderTop:`2px solid ${mobilePanel===p?T2.pri:'transparent'}`,transition:'all 0.2s'}}>{lbl}</button>
          ))}
        </div>
      </div>
    </div>
  );
}