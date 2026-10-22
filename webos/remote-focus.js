export function chooseRemoteTarget(current,candidates,key){
 const cx=current.left+current.width/2,cy=current.top+current.height/2;
 let best=null,score=Infinity;
 for(const n of candidates){const r=n.rect,dx=r.left+r.width/2-cx,dy=r.top+r.height/2-cy;
  const horizontal=key==='ArrowRight'||key==='ArrowLeft';
  const forward=key==='ArrowRight'?dx:key==='ArrowLeft'?-dx:key==='ArrowDown'?dy:-dy;
  if(forward<=2)continue;
  const cross=Math.abs(horizontal?dy:dx),cost=forward+cross*3;
  if(cost<score){score=cost;best=n;}
 }
 return best&&best.element;
}
