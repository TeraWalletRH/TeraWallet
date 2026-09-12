(()=>{
const reduce=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
window.teraNavigate=url=>{if(location.href===url)return;location.assign(url)};
window.teraScrollTo=(hash)=>{let el;try{el=document.getElementById(decodeURIComponent(hash.slice(1)))}catch{}if(!el)return false;el.scrollIntoView({behavior:reduce()?'instant':'smooth',block:'start'});history.replaceState(null,'',location.pathname+location.search+hash);return true};
addEventListener('pageshow',()=>document.documentElement.classList.remove('tera-leaving'));
// Same-document anchors keep the original content mounted while the viewport eases.
document.addEventListener('click',e=>{const a=e.target.closest('a[href]');if(!a||e.defaultPrevented||e.ctrlKey||e.metaKey||e.shiftKey||e.altKey||a.target==='_blank'||a.hasAttribute('download'))return;const u=new URL(a.href,location.href);if(u.origin!==location.origin)return;if(u.pathname.replace(/\/$/,'')===location.pathname.replace(/\/$/,'')&&u.hash&&!u.hash.startsWith('#community-')&&window.teraScrollTo(u.hash)){e.preventDefault();e.stopImmediatePropagation()}},true);
})();
