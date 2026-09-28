// Visual prototype only: all names, scores and events below are fictional.
const roundRows = [
  {name:'Maya Chen',initials:'MC',tone:'maya',played:6,points:12,diff:6,wins:6},
  {name:'Leon Park',initials:'LP',tone:'leon',played:6,points:11,diff:4,wins:5},
  {name:'Jules Rivera',initials:'JR',tone:'jules',played:6,points:11,diff:0,wins:3,award:true},
  {name:'Sam Wilson',initials:'SW',tone:'sam',played:6,points:10,diff:2,wins:4},
  {name:'Priya Desai',initials:'PD',tone:'priya',played:5,points:8,diff:1,wins:2},
  {name:'Owen Brooks',initials:'OB',tone:'owen',played:5,points:7,diff:-1,wins:1},
  {name:'Ella Thompson',initials:'ET',tone:'ella',played:5,points:5,diff:-5,wins:1},
  {name:'Noah Kim',initials:'NK',tone:'noah',played:5,points:4,diff:-7,wins:0}
];
// Fictional six-round totals; Jules's two awarded points are table-only.
const seasonRows = [
  {name:'Maya Chen',initials:'MC',tone:'maya',played:36,points:67,diff:26,wins:28},
  {name:'Leon Park',initials:'LP',tone:'leon',played:36,points:62,diff:16,wins:25},
  {name:'Jules Rivera',initials:'JR',tone:'jules',played:35,points:60,diff:11,wins:22,award:true},
  {name:'Sam Wilson',initials:'SW',tone:'sam',played:35,points:55,diff:5,wins:20},
  {name:'Priya Desai',initials:'PD',tone:'priya',played:34,points:52,diff:2,wins:17},
  {name:'Owen Brooks',initials:'OB',tone:'owen',played:34,points:47,diff:-8,wins:12},
  {name:'Ella Thompson',initials:'ET',tone:'ella',played:33,points:40,diff:-19,wins:9},
  {name:'Noah Kim',initials:'NK',tone:'noah',played:33,points:33,diff:-33,wins:5}
];
const rankColors=['black','pink','blue','brown','green','yellow','red','neutral'];
const resultHistory={
  6:[
    ['2026-09-26','Maya Chen','Leon Park','2–1'],['2026-09-25','Maya Chen','Jules Rivera','2–1'],
    ['2026-09-24','Maya Chen','Sam Wilson','2–1'],['2026-09-23','Maya Chen','Owen Brooks','2–1'],
    ['2026-09-22','Maya Chen','Ella Thompson','2–1'],['2026-09-21','Maya Chen','Noah Kim','2–1'],
    ['2026-09-20','Leon Park','Jules Rivera','2–1'],['2026-09-19','Leon Park','Sam Wilson','2–1'],
    ['2026-09-18','Leon Park','Priya Desai','2–1'],['2026-09-17','Leon Park','Ella Thompson','2–1'],
    ['2026-09-16','Leon Park','Noah Kim','2–1'],['2026-09-15','Sam Wilson','Jules Rivera','2–1'],
    ['2026-09-14','Jules Rivera','Priya Desai','2–1'],['2026-09-13','Jules Rivera','Owen Brooks','2–1'],
    ['2026-09-12','Jules Rivera','Noah Kim','2–1'],['2026-09-11','Sam Wilson','Priya Desai','2–1'],
    ['2026-09-10','Sam Wilson','Owen Brooks','2–1'],['2026-09-09','Sam Wilson','Ella Thompson','2–1'],
    ['2026-09-08','Priya Desai','Ella Thompson','3–0'],['2026-09-07','Priya Desai','Noah Kim','2–1'],
    ['2026-09-06','Ella Thompson','Owen Brooks','2–1'],['2026-09-05','Owen Brooks','Noah Kim','3–0']
  ],
  5:[
    ['2026-08-30','Leon Park','Owen Brooks','2–1'],['2026-08-28','Maya Chen','Jules Rivera','2–1'],
    ['2026-08-26','Priya Desai','Ella Thompson','3–0'],['2026-08-24','Noah Kim','Sam Wilson','2–1'],
    ['2026-08-22','Owen Brooks','Leon Park','2–1']
  ]
};
const roster={
  'Maya Chen':{initials:'MC',tone:'maya'},'Leon Park':{initials:'LP',tone:'leon'},
  'Jules Rivera':{initials:'JR',tone:'jules'},'Sam Wilson':{initials:'SW',tone:'sam'},
  'Priya Desai':{initials:'PD',tone:'priya'},'Owen Brooks':{initials:'OB',tone:'owen'},
  'Ella Thompson':{initials:'ET',tone:'ella'},'Noah Kim':{initials:'NK',tone:'noah'}
};
let scope='round';
let toastTimer;
let matchA='Maya Chen';
let matchB='Priya Desai';
let submittedResult=null;
function showToast(message){
  const toast=document.querySelector('#prototype-toast');
  toast.textContent=message;toast.classList.add('show');window.clearTimeout(toastTimer);
  toastTimer=window.setTimeout(()=>toast.classList.remove('show'),2300);
}
function positionRows(rows){
  let lastKey='';let lastPosition=0;
  return rows.map((row,index)=>{
    const key=`${row.points}|${row.diff}|${row.wins}`;
    const position=key===lastKey?lastPosition:index+1;lastKey=key;lastPosition=position;
    return {...row,position,ball:rankColors[Math.min(position-1,rankColors.length-1)]};
  });
}
function renderTable(nextScope){
  scope=nextScope;const isSeason=scope==='season';const rows=positionRows(isSeason?seasonRows:roundRows);
  document.querySelector('#standings-body').innerHTML=rows.map(row=>{
    const diffClass=row.diff>0?' positive':row.diff<0?' negative':'';
    const diffText=row.diff>0?`+${row.diff}`:row.diff<0?`−${Math.abs(row.diff)}`:'0';
    const star=row.award?'<span class="award-star" aria-label="Includes administrative award">*</span>':'';
    return `<tr><td class="rank">${String(row.position).padStart(2,'0')}</td><td><div class="player-cell"><span class="avatar avatar-${row.tone}" aria-hidden="true"><span>${row.initials}</span></span><span class="player-name">${row.name}</span></div></td><td class="played">${row.played}</td><td class="pts-cell"><span class="points-ball ball-${row.ball}" aria-label="${row.points} table points${row.award?', includes an administrative award':''}"><span>${row.points}${star}</span></span></td><td class="diff-cell${diffClass}">${diffText}</td><td class="wins-cell">${row.wins}</td></tr>`;
  }).join('');
  document.querySelectorAll('.content-tab').forEach(tab=>{const active=tab.dataset.scope===scope;tab.classList.toggle('selected',active);tab.setAttribute('aria-selected',String(active));});
  document.querySelector('#standings-heading').textContent=isSeason?'Season standings':'Round 6 standings';
  document.querySelector('.table-state').innerHTML=isSeason?'<span class="table-state-dot"></span> Season to date':'<span class="table-state-dot"></span> Live table';
  document.querySelector('.live-indicator').innerHTML=isSeason?'<i></i> SEASON TOTAL':'<i></i> IN PLAY';
  document.querySelector('.progress-copy').innerHTML=isSeason?'<strong>138</strong> of 168 results confirmed':'<strong>22</strong> of 28 results confirmed';
  document.querySelector('.progress-meter i').style.width=isSeason?'82.14%':'78.57%';
}
document.querySelectorAll('.content-tab').forEach(tab=>tab.addEventListener('click',()=>renderTable(tab.dataset.scope)));
let activeResultsRound=6;
function renderResults(round){
  activeResultsRound=round;
  const rows=resultHistory[round]||[];
  const older=round===5;
  document.querySelector('#results-round-label').innerHTML=older?'Round 5 <i>CLOSED</i>':'Round 6 <i>CURRENT</i>';
  document.querySelector('#results-list-title').textContent=`Round ${round} results`;
  document.querySelector('#results-list-caption').textContent=older?'A few results from the previous round':`${rows.length} confirmed results · newest first`;
  document.querySelector('#results-tab span').textContent=String(rows.length);
  document.querySelector('#results-prev').disabled=older;
  document.querySelector('#results-next').disabled=!older;
  document.querySelector('.results-live-pill').innerHTML=older?'<i></i> CLOSED':'<i></i> IN PLAY';
  document.querySelector('.results-live-pill').classList.toggle('closed',older);
  document.querySelector('#results-footnote').textContent=older?'Round 5 shows a small fictional sample. Round 6 lists all 22 fictional confirmed results.':'Dates shown are actual dates played. Only confirmed league results appear here.';
  document.querySelector('#round-results-list').innerHTML=rows.map(([date,a,b,score])=>{
    const [ay,am,ad]=date.split('-');const left=roster[a],right=roster[b];
    return `<article class="round-result" aria-label="${ad}.${am}.${ay}: ${a} ${score} ${b}"><time class="result-date" datetime="${date}">${ad}.${am}.${ay}</time><div class="result-player"><span class="result-avatar avatar-${left.tone}">${left.initials}</span><span class="result-player-name">${a}</span></div><span class="result-score" aria-label="${score} frames">${score}</span><div class="result-player right"><span class="result-player-name">${b}</span><span class="result-avatar avatar-${right.tone}">${right.initials}</span></div></article>`;
  }).join('');
}
document.querySelectorAll('[data-fixture-tab]').forEach(tab=>tab.addEventListener('click',()=>{
  const showResults=tab.dataset.fixtureTab==='results-pane';
  document.querySelectorAll('[data-fixture-tab]').forEach(button=>{const active=button===tab;button.classList.toggle('selected',active);button.setAttribute('aria-selected',String(active));});
  const fixturePane=document.querySelector('#fixtures-pane'),resultsPane=document.querySelector('#results-pane');
  fixturePane.hidden=showResults;fixturePane.classList.toggle('hidden',showResults);
  resultsPane.hidden=!showResults;resultsPane.classList.toggle('hidden',!showResults);
  if(showResults)renderResults(activeResultsRound);
}));
document.querySelector('#results-prev').addEventListener('click',()=>renderResults(Math.max(5,activeResultsRound-1)));
document.querySelector('#results-next').addEventListener('click',()=>renderResults(Math.min(6,activeResultsRound+1)));
document.querySelector('#award-info').addEventListener('click',()=>showToast('Award points do not add frames, frame difference, or a match win.'));
document.querySelector('#sort-hint').addEventListener('click',()=>showToast('Tied players share a position; ties break by points, frame difference, then wins.'));
document.querySelector('#profile-button').addEventListener('click',()=>showToast('Maya Chen · fictional preview profile'));
document.querySelector('.top-season').addEventListener('click',()=>showToast('Viewing the 2026 season'));

