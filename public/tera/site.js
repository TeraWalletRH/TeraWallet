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
 ,'intro':'介绍','areas':'能力','process':'流程','results':'结果','projects':'工作流','environments':'生态角色','stack':'技术栈','value':'价值','principles':'原则','foundation':'基础','next phases':'后续阶段','help':'帮助','community':'社区'
 ,'Your assets.':'你的资产。','Your rules.':'你的规则。','Your authority.':'你的权限。','explore the wallet':'探索钱包','how it works':'工作方式'
 ,'Your keys remain yours':'你的密钥始终属于你','Five deterministic gates':'五个确定性关卡','From proposal to your approval':'从提案到你的批准','designed around:':'围绕以下原则设计：','What your wallet protects':'你的钱包保护什么'
 ,'Asset checks & eligibility':'资产检查与资格验证','Check supported assets and issuer restrictions before a proposal reaches you.':'在提案提交给你之前，先检查支持的资产和发行方限制。','Private rules & limits':'私有规则与限额','Your agent sees a policy result, never your private thresholds.':'代理只能看到策略结果，永远不会看到你的私有阈值。'
 ,'Scoped agent &':'受限代理与','owner approval':'所有者批准','An agent prepares the action. Only you authorize what matters.':'代理负责准备操作，只有你能授权关键事项。','Receipts & selective disclosure':'回执与选择性披露','Share one permitted receipt without exposing unrelated history.':'分享一张获准的回执，无需暴露无关历史。'
 ,'tera wallet · private by default':'tera 钱包 · 默认保护隐私','we':'我们','built':'构建','automation':'自动化','around':'围绕','your':'你的','intent':'意图','much':'更多','explore all capabilities':'探索全部能力'
 ,'Every proposal passes deterministic checks. Your authority stays intact.':'每个提案都会经过确定性检查。你的权限始终完整。','Prepare your':'准备你的','Verify asset & eligibility':'验证资产与资格','Check private policy & risk':'检查私有策略与风险','Review, approve & execute':'审核、批准并执行'
 ,'Proposal >':'提案 >','Ask the agent to prepare an action. It drafts a typed intent with an asset, route, amount and expiry; it never receives your keys.':'让代理准备操作。它会生成包含资产、路线、金额和有效期的结构化意图；它永远不会获得你的密钥。'
 ,'Preflight >':'预检查 >','The registry and issuer preflight check whether the asset and route are supported. Unknown or ineligible actions stop here.':'注册表和发行方预检查会确认资产和路线是否受支持。未知或不符合资格的操作会在这里停止。'
 ,'Policy >':'策略 >','The policy vault checks your private limits. The risk engine checks route, price, quote freshness and slippage.':'策略库检查你的私有限额。风险引擎检查路线、价格、报价时效和滑点。'
 ,'Approval >':'批准 >','Review the exact action. The smart account executes only with the required owner authorization and returns a receipt.':'审核精确操作。智能账户只会在获得所需的所有者授权后执行，并返回回执。'
 ,'Authority by design':'权限源于设计','Registry, eligibility, private policy, risk and approval each narrow what a proposal can do.':'注册表、资格、私有策略、风险和批准都会收窄提案可执行的范围。','Automate':'自动化','repetitive':'重复性','workflows,':'工作流，','and':'以及','reporting':'报告','so':'让','roles':'角色','can':'能够','focus':'专注于','on':'','high-impact':'高价值','work.':'工作。','Readiness first. Owner-approved execution before scoped automation and private proofs.':'准备优先。先实现所有者批准的执行，再实现受限自动化和私有证明。'
 ,'Private authorization':'私密授权','Owner-approved actions':'所有者批准的操作','Check an action against private rules without revealing your balance, strategy or spending thresholds to the agent.':'根据私有规则检查操作，无需向代理泄露你的余额、策略或支出阈值。','Bind your approval to the exact asset, amount, route and expiry. Each approval authorizes one specific action.':'将你的批准绑定到精确的资产、金额、路线和有效期。每一次批准只授权一个具体操作。'
 ,'challenge >':'挑战 >','wallet response >':'钱包响应 >','principle >':'原则 >','EXPOSED FINANCIAL CONTEXT':'暴露的财务上下文','Unbounded permissions':'无边界权限','UNSCOPED AGENT ACCESS':'未限定范围的代理访问','PRIVATE POLICY CHECKS':'私有策略检查','OWNER AUTHORIZATION':'所有者授权','REVOCABLE SESSIONS':'可撤销会话','owner in control':'所有者掌控','gates before execution':'执行前的关卡','exact authorized action':'精确授权的操作'
 ,'A role for everyone':'每个角色都有位置','Independent roles. Narrow permissions. Shared verification.':'独立角色、有限权限、共享验证。','RWA owners':'RWA 所有者','Keep custody':'保留托管权','Set private limits':'设置私有限额','Review proposals':'审核提案','Approve exact actions':'批准精确操作','Agent developers':'代理开发者','Draft typed intents':'起草结构化意图','Use narrow interfaces':'使用受限接口','Explain results':'解释结果','Issuer providers':'发行方提供者','Provide eligibility facts':'提供资格事实','Validate claims':'验证声明','Publish restrictions':'发布限制','Check transfer rules':'检查转移规则','Verifiers':'验证者','Check registry roots':'检查注册表根','Validate receipts':'验证回执','Verify attestations':'验证证明','Confirm provenance':'确认来源','Governance':'治理','Govern the registry':'管理注册表','Review asset support':'审核资产支持','Suspend unsafe routes':'暂停不安全路线','Preserve owner custody':'保护所有者托管权','Smart accounts':'智能账户','Validate signatures':'验证签名','Enforce session scope':'执行会话范围','Reject expired intents':'拒绝过期意图','Prevent replay':'防止重放'
 ,'The verification stack':'验证技术栈','Asset registry, eligibility preflight, policy vault, risk engine and owner approval work as independent gates.':'资产注册表、资格预检查、策略库、风险引擎和所有者批准作为独立关卡协同工作。','Built':'构建于','Revoke access in one action':'一键撤销访问','Custody before automation':'托管优先于自动化','Exact action approvals':'精确操作批准','Permission comes from code, never from an agent’s explanation.':'权限来自代码，而不是代理的解释。'
 ,'Your limits stay private':'你的限额保持私密','Independent checks before authorization':'授权前的独立检查','Private by default does not override issuer requirements. Reveal only what the particular action you authorize requires.':'默认隐私不会覆盖发行方要求。只披露你所授权的具体操作所需的信息。'
 ,'Readiness before execution':'执行前先准备','Every action needs your approval':'每个操作都需要你的批准','Automation after an audited core':'审计核心后再自动化','Readiness':'准备','Authorization':'授权','Privacy':'隐私','/ phase':'/ 阶段','Signed asset registry':'已签名的资产注册表','Asset detail screens':'资产详情页面','Typed agent proposals':'结构化代理提案','Proposal-only mode':'仅提案模式','Eligibility preflight':'资格预检查','Private policy checks':'私有策略检查','Owner-approved execution':'所有者批准的执行','Exact intent signatures':'精确意图签名','Scoped yield-claim sessions':'受限收益领取会话','Revocable permissions':'可撤销权限','Private policy proofs':'私有策略证明','Audit and adoption gates':'审计与采用关卡','explore the phases':'探索阶段','first':'第一阶段','next':'下一阶段','view the roadmap':'查看路线图'
 ,'Can an agent move my assets on its own?':'代理能自行转移我的资产吗？','Does the agent see my private limits?':'代理能看到我的私有限额吗？','How are issuer restrictions checked?':'如何检查发行方限制？','What happens when a check fails?':'检查失败时会怎样？','Is this wallet already live?':'这个钱包已经上线了吗？','Understand your custody, rules and approval authority.':'了解你的托管权、规则和批准权限。','Got':'还有','some':'一些','other':'其他','questions?':'问题吗？','coming soon':'即将推出','Name':'姓名','Email':'邮箱','explore the demo':'探索演示','All':'全部'
 ,'The agent proposes. You stay in control.':'代理提出方案，你始终掌控。','You retain authority':'你的权限始终保留','home':'首页','about':'关于','solutions':'能力','privacy':'隐私','policy':'策略','terms of service':'服务条款'
 ,'Private authorization for supervised real-world asset workflows.':'面向受监督现实世界资产工作流的私密授权。','The agent thinks.':'代理负责思考。','Tera enforces.':'Tera 负责执行规则。','You approve.':'你负责批准。','From proposal to':'从提案到','approval':'批准','What your wallet protects':'你的钱包保护什么','Asset checks & eligibility':'资产检查与资格验证','Check supported assets':'检查受支持的资产','and issuer restrictions before a proposal reaches you.':'以及在提案提交给你之前的发行方限制。','Private rules & limits':'私有规则与限额','Your agent sees a':'你的代理只能看到','result, never your private thresholds.':'结果，永远不会看到你的私有阈值。','An agent prepares the action. Only you authorize what matters.':'代理负责准备操作，只有你能授权关键事项。','Receipts & selective disclosure':'回执与选择性披露','Share one permitted receipt without exposing unrelated history.':'分享一张获准的回执，无需暴露无关历史。'
 ,'The agent can think. Your wallet enforces.':'代理可以思考，你的钱包负责执行规则。','+ much more':'+ 更多内容','How it works':'工作方式','Every proposal passes deterministic checks. Your authority stays intact.':'每个提案都会经过确定性检查。你的权限始终完整。','Prepare your':'准备你的','Check private':'检查私有','& risk':'与风险','Verify asset & eligibility':'验证资产与资格','Review, approve & execute':'审核、批准并执行'
 ,'Ask the agent to prepare an action. It drafts a typed':'让代理准备操作。它会生成结构化的','with an asset, route, amount':'其中包含资产、路线、金额','and expiry; it never receives your keys.':'和有效期；它永远不会获得你的密钥。','The registry and issuer preflight check whether the asset and route are supported. Unknown or ineligible actions stop here.':'注册表和发行方预检查会确认资产和路线是否受支持。未知或不符合资格的操作会在这里停止。','The policy vault checks your private limits. The risk engine checks route, price, quote freshness and slippage.':'策略库检查你的私有限额。风险引擎检查路线、价格、报价时效和滑点。','Review the exact action. The smart account executes only with the required owner authorization and returns a receipt.':'审核精确操作。智能账户只会在获得所需的所有者授权后执行，并返回回执。'
 ,'The agent cannot change your policy, bypass issuer restrictions or sign with your keys.':'代理不能更改你的策略、绕过发行方限制或使用你的密钥签名。','Readiness first. Owner-approved execution before scoped automation and private proofs.':'准备优先。先实现所有者批准的执行，再实现受限自动化和私有证明。','Give a low-risk task narrowly scoped authority, a hard expiry and a simple way to revoke it. Planned after an audited core.':'为低风险任务提供严格限定的权限、固定有效期和简单的撤销方式。该功能将在核心完成审计后推出。'
 ,'A role for everyone':'每个角色都有位置','Independent roles. Narrow permissions. Shared verification.':'独立角色、有限权限、共享验证。','Respect scoped context':'遵守受限上下文','The verification stack':'验证技术栈','Why':'为什么选择','Tera Wallet':'Tera 钱包','Your private rules, enforced':'执行你的私有规则','Exact action':'精确操作','Private by default':'默认保护隐私','Your keys stay yours':'你的密钥始终属于你','01 / self-custody':'01 / 自托管','02 / private policy':'02 / 私有策略'
 ,'The agent never holds your keys. It prepares typed proposals; the wallet validates permissions and you retain final authority.':'代理永远不会持有你的密钥。它准备结构化提案；钱包验证权限，而你保留最终决定权。','Your agent sees a pass or fail result, not your balances, strategy or private spending thresholds.':'你的代理只能看到通过或失败的结果，而不是你的余额、策略或私有支出阈值。','Roadmap':'路线图','Every action needs your approval':'每个操作都需要你的批准','Automation after an audited core':'审计核心后再自动化','owner first':'所有者优先','FAQ':'常见问题','Community':'社区','All rights reserved':'版权所有','Owner approved':'所有者已批准','Menu':'菜单','Explore wallet ↗':'探索钱包 ↗','Community · coming soon ↗':'社区 · 即将推出 ↗'
 ,'your logo':'你的标志','your logo 2':'你的标志','ceo avatar':'首席执行官头像','client avatar 1':'客户头像 1','client avatar 2':'客户头像 2','client avatar 3':'客户头像 3','client avatar 4':'客户头像 4','client avatar 5':'客户头像 5','integrated logo 1':'集成标志 1','integrated logo 2':'集成标志 2','integrated logo 3':'集成标志 3','integrated logo 4':'集成标志 4','integrated logo 5':'集成标志 5','integrated logo 6':'集成标志 6','integrated logo 7':'集成标志 7','integrated logo 8':'集成标志 8'
 ,'rights reserved':'版权所有','workflows':'工作流','Owner approval':'所有者批准','Scoped keys':'受限密钥','Private policy':'私有策略','Language':'语言','Select language':'选择语言','Open wallet':'打开钱包','Wallet overview':'钱包概览'
};
Object.assign(zhText,{
 'Private':'私密','authorization':'授权','gates':'关卡','privacy policy':'隐私政策','Powered by':'技术支持','Got some other':'还有其他','Contract address':'合约地址','Copy':'复制','Copied':'已复制','Copy unavailable':'复制不可用','Dexscreener ↗':'在 Dexscreener 查看 ↗',
 'we built automation around your intent':'代理可以思考，你的钱包负责执行规则。','Built around your intent':'执行你的私有规则','Workflow workflows':'遵守受限上下文','Scoped agent sessions':'受限代理会话','explore wallet workflows':'探索钱包工作流',
 'Automate repetitive workflows, and reporting so your roles can focus on high-impact work.':'代理不能更改你的策略、绕过发行方限制或使用你的密钥签名。',
 'An innovative scoped sessions company seeking faster and more efficient research operations. Through intelligent automation, we optimized data processing.':'为低风险任务提供严格限定的权限、固定有效期和简单的撤销方式。该功能将在核心完成审计后推出。'
});
const normalizeTranslation=s=>s.replace(/\s+/g,'').toLowerCase();
const zhLookup=Object.fromEntries(Object.entries(zhText).map(([key,value])=>[normalizeTranslation(key),value]));
const translatedNodes=new WeakMap();
function sourceText(node){const previous=translatedNodes.get(node);return previous&&node.nodeValue===previous.output?previous.source:node.nodeValue||''}
function writeTranslation(node,source,output){translatedNodes.set(node,{source,output});if(node.nodeValue!==output)node.nodeValue=output}
function locale(){try{return localStorage.getItem('tera-locale')==='zh'?'zh':'en'}catch{return'en'}}
function applyLocaleUi(lang){document.documentElement.lang=lang==='zh'?'zh-CN':'en';$$('[data-locale-select]').forEach(s=>{s.value=lang});$$('[data-locale-label]').forEach(e=>{e.textContent=lang==='zh'?'语言':'Language'})}
function setLocale(next){const lang=next==='zh'?'zh':'en',current=locale();try{localStorage.setItem('tera-locale',lang)}catch{}if(lang!==current){location.reload();return}applyLocaleUi(lang)}
function translatePage(lang){
 document.title=lang==='zh'?'Tera 钱包 · 私密授权':'Tera Wallet · Private authorization';const description=$('meta[name="description"]');if(description)description.content=lang==='zh'?'Tera 钱包：面向受监督现实世界资产工作流的私密授权。代理提出方案，所有者保留权限。':'Tera Wallet: private authorization for supervised real-world asset workflows. The agent proposes. You retain authority.';
 const nodes=[];const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);while(walker.nextNode())nodes.push(walker.currentNode);
 const groups=new Map();
 nodes.forEach(n=>{if(n.parentElement?.closest('script,style,select,code'))return;const block=n.parentElement?.closest('p,h1,h2,h3,h4,h5,h6,button,a,label')||n;const group=groups.get(block)||[];group.push(n);groups.set(block,group)});
 for(const group of groups.values()){
  const sources=group.map(sourceText),phrase=sources.join(''),translation=zhLookup[normalizeTranslation(phrase)];
  if(lang==='zh'&&translation!==undefined){
   // Keep every span in place, including spans used by heading animations.
   const chars=Array.from(translation);let offset=0,consumed=0;
   group.forEach((n,i)=>{consumed+=sources[i].length;const end=i===group.length-1?chars.length:Math.round(chars.length*consumed/Math.max(phrase.length,1));writeTranslation(n,sources[i],chars.slice(offset,end).join(''));offset=end});
  }else group.forEach((n,i)=>{const source=sources[i],value=lang==='zh'?zhLookup[normalizeTranslation(source)]:undefined;writeTranslation(n,source,value===undefined?source:source.replace(source.trim(),value))});
 }
 $$('[alt],[aria-label],[placeholder]').forEach(el=>['alt','aria-label','placeholder'].forEach(attr=>{const raw=el.getAttribute(attr);if(!raw)return;const store=`__tera_${attr}`;if(!el[store])el[store]=raw;const value=lang==='zh'?zhLookup[normalizeTranslation(el[store])]||el[store]:el[store];if(raw!==value)el.setAttribute(attr,value)}));
 $$('[data-locale-label]').forEach(e=>{e.textContent=lang==='zh'?'语言':'Language'});
}
function localeControl(){return '<label class="tera-locale"><span data-locale-label>Language</span><select data-locale-select aria-label="Select language"><option value="en">EN</option><option value="zh">中文</option></select></label>'}
function installLocaleControls(){
 const controls=$('.tera-header-controls');if(controls&&!controls.querySelector('[data-locale-select]')){const wrap=document.createElement('div');wrap.innerHTML=localeControl();controls.prepend(wrap.firstElementChild)}
 $$('footer').forEach(f=>{if(!f.querySelector('[data-locale-select]')){const wrap=document.createElement('div');wrap.className='tera-footer-locale';wrap.innerHTML=localeControl();f.append(wrap)}});
 $$('[data-locale-select]').forEach(s=>{s.onchange=()=>setLocale(s.value)});applyLocaleUi(locale());
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
 $$('footer').forEach(f=>{if(f.querySelector('.tera-footer-socials'))return;const social=document.createElement('nav');social.className='tera-footer-socials';social.setAttribute('aria-label','Tera Wallet social links');social.innerHTML='<a href="https://x.com/terawalletrh" target="_blank" rel="noopener noreferrer" aria-label="Tera Wallet on X">'+icons.x+'<span>X</span></a><a href="https://t.me/terawalletrh" target="_blank" rel="noopener noreferrer" aria-label="Tera Wallet on Telegram">'+icons.telegram+'<span>Telegram</span></a>';f.append(social)});
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
 h.querySelectorAll('[data-community]').forEach(button=>button.onclick=()=>{setMenu(false);window.open(button.dataset.community==='X'?'https://x.com/terawalletrh':'https://t.me/terawalletrh','_blank','noopener,noreferrer')});
 h.querySelectorAll('a').forEach(a=>a.addEventListener('click',()=>setMenu(false)));
 document.addEventListener('click',e=>{if(!h.contains(e.target))setMenu(false)});
 document.addEventListener('keydown',e=>{if(b.getAttribute('aria-expanded')!=='true')return;if(e.key==='Escape'){setMenu(false,true);e.preventDefault()}if(e.key==='Tab'){const items=[b,...panel.querySelectorAll('a,button')],first=items[0],last=items.at(-1);if(e.shiftKey&&document.activeElement===first){last.focus();e.preventDefault()}else if(!e.shiftKey&&document.activeElement===last){first.focus();e.preventDefault()}}});
}

