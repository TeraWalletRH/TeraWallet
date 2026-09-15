(()=>{
const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
const icons={x:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18.9 2H22l-6.8 7.8L23.2 22h-6.3l-5-7.5L5.3 22H2.1l7.9-9L1 2h6.5l4.6 6.8L18.9 2ZM17.9 20h1.7L6.5 3.9H4.7L17.9 20Z"/></svg>',telegram:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m21.8 3.5-3.3 16c-.2 1.1-.9 1.3-1.8.8l-5-3.7-2.4 2.3c-.3.3-.5.5-1 .5l.4-5.1L18 6c.4-.4-.1-.6-.6-.3L5.9 12.9 1 11.4c-1.1-.3-1.1-1.1.2-1.6L20.3 2.4c.9-.3 1.7.2 1.5 1.1Z"/></svg>'};
let lastFocus;
const zhText={
 'Home':'首页','About Tera':'关于 Tera','Capabilities':'能力','Wallet workflows':'钱包工作流','Roadmap':'路线图','Community':'社区',
 'Explore Tera Wallet':'探索 Tera Wallet','Open wallet ↗':'打开钱包 ↗','Wallet ↗':'钱包 ↗','Tera Wallet':'Tera 钱包',
 'Private authorization.':'私密授权。','Your wallet, your authority.':'你的钱包，你的权限。','Explore wallet ↗':'探索钱包 ↗','Community · coming soon ↗':'社区 · 即将推出 ↗',
 'Owner approved':'所有者已批准','Designed for':'专为','Private by default':'默认保护隐私','Coming soon.':'即将推出。',
 'We’re preparing the next chapter of Tera Wallet. Explore the interactive demo while live access and community channels take shape.':'我们正在准备 Tera Wallet 的下一阶段。探索交互式演示，实时访问和社区渠道即将开放。',
 'The agent proposes. You retain authority.':'代理提出方案。权限始终属于你。','Permission at every step':'每一步都需要权限','Selective disclosure':'选择性披露',
 'Private authorization for supervised real-world asset workflows. The agent thinks. Tera enforces. You approve.':'面向受监督现实资产工作流的私密授权。代理负责思考，Tera 负责执行规则，你负责批准。',
 'Your assets. Your rules. Your authority.':'你的资产，你的规则，你的权限。','The agent can think. Your wallet enforces.':'代理可以思考，你的钱包负责执行规则。',
 'deterministic gates':'确定性关卡','owner authority':'所有者权限','self-custody':'自托管','Roadmap phases':'路线图阶段',
 'The agent proposes.':'代理提出方案。','You see the checks.':'你查看检查结果。','You sign the action.':'你签署操作。','Results stay traceable.':'结果始终可追踪。',
 'Owner supervised.':'所有者监督。','The owner approves the action.':'所有者批准操作。','Wallet workflows':'钱包工作流',
 'Open navigation':'打开导航','Close navigation':'关闭导航','Back to site ↗':'返回网站 ↗'
};
function locale(){try{return localStorage.getItem('tera-locale')==='zh'?'zh':'en'}catch{return'en'}}
function setLocale(next){const lang=next==='zh'?'zh':'en';try{localStorage.setItem('tera-locale',lang)}catch{}document.documentElement.lang=lang==='zh'?'zh-CN':'en';$$('[data-locale-select]').forEach(s=>{s.value=lang});translatePage(lang)}
function translatePage(lang){
 if(location.pathname==='/' ){renderChineseLanding(lang);return}
 const nodes=[];const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);while(walker.nextNode())nodes.push(walker.currentNode);
 nodes.forEach(n=>{if(n.parentElement?.closest('script,style,select'))return;const raw=n.nodeValue||'';const key=raw.trim();if(!key)return;const value=lang==='zh'?zhText[key]:n.dataset.teraEnglish||key;if(lang==='en'&&!n.dataset.teraEnglish)n.dataset.teraEnglish=key;if(value&&value!==key)n.nodeValue=raw.replace(key,value)});
 $$('[data-locale-label]').forEach(e=>{e.textContent=lang==='zh'?'语言':'Language'});
}
function renderChineseLanding(lang){
 const existing=$('#tera-zh-landing');
 if(lang!=='zh'){existing?.remove();document.body.classList.remove('tera-zh-mode');$$('[data-locale-label]').forEach(e=>{e.textContent='Language'});return}
 document.body.classList.add('tera-zh-mode');
 $$('[data-locale-label]').forEach(e=>{e.textContent='语言'});
 if(existing)return;
 const page=document.createElement('main');page.id='tera-zh-landing';page.innerHTML=`
  <section class="zh-hero"><p class="zh-kicker">TERA WALLET / 私密授权</p><h1>你的资产。<br>你的规则。<br><em>你的权限。</em></h1><p class="zh-lead">面向现实世界资产工作流的自托管钱包。代理准备提案，Tera 检查规则，你批准最终操作。</p><a class="zh-button" href="/dashboard/">探索钱包 ↗</a></section>
  <section class="zh-section"><p class="zh-kicker">01 / 工作方式</p><h2>每一步都需要权限。</h2><div class="zh-grid"><article><b>资产与资格</b><p>检查资产注册表、发行方限制和转移资格，未通过的操作在签名前停止。</p></article><article><b>私有策略</b><p>代理看到检查结果，不会看到你的余额、策略或私有限额。</p></article><article><b>所有者批准</b><p>你在钱包中审核精确的资产、金额、路线和有效期，再签署操作。</p></article><article><b>可追踪回执</b><p>每次提交都有清晰的状态、区块浏览器链接和可选择披露的回执。</p></article></div></section>
  <section class="zh-section zh-dark"><p class="zh-kicker">02 / 确定性关卡</p><h2>代理可以思考，<br>钱包负责执行规则。</h2><div class="zh-steps"><div><span>01</span>资产注册表</div><div><span>02</span>资格预检查</div><div><span>03</span>私有策略</div><div><span>04</span>风险检查</div><div><span>05</span>所有者批准</div></div></section>
  <section class="zh-section"><p class="zh-kicker">03 / 隐私优先</p><h2>权限来自代码，<br>从不来自代理的解释。</h2><p class="zh-copy">你的密钥不会交给代理。每个批准都绑定到一个精确意图，代理不能扩大范围，也不能绕过你的规则。</p><a class="zh-button zh-button-light" href="/whitepaper">阅读白皮书 ↗</a></section>
  <footer class="tera-zh-footer"><span>TERA WALLET</span><span>所有者签名 · 所有者支付网络费用</span>${localeControl()}</footer>`;
 document.body.append(page);
}
function localeControl(){return '<label class="tera-locale"><span data-locale-label>Language</span><select data-locale-select aria-label="Select language"><option value="en">EN</option><option value="zh">中文</option></select></label>'}
function installLocaleControls(){
 const controls=$('.tera-header-controls');if(controls&&!controls.querySelector('[data-locale-select]')){const wrap=document.createElement('div');wrap.innerHTML=localeControl();controls.prepend(wrap.firstElementChild)}
 $$('footer').forEach(f=>{if(!f.querySelector('[data-locale-select]')){const wrap=document.createElement('div');wrap.className='tera-footer-locale';wrap.innerHTML=localeControl();f.append(wrap)}});
 $$('[data-locale-select]').forEach(s=>{s.onchange=()=>setLocale(s.value)});setLocale(locale());
}
function comingSoon(channel='Tera Wallet'){
 let d=$('#tera-coming-soon');if(!d){d=document.createElement('dialog');d.id='tera-coming-soon';d.className='tera-dialog';d.setAttribute('aria-labelledby','coming-title');d.innerHTML='<button class="close" aria-label="Close popup">×</button><small id="coming-channel"></small><h2 id="coming-title">Coming soon.</h2><p>We’re preparing the next chapter of Tera Wallet. Explore the interactive demo while live access and community channels take shape.</p><a href="/dashboard/">Explore wallet ↗</a>';document.body.append(d);$('.close',d).onclick=()=>d.close();d.addEventListener('click',e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close()}});d.addEventListener('close',()=>lastFocus?.focus())}lastFocus=document.activeElement;$('#coming-channel').textContent=channel;d.showModal();
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
 $$('form').forEach(f=>{if(f.dataset.teraForm)return;f.dataset.teraForm='1';f.innerHTML='<div class="tera-demo-entry"><p>Private authorization.<br>Your wallet, your authority.</p><a href="/dashboard/">Explore wallet <span>↗</span></a><a href="#community-telegram">Community · coming soon <span>↗</span></a></div>'});
 $$('nav').forEach(n=>{if(!n.closest('footer')||n.querySelectorAll('a').length<4||$('.tera-extra-nav',n))return;let box=document.createElement('div');box.className='tera-extra-nav';box.innerHTML='<a href="/dashboard/">Wallet ↗</a><a href="/roadmap/">Roadmap</a>';n.append(box)});
 $$('footer [data-framer-name="Designed for"] p').forEach(p=>{if(p.textContent.trim()==='Designed for')p.textContent='Owner approved'});
 // Brand credit text is replaced without changing the footer composition.
 $$('p').forEach(p=>{if(['Designed for','Powered by','owner authority','self-custody'].includes(p.textContent.trim())&&p.closest('footer'))p.style.opacity='.7'});
 installLocaleControls();
}