function showScreen(id,navDestination){
  const dashboard=document.querySelector('#dashboard-screen');
  dashboard.hidden=id!=='dashboard-screen';
  dashboard.classList.toggle('hidden',dashboard.hidden);
  document.querySelectorAll('.flow-screen').forEach(screen=>{
    screen.hidden=screen.id!==id;
    screen.classList.toggle('hidden',screen.hidden);
  });
  const nav=navDestination||(id==='dashboard-screen'?'Home':id==='fixtures-screen'||id==='booking-screen'||id==='booking-sent-screen'?'Fixtures':id==='stats-screen'?'Stats':id==='knockout-screen'?'Knockout':'Quick actions');
  document.querySelectorAll('.bottom-item').forEach(item=>{
    const active=item.dataset.destination===nav;
    item.classList.toggle('active',active);
    if(active)item.setAttribute('aria-current','page');else item.removeAttribute('aria-current');
  });
  window.scrollTo({top:0,behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
}
function setMatch(a,b){
  matchA=a;matchB=b;
  const aData=roster[a]||{initials:a.split(' ').map(x=>x[0]).join(''),tone:'maya'};
  const bData=roster[b]||{initials:b.split(' ').map(x=>x[0]).join(''),tone:'priya'};
  const markup=`<span class="flow-avatar avatar-${aData.tone}">${aData.initials}</span><strong>${a}</strong><span class="versus-mark">vs</span><span class="flow-avatar avatar-${bData.tone}">${bData.initials}</span><strong>${b}</strong>`;
  document.querySelector('#booking-match').innerHTML=markup;
  document.querySelector('#result-match').innerHTML=markup;
  document.querySelectorAll('.winner-select').forEach(select=>{
    select.innerHTML=`<option value="a">${a}</option><option value="b">${b}</option>`;
  });
  document.querySelector('[name="winner1"]').value='a';
  document.querySelector('[name="winner2"]').value='b';
  document.querySelector('[name="winner3"]').value='a';
  const labels=[['f1a',a],['f1b',b],['f2a',a],['f2b',b],['f3a',a],['f3b',b],['break-a',`${a}’s highest break`],['break-b',`${b}’s highest break`]];
  labels.forEach(([id,label])=>{const element=document.getElementById(id);if(element){element.setAttribute('aria-label',label);if(element.labels?.[0]&&id.startsWith('break-'))element.labels[0].textContent=label;}});
  document.querySelector('#correction-note').classList.add('hidden');
}
document.querySelectorAll('[data-action="record"]').forEach(button=>button.addEventListener('click',()=>{
  setMatch(button.dataset.a,button.dataset.b);showScreen('result-screen','Quick actions');
}));
document.querySelectorAll('[data-action="book"]').forEach(button=>button.addEventListener('click',()=>{
  setMatch(button.dataset.a,button.dataset.b);showScreen('booking-screen','Fixtures');
}));
document.querySelectorAll('[data-go]').forEach(button=>button.addEventListener('click',()=>showScreen(button.dataset.go)));
document.querySelectorAll('.bottom-item').forEach(item=>item.addEventListener('click',()=>{
  const destination=item.dataset.destination;
  if(destination==='Home')showScreen('dashboard-screen','Home');
  else if(destination==='Fixtures')showScreen('fixtures-screen','Fixtures');
  else if(destination==='Quick actions')showScreen('fixtures-screen','Fixtures');
  else if(destination==='Stats')showScreen('stats-screen','Stats');
  else if(destination==='Knockout')showScreen('knockout-screen','Knockout');
}));

document.querySelector('#booking-form').addEventListener('submit',event=>{
  event.preventDefault();if(!event.currentTarget.reportValidity())return;
  const date=document.querySelector('#planned-date').value;
  const time=document.querySelector('#planned-time').value;
  const pretty=new Date(`${date}T12:00:00`).toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long'});
  document.querySelector('#booking-sent-summary').textContent=`${pretty} · ${time}`;
  document.querySelector('#booking-sent-opponents').textContent=`${matchA} vs ${matchB}`;
  showScreen('booking-sent-screen','Fixtures');
});
function formatDate(date){return new Date(`${date}T12:00:00`).toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'});}
document.querySelector('#result-form').addEventListener('submit',event=>{
  event.preventDefault();
  const form=event.currentTarget;
  if(!form.reportValidity())return;
  const data=new FormData(form);const error=document.querySelector('#result-error');error.textContent='';
  const winners=[data.get('winner1'),data.get('winner2'),data.get('winner3')];
  const aWins=winners.filter(winner=>winner==='a').length;const bWins=3-aWins;
  const scoreFields=[['f1a','f1b'],['f2a','f2b'],['f3a','f3b']];
  const rawScores=scoreFields.map(pair=>pair.map(key=>String(data.get(key)||'').trim()));
  const hasSomeScores=rawScores.flat().some(value=>value!=='');
  if(hasSomeScores&&rawScores.flat().some(value=>value==='')){error.textContent='For frame-point details, enter both players’ scores for all three frames—or leave all six blank.';return;}
  if(hasSomeScores){
    for(let i=0;i<3;i++){
      const [scoreA,scoreB]=rawScores[i].map(Number);
      if(scoreA===scoreB||((scoreA>scoreB?'a':'b')!==winners[i])){error.textContent=`Check Frame ${i+1}: the point scores and selected frame winner don’t match.`;return;}
    }
    const scoresA=rawScores.map(pair=>Number(pair[0]));const scoresB=rawScores.map(pair=>Number(pair[1]));
    const breakA=String(data.get('breakA')||'').trim();const breakB=String(data.get('breakB')||'').trim();
    if(breakA!==''&&Number(breakA)>Math.max(...scoresA)){error.textContent=`${matchA}’s break cannot be higher than their best recorded frame score.`;return;}
    if(breakB!==''&&Number(breakB)>Math.max(...scoresB)){error.textContent=`${matchB}’s break cannot be higher than their best recorded frame score.`;return;}
  }
  submittedResult={a:matchA,b:matchB,aWins,bWins,date:String(data.get('actualDate')),scores:hasSomeScores?rawScores:null,breakA:String(data.get('breakA')||''),breakB:String(data.get('breakB')||'')};
  renderReview();showScreen('review-screen','Quick actions');
});
function renderReview(){
  const result=submittedResult;if(!result)return;
  document.querySelector('#review-name-a').textContent=result.a;document.querySelector('#review-name-b').textContent=result.b;
  document.querySelector('#review-score-a').textContent=result.aWins;document.querySelector('#review-score-b').textContent=result.bWins;
  document.querySelector('#review-date').textContent=formatDate(result.date);
  const winners=[...document.querySelectorAll('.winner-select')].map(select=>select.value==='a'?result.a:result.b);
  document.querySelector('#review-frames').innerHTML=winners.map((winner,i)=>`<div class="review-frame"><span>Frame ${i+1}</span><strong class="frame-winner-name">${winner}</strong><span>Winner</span></div>`).join('');
  const optional=document.querySelector('#review-optional');
  if(result.scores){
    optional.innerHTML=result.scores.map((scores,i)=>`<div class="review-optional-grid"><span>Frame ${i+1}</span><span>${result.a} ${scores[0]} – ${scores[1]} ${result.b}</span></div>`).join('')+`<div class="review-optional-grid"><span>Highest breaks</span><span>${result.a} ${result.breakA||'—'} · ${result.b} ${result.breakB||'—'}</span></div>`;
    document.querySelector('.review-details').classList.remove('hidden');
  }else document.querySelector('.review-details').classList.add('hidden');
  document.querySelector('#confirmed-summary').textContent=`${result.a} ${result.aWins} — ${result.bWins} ${result.b}`;
  document.querySelector('#confirmed-date').textContent=`Played ${formatDate(result.date)}`;
}
document.querySelector('#confirm-result').addEventListener('click',()=>{renderReview();showScreen('confirmed-screen','Home');});
document.querySelector('#send-back').addEventListener('click',()=>{document.querySelector('#correction-note').classList.remove('hidden');showScreen('result-screen','Quick actions');});
document.querySelector('#reveal-draw').addEventListener('click',()=>{
  const draw=document.querySelector('#draw-details');
  draw.hidden=false;draw.classList.remove('hidden');
  document.querySelector('#reveal-draw').classList.add('hidden');
  draw.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'nearest'});
});
renderTable('round');
renderResults(6);
setMatch(matchA,matchB);
