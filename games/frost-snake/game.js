/**
 * Frost Snake — grid arena with frost trails.
 * Placeholder module — implements basic structure.
 */
export default (function () {
  'use strict';
  let shared = null, canvas = null, ctx = null, animationId = null, running = false;
  const W = 960, H = 540, GRID = 24;
  const C = { bg: '#030710', ice: '#e8faff', ice2: '#bae6fd', ice3: '#38bdf8', gold: '#ffd479', red: '#ef4444' };
  let snake = [], food = {x:0,y:0}, dir = {x:1,y:0}, nextDir = {x:1,y:0}, score = 0, state = 'menu', speed = 8;

  function init(c, sh) { canvas = c; shared = sh; ctx = canvas.getContext('2d'); resize(); window.addEventListener('resize', resize); window.addEventListener('keydown', onKeyDown); reset(); running = true; animationId = requestAnimationFrame(loop); shared.unlockAudio(); }
  function destroy() { running = false; if (animationId) cancelAnimationFrame(animationId); window.removeEventListener('resize', resize); window.removeEventListener('keydown', onKeyDown); }
  function resize() { const dpr = Math.min(window.devicePixelRatio||1,2.5); canvas.width=Math.round(W*dpr); canvas.height=Math.round(H*dpr); ctx.setTransform(dpr,0,0,dpr,0,0); }
  function onKeyDown(e) { const k=e.key; if(k==='ArrowUp'&&dir.y!==1)nextDir={x:0,y:-1}; else if(k==='ArrowDown'&&dir.y!==-1)nextDir={x:0,y:1}; else if(k==='ArrowLeft'&&dir.x!==1)nextDir={x:-1,y:0}; else if(k==='ArrowRight'&&dir.x!==-1)nextDir={x:1,y:0}; else if(k===' '){ if(state==='menu'||state==='gameover')reset(); else if(state==='playing')state='paused'; else state='playing'; } }
  function reset() { snake=[{x:10,y:10},{x:9,y:10},{x:8,y:10}]; dir={x:1,y:0}; nextDir={x:1,y:0}; score=0; state='menu'; spawnFood(); speed=8; }
  function spawnFood() { let ok=false; while(!ok){ food.x=randInt(0,W/GRID-1); food.y=randInt(0,H/GRID-1); ok=!snake.some(s=>s.x===food.x&&s.y===food.y); } }
  function loop() { if(!running)return; update(); render(); animationId=requestAnimationFrame(loop); }
  let acc=0;
  function update() { if(state!=='playing')return; acc+=1/60; if(acc<1/speed)return; acc=0; dir=nextDir; const head={x:snake[0].x+dir.x,y:snake[0].y+dir.y}; if(head.x<0||head.x>=W/GRID||head.y<0||head.y>=H/GRID||snake.some(s=>s.x===head.x&&s.y===head.y)){ state='gameover'; shared.tone({f0:120,f1:60,dur:0.4,vol:0.3,type:'sawtooth'}); return; } snake.unshift(head); if(head.x===food.x&&head.y===food.y){ score+=10; speed=Math.min(20,speed+0.3); spawnFood(); shared.tone({f0:440,f1:660,dur:0.1,vol:0.2,type:'triangle'}); shared.spawnParticles({x:food.x*GRID+GRID/2,y:food.y*GRID+GRID/2,count:15,color:C.gold,speed:150,life:0.5,size:3}); } else snake.pop(); }
  function render() { ctx.fillStyle=C.bg; ctx.fillRect(0,0,W,H); ctx.fillStyle='rgba(90,210,255,0.03)'; for(let x=0;x<W;x+=GRID){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke();} for(let y=0;y<H;y+=GRID){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke();} snake.forEach((seg,i)=>{ const x=seg.x*GRID,y=seg.y*GRID; const a=1-i/snake.length*0.6; ctx.fillStyle=`rgba(232,250,255,${a})`; ctx.fillRect(x+1,y+1,GRID-2,GRID-2); if(i===0){ctx.fillStyle=C.ice3;ctx.beginPath();ctx.arc(x+GRID/2,y+GRID/2,GRID/2-2,0,Math.PI*2);ctx.fill();} }); ctx.fillStyle=C.gold; ctx.beginPath(); ctx.arc(food.x*GRID+GRID/2,food.y*GRID+GRID/2,GRID/2-2,0,Math.PI*2); ctx.fill(); ctx.font='bold 24px monospace'; ctx.fillStyle=C.ice2; ctx.textAlign='left'; ctx.fillText('Score: '+score,20,40); if(state==='menu')drawOverlay('FROST SNAKE','Arrow keys to move · Space to start'); else if(state==='paused')drawOverlay('PAUSED','Space to resume'); else if(state==='gameover')drawOverlay('GAME OVER',`Score: ${score} · Space to restart`); shared.drawParticles(ctx); }
  function drawOverlay(t,s){ ctx.fillStyle='rgba(3,7,16,0.85)';ctx.fillRect(0,0,W,H); ctx.font='bold 48px sans-serif';ctx.textAlign='center';ctx.fillStyle=C.ice;ctx.fillText(t,W/2,H/2-20); ctx.font='18px sans-serif';ctx.fillStyle=C.ice3;ctx.fillText(s,W/2,H/2+30); }
  function randInt(a,b){return Math.floor(Math.random()*(b-a+1))+a;}
  return {init,destroy};
})();