(()=>{
const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
const icons={x:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18.9 2H22l-6.8 7.8L23.2 22h-6.3l-5-7.5L5.3 22H2.1l7.9-9L1 2h6.5l4.6 6.8L18.9 2ZM17.9 20h1.7L6.5 3.9H4.7L17.9 20Z"/></svg>',telegram:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m21.8 3.5-3.3 16c-.2 1.1-.9 1.3-1.8.8l-5-3.7-2.4 2.3c-.3.3-.5.5-1 .5l.4-5.1L18 6c.4-.4-.1-.6-.6-.3L5.9 12.9 1 11.4c-1.1-.3-1.1-1.1.2-1.6L20.3 2.4c.9-.3 1.7.2 1.5 1.1Z"/></svg>'};
let lastFocus;
function comingSoon(channel='Tera Wallet'){
 let d=$('#tera-coming-soon');if(!d){d=document.createElement('dialog');d.id='tera-coming-soon';d.className='tera-dialog';d.setAttribute('aria-labelledby','coming-title');d.innerHTML='<button class="close" aria-label="Close popup">×</button><small id="coming-channel"></small><h2 id="coming-title">Coming soon.</h2><p>We’re preparing the next chapter of Tera Wallet. Explore the interactive demo while live access and community channels take shape.</p><a href="/dashboard/">Explore wallet demo ↗</a>';document.body.append(d);$('.close',d).onclick=()=>d.close();d.addEventListener('click',e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close()}});d.addEventListener('close',()=>lastFocus?.focus())}lastFocus=document.activeElement;$('#coming-channel').textContent=channel;d.showModal();
}
window.teraComingSoon=comingSoon;
function enhance(){

 $$('[data-framer-name="Oberon logo"]').forEach(e=>{if(!$('.tera-brand-mark',e)){const im=document.createElement('img');im.src='/tera/logo.png';im.className='tera-brand-mark';im.alt='';e.prepend(im)}e.setAttribute('aria-label','Tera Wallet home');e.href='/';const p=$('p',e);if(p&&p.textContent!=='Tera Wallet')p.textContent='Tera Wallet'});
 $$('a[href]').forEach(a=>{let h=a.getAttribute('href');let txt=a.textContent.replace(/\s+/g,' ').trim().toLowerCase();if(a.closest('header nav')&&['home','wallet overview'].includes(txt)){a.href='/dashboard/';a.setAttribute('aria-label','Wallet overview');const p=a.querySelector('p');if(p&&p.textContent!=='wallet overview')p.textContent='wallet overview'}if(a.closest('header nav')&&['community','roadmap'].includes(txt)){a.href='/roadmap/';a.setAttribute('aria-label','Roadmap');const p=a.querySelector('p');if(p&&p.textContent!=='roadmap')p.textContent='roadmap'}if(['explore the wallet','explore the demo','open wallet','open your wallet'].includes(txt)){a.href='/dashboard/';a.removeAttribute('target')}if(['view the roadmap','explore the phases'].includes(txt))a.href='/roadmap/';
  if(/cal\.com/.test(h)){a.href='/dashboard/';a.removeAttribute('target')}
  if(/x\.com|linkedin\.com/.test(h)){const x=h.includes('x.com');a.href=x?'#community-x':'#community-telegram';a.removeAttribute('target');a.setAttribute('aria-label',x?'X — coming soon':'Telegram — coming soon');if(!a.dataset.teraSocial){a.innerHTML=icons[x?'x':'telegram'];a.classList.add('tera-social');a.dataset.teraSocial='1'}}
  if(/mailto:|tel:/.test(h)){a.href='/dashboard/';a.removeAttribute('target')}
  h=a.getAttribute('href');if(h.startsWith('./')||h.startsWith('../')){const u=new URL(h.startsWith('./')?h.slice(1):h,location.origin);a.href=u.pathname+u.hash}
 });
 $$('ul [data-framer-name^="Logo "]').forEach(e=>{if(e.querySelector('.tera-standard'))return;const i=Number(e.getAttribute('data-framer-name').split(' ').pop())-1;const names=['ERC-4337','ERC-3643','Owner approval','Scoped keys','Private policy','Selective disclosure'];const t=document.createElement('span');t.className='tera-standard';t.textContent=names[i%names.length];e.append(t)});
 $$('footer a[href*="/404"]').forEach(a=>{a.classList.add('tera-obsolete-link');a.setAttribute('aria-hidden','true');a.setAttribute('tabindex','-1')});
 $$('form').forEach(f=>{if(f.dataset.teraForm)return;f.dataset.teraForm='1';f.innerHTML='<div class="tera-demo-entry"><p>Private authorization.<br>Your wallet, your authority.</p><a href="/dashboard/">Explore wallet demo <span>↗</span></a><a href="#community-telegram">Community · coming soon <span>↗</span></a></div>'});
 $$('nav').forEach(n=>{if(!n.closest('footer')||n.querySelectorAll('a').length<4||$('.tera-extra-nav',n))return;let box=document.createElement('div');box.className='tera-extra-nav';box.innerHTML='<a href="/dashboard/">Wallet demo ↗</a><a href="/roadmap/">Roadmap</a>';n.append(box)});
 $$('footer [data-framer-name="Designed for"] p').forEach(p=>{if(p.textContent.trim()==='Designed for')p.textContent='Owner approved'});
 // Brand credit text is replaced without changing the footer composition.
 $$('p').forEach(p=>{if(['Designed for','Powered by','owner authority','self-custody'].includes(p.textContent.trim())&&p.closest('footer'))p.style.opacity='.7'});
}

function installMenu(){
 if($('#tera-header'))return;
 document.documentElement.classList.add('tera-menu-ready');document.documentElement.classList.toggle('tera-is-home',location.pathname==='/');
 const h=document.createElement('header');h.id='tera-header';h.className='tera-header';
 const links=[['Home','/'],['About Tera','/about/'],['Capabilities','/solutions/'],['Wallet workflows','/projects/'],['Roadmap','/roadmap/'],['Community','/contacts/']];
 h.innerHTML=`<a class="tera-header-brand" href="/" aria-label="Tera Wallet home"><img src="/tera/logo.png" alt="">TERA WALLET</a><div class="tera-header-controls"><a class="tera-header-cta" href="/dashboard/">Open wallet ↗</a><button class="tera-menu-toggle" aria-label="Open navigation" aria-controls="tera-menu-panel" aria-expanded="false"><span class="tera-menu-word">Menu</span><span class="tera-menu-glyph" aria-hidden="true"></span></button></div><div class="tera-menu-panel" id="tera-menu-panel" hidden><p class="tera-menu-label">Explore Tera Wallet</p><nav aria-label="Main navigation">${links.map(([label,href],i)=>`<a href="${href}" ${location.pathname.replace(/\/$/,'')===href.replace(/\/$/,'')?'aria-current="page"':''}><span>0${i+1}</span>${label}</a>`).join('')}</nav><div class="tera-menu-bottom"><a class="tera-menu-wallet" href="/dashboard/">Wallet ↗</a><div class="tera-menu-socials"><button aria-label="X — coming soon" data-community="X">${icons.x}</button><button aria-label="Telegram — coming soon" data-community="Telegram">${icons.telegram}</button></div></div></div>`;
 document.body.append(h);
 let contrastQueued=false;
 function contrast(){contrastQueued=false;const point=h.querySelector('.tera-header-brand').getBoundingClientRect();const under=document.elementsFromPoint(point.left+point.width/2,point.top+point.height/2).filter(e=>!h.contains(e));let dark=false;for(const e of under){const color=getComputedStyle(e).backgroundColor;const values=color.match(/[\d.]+/g)?.map(Number);if(values&&values.length>=3&&(values.length<4||values[3]>.85)){dark=(values[0]*.2126+values[1]*.7152+values[2]*.0722)<125;break}}h.classList.toggle('tera-on-dark',dark)}
 function scheduleContrast(){if(!contrastQueued){contrastQueued=true;requestAnimationFrame(contrast)}}
 addEventListener('scroll',scheduleContrast,{passive:true});addEventListener('resize',scheduleContrast,{passive:true});addEventListener('load',scheduleContrast);document.fonts.ready.then(scheduleContrast);scheduleContrast();
 const b=$('.tera-menu-toggle',h),panel=$('.tera-menu-panel',h);
 function setMenu(open,focus=false){b.setAttribute('aria-expanded',String(open));b.setAttribute('aria-label',open?'Close navigation':'Open navigation');panel.hidden=!open;if(focus)(open?$('nav a',panel):b).focus()}
 window.teraCloseMenu=()=>setMenu(false);
 b.addEventListener('click',()=>setMenu(b.getAttribute('aria-expanded')!=='true'));
 h.querySelectorAll('[data-community]').forEach(button=>button.onclick=()=>{setMenu(false);comingSoon(button.dataset.community)});
 h.querySelectorAll('a').forEach(a=>a.addEventListener('click',()=>setMenu(false)));
 document.addEventListener('click',e=>{if(!h.contains(e.target))setMenu(false)});
 document.addEventListener('keydown',e=>{if(b.getAttribute('aria-expanded')!=='true')return;if(e.key==='Escape'){setMenu(false,true);e.preventDefault()}if(e.key==='Tab'){const items=[b,...panel.querySelectorAll('a,button')],first=items[0],last=items.at(-1);if(e.shiftKey&&document.activeElement===first){last.focus();e.preventDefault()}else if(!e.shiftKey&&document.activeElement===last){first.focus();e.preventDefault()}}});
}

function phaseControl(target){const c=target.closest('[data-highlight]');if(!c)return false;const name=c.textContent.trim();if(!['first','next','first milestone','next milestone'].includes(name))return false;let section=c.parentElement;while(section&&(!section.querySelector('h2')||![...section.querySelectorAll('p')].some(p=>/^[A-F]$/.test(p.textContent.trim()))))section=section.parentElement;if(!section||!section.querySelector('h2').textContent.replace(/\s/g,'').includes('Roadmap'))return false;const next=name.startsWith('next');section.querySelectorAll('p').forEach(p=>{if(/^[A-F]$/.test(p.textContent.trim())){if(!p.dataset.phasePair)p.dataset.phasePair=String(Math.floor((p.textContent.trim().charCodeAt(0)-65)/2));const value=String.fromCharCode(65+Number(p.dataset.phasePair)*2+(next?1:0));if(p.textContent!==value){p.textContent=value;p.animate([{opacity:.3,transform:'translateY(6px)'},{opacity:1,transform:'translateY(0)'}],{duration:300})}}});section.querySelectorAll('[data-highlight]').forEach(b=>{if(['first','next','first milestone','next milestone'].includes(b.textContent.trim()))b.setAttribute('aria-pressed',String(b===c))});return true}
document.addEventListener('keydown',e=>{if(['Enter',' '].includes(e.key)&&phaseControl(e.target))e.preventDefault()});
document.addEventListener('click',e=>{if(phaseControl(e.target)){e.preventDefault();e.stopImmediatePropagation();return}const a=e.target.closest('a');if(!a||e.ctrlKey||e.metaKey||e.shiftKey||e.altKey||a.target==='_blank'||a.hasAttribute('download'))return;const h=a.getAttribute('href')||'';const t=a.textContent.trim().toLowerCase();
 if(h.startsWith('#community-')||t==='coming soon'){e.preventDefault();e.stopImmediatePropagation();comingSoon(h.includes('telegram')?'Telegram':h.includes('-x')?'X':'Tera Wallet');return}
 if(h.includes('cal.com')){e.preventDefault();e.stopImmediatePropagation();location.assign('/dashboard/');return}
 // Use normal document navigation for retained Framer pages and custom wallet routes.
 if(a.origin===location.origin&&a.pathname!==location.pathname){e.preventDefault();e.stopImmediatePropagation();window.teraCloseMenu?.();window.teraNavigate(a.pathname+a.search+a.hash)}
},true);
document.addEventListener('submit',e=>{e.preventDefault();e.stopImmediatePropagation();comingSoon()},true);
installMenu();enhance();let queued=false;new MutationObserver(()=>{if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;enhance()})}).observe(document.body,{childList:true,subtree:true});
})();