function installMenu(){
 if($('#tera-header'))return;
 document.documentElement.classList.add('tera-menu-ready');document.documentElement.classList.toggle('tera-is-home',location.pathname==='/');
 const h=document.createElement('header');h.id='tera-header';h.className='tera-header';
 const links=[['Home','/'],['About Tera','/about/'],['Capabilities','/solutions/'],['Wallet workflows','/projects/'],['Roadmap','/roadmap/'],['Community','/contacts/']];
 h.innerHTML=`<a class="tera-header-brand" href="/" aria-label="Tera Wallet home"><img src="/tera/logo.png" alt="">TERA WALLET</a><div class="tera-header-controls"><a class="tera-header-cta" href="/dashboard/">Open wallet ↗</a><button class="tera-menu-toggle" aria-label="Open navigation" aria-controls="tera-menu-panel" aria-expanded="false"><span class="tera-menu-word">Menu</span><span class="tera-menu-glyph" aria-hidden="true"></span></button></div><div class="tera-menu-panel" id="tera-menu-panel" hidden><p class="tera-menu-label">Explore Tera Wallet</p><nav aria-label="Main navigation">${links.map(([label,href],i)=>`<a href="${href}" ${location.pathname.replace(/\/$/,'')===href.replace(/\/$/,'')?'aria-current="page"':''}><span>0${i+1}</span>${label}</a>`).join('')}</nav><div class="tera-menu-bottom"><a class="tera-menu-wallet" href="/dashboard/">Wallet ↗</a><div class="tera-menu-socials"><button aria-label="X — coming soon" data-community="X">${icons.x}</button><button aria-label="Telegram — coming soon" data-community="Telegram">${icons.telegram}</button></div></div><div class="tera-menu-locale">${localeControl()}</div></div>`;
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