function installTokenHero(){
 const address='0x3c12e57fa7817a86ce7c254db9ea5fe639e233f8';
 const heading=[...document.querySelectorAll('h1')].find(h=>/your assets|你的资产/i.test(h.textContent.replace(/\s+/g,' ')));
 if(!heading||$('#tera-token-hero'))return;
 const card=document.createElement('div');card.id='tera-token-hero';card.className='tera-token-hero';
 card.innerHTML=`<span class="tera-token-label">CONTRACT ADDRESS</span><code>${address}</code><button type="button" aria-label="Copy contract address">Copy</button><a href="https://dexscreener.com/search?q=${address}" target="_blank" rel="noopener noreferrer">Dexscreener ↗</a>`;
 (heading.parentElement||heading).append(card);
 const copy=$('button',card);copy.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(address);copy.textContent='Copied';setTimeout(()=>{copy.textContent='Copy'},1600)}catch{copy.textContent='Copy unavailable';setTimeout(()=>{copy.textContent='Copy'},1600)}});
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
installMenu();enhance();
// Framer replaces its text nodes during hydration. Translate only after its
// mutations settle; do not call enhance() here because it writes English chrome.
let localeTimer=null,tokenTimer=null;
const localeObserver=new MutationObserver(scheduleLocaleTranslation);
function observeLocale(){localeObserver.observe(document.body,{childList:true,characterData:true,subtree:true})}
function scheduleTokenHero(){if(tokenTimer!==null)return;tokenTimer=setTimeout(()=>{tokenTimer=null;installTokenHero()},100)}
function scheduleLocaleTranslation(){scheduleTokenHero();if(locale()!=='zh'||localeTimer!==null)return;localeTimer=setTimeout(()=>{localeTimer=null;localeObserver.disconnect();try{installTokenHero();installLocaleControls();translatePage('zh')}finally{observeLocale()}},0)}
observeLocale();scheduleLocaleTranslation();
addEventListener('load',()=>{scheduleTokenHero();[500,1500,3000].forEach(delay=>setTimeout(scheduleTokenHero,delay));scheduleLocaleTranslation()});
})();
