import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseHTML } from 'linkedom';

const script=readFileSync(new URL('../../public/tera/site.js',import.meta.url),'utf8');
function setup(html){
 const {document,MutationObserver}=parseHTML(html);
 const context=vm.createContext({document,MutationObserver,NodeFilter:{SHOW_TEXT:4},localStorage:{getItem:()=> 'zh'},setTimeout,clearTimeout,addEventListener(){},installTokenHero(){},installLocaleControls(){}});
 vm.runInContext(`const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];${script.slice(script.indexOf('const zhText='),script.indexOf('function localeControl'))}`,context);
 return {document,context,translate:()=>vm.runInContext("translatePage('zh')",context)};
}
const tick=()=>new Promise(resolve=>setTimeout(resolve,15));
test('complete phrases translate across spans without replacing elements',()=>{
 const {document,translate}=setup('<html><body><p><span>Your agent sees a </span><b>policy</b><span> result, never your private thresholds.</span></p><h1>Your assets.<br>Your rules.<br>Your authority.</h1></body></html>');
 const bold=document.querySelector('b');translate();
 assert.equal(document.querySelector('p').textContent,'代理只能看到策略结果，永远不会看到你的私有阈值。');
 assert.equal(document.querySelector('b'),bold);
 assert.doesNotMatch(document.querySelector('h1').textContent,/Your/);
 translate();assert.equal(document.querySelector('p').textContent,'代理只能看到策略结果，永远不会看到你的私有阈值。');
});
test('late hydration updates and changed text on reused nodes are translated',async()=>{
 const {document,context}=setup('<html><body><p>Your keys remain yours</p></body></html>');
 vm.runInContext(script.slice(script.indexOf('let localeTimer=null;'),script.lastIndexOf('})();')),context);
 await tick();assert.equal(document.querySelector('p').textContent,'你的密钥始终属于你');
 document.querySelector('p').firstChild.nodeValue='Five deterministic gates';
 await tick();assert.equal(document.querySelector('p').textContent,'五个确定性关卡');
 document.querySelector('p').innerHTML='<span>Your agent sees a </span><b>policy</b><span> result, never your private thresholds.</span>';
 await tick();assert.equal(document.querySelector('p').textContent,'代理只能看到策略结果，永远不会看到你的私有阈值。');
 vm.runInContext('localeObserver.disconnect()',context);
});
test('landing paragraphs and headings have Mandarin coverage',()=>{
 const {document,translate}=setup(readFileSync(new URL('../../src/site/index.html',import.meta.url),'utf8'));
 translate();
 const remaining=[...document.querySelectorAll('p,h1,h2,h3')].map(n=>n.textContent.trim()).filter(s=>/[a-z]{3}/i.test(s)&&!/[\u3400-\u9fff]/.test(s));
 assert.deepEqual([...new Set(remaining)].filter(s=>!['Buy template','Create a free website with Framer, the website builder loved by startups, designers and agencies.'].includes(s)),[]);
});
