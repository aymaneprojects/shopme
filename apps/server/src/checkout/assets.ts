/** Checkout stylesheet and script (served at /checkout-assets/*). Original work in the Aurora look: dark blue, rounded, airy. */
export const CSS = `
:root{--primary:#1E40AF;--primary-dark:#1e3a8a;--primary-soft:#eff6ff;--text:#0f172a;--muted:#64748b;--border:#cbd5e1;--bg:#fff;--surface:#f8fafc;--danger:#b91c1c;--radius:8px}
*,*::before,*::after{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
a{color:var(--primary)}
.visually-hidden{position:absolute!important;width:1px;height:1px;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
:focus-visible{outline:3px solid var(--primary);outline-offset:2px}
.skip{position:absolute;left:-999px}.skip:focus{left:8px;top:8px;background:var(--primary);color:#fff;padding:8px 12px;z-index:9}
.co-header{border-bottom:1px solid var(--border);padding:16px}
.co-header a{font-weight:700;font-size:1.25rem;color:var(--primary);text-decoration:none}
.co{display:grid;grid-template-columns:1fr;max-width:1100px;margin:0 auto}
.co-summary{background:var(--surface);border-bottom:1px solid var(--border);padding:0 16px}
.co-main{padding:24px 16px 48px}
.co-toggle{display:flex;width:100%;justify-content:space-between;align-items:center;background:none;border:0;padding:16px 0;font:inherit;font-weight:600;color:var(--primary);cursor:pointer}
.co-summary-body{padding-bottom:16px}
.co-summary.is-closed .co-summary-body{display:none}
@media(min-width:900px){
 .co{grid-template-columns:minmax(0,1.15fr) minmax(0,1fr)}
 .co-summary{order:2;border:0;border-left:1px solid var(--border);padding:32px 32px 32px 40px;min-height:calc(100vh - 62px)}
 .co-main{order:1;padding:32px 40px 64px 16px}
 .co-toggle{display:none}.co-summary.is-closed .co-summary-body{display:block}
}
h1{font-size:1.5rem;margin:0 0 20px}
h2{font-size:1.125rem;margin:32px 0 12px}
.field{display:block;margin-bottom:12px}
.field>span{display:block;font-size:.875rem;color:var(--muted);margin-bottom:4px}
.field input,.field select{width:100%;min-height:46px;padding:10px 12px;border:1px solid var(--border);border-radius:var(--radius);background:#fff;font:inherit;color:inherit}
.field input:focus,.field select:focus{border-color:var(--primary)}
.row{display:grid;gap:12px;grid-template-columns:1fr}
@media(min-width:560px){.row.two{grid-template-columns:1fr 1fr}.row.three{grid-template-columns:1.2fr 1fr 1fr}}
.check{display:flex;gap:8px;align-items:center;margin:4px 0 12px}
.check input{width:18px;height:18px;accent-color:var(--primary)}
.options{border:1px solid var(--border);border-radius:var(--radius);overflow:hidden}
.option{display:flex;gap:12px;align-items:center;padding:14px 16px;border-top:1px solid var(--border);cursor:pointer}
.option:first-child{border-top:0}
.option input{accent-color:var(--primary);width:18px;height:18px}
.option:has(input:checked){background:var(--primary-soft);outline:1px solid var(--primary);outline-offset:-1px}
.option .grow{flex:1}.option .price{font-weight:600}
.panel{padding:12px 16px 16px;background:var(--surface);border-top:1px solid var(--border);color:var(--muted);font-size:.9375rem}
.panel pre{white-space:pre-wrap;font:inherit;color:var(--text);margin:8px 0 0}
.note{border:1px dashed var(--border);border-radius:var(--radius);padding:14px 16px;color:var(--muted)}
.btn{display:flex;width:100%;align-items:center;justify-content:center;min-height:52px;margin-top:24px;border:0;border-radius:var(--radius);background:var(--primary);color:#fff;font:inherit;font-weight:700;cursor:pointer}
.btn:hover{background:var(--primary-dark)}.btn[disabled]{opacity:.6;cursor:wait}
.btn.small{width:auto;min-height:46px;margin:0;padding:0 18px;background:#fff;color:var(--primary);border:1px solid var(--primary)}
.btn.small:hover{background:var(--primary-soft)}
.btn.link{display:inline;width:auto;min-height:0;margin:0;padding:0;background:none;color:var(--primary);text-decoration:underline;font-weight:400}
.errors{border:1px solid var(--danger);background:#fef2f2;color:var(--danger);border-radius:var(--radius);padding:12px 16px;margin-bottom:20px}
.errors:empty{display:none}.errors p{margin:0}
.lines{list-style:none;margin:0 0 16px;padding:0}
.line{display:flex;gap:12px;align-items:center;padding:8px 0}
.thumb{position:relative;flex:none;width:64px;height:64px;border:1px solid var(--border);border-radius:var(--radius);background:#fff}
.thumb img{width:100%;height:100%;object-fit:cover;border-radius:calc(var(--radius) - 1px)}
.thumb .qty{position:absolute;top:-8px;right:-8px;min-width:22px;height:22px;border-radius:99px;background:var(--muted);color:#fff;font-size:.75rem;line-height:22px;text-align:center}
.line .grow{flex:1}.line small{display:block;color:var(--muted)}
.disc{display:flex;gap:8px;margin:16px 0}.disc .field{flex:1;margin:0}
.msg{margin:-8px 0 12px;font-size:.875rem;color:var(--danger)}
.totals{margin:0;padding:12px 0 0;border-top:1px solid var(--border)}
.totals div{display:flex;justify-content:space-between;gap:12px;padding:4px 0}
.totals dt{color:var(--muted)}.totals dd{margin:0}
.totals .grand{font-size:1.25rem;font-weight:700;padding-top:12px}.totals .grand dt{color:var(--text)}
.tag{display:inline-flex;gap:6px;align-items:center;background:#e2e8f0;border-radius:99px;padding:2px 10px;font-size:.8125rem;margin:0 4px 4px 0}
.tag button{border:0;background:none;cursor:pointer;font:inherit;padding:0}
.ty{max-width:760px;margin:0 auto;padding:32px 16px 64px}
.card{border:1px solid var(--border);border-radius:var(--radius);padding:20px;margin:20px 0}
.card h2{margin-top:0}
.badge{display:inline-block;border-radius:99px;padding:2px 10px;font-size:.8125rem;background:#fef3c7;color:#92400e}.badge.ok{background:#dcfce7;color:#166534}
`;

export const JS = `
(function(){
var form=document.getElementById('checkout-form');if(!form)return;
var cfg=JSON.parse(document.getElementById('checkout-config').textContent);
var errors=document.getElementById('errors'),btn=document.getElementById('submit');
var provinces=cfg.provinces,timer=null,busy=false,stripe=null,elements=null,pending=null;
var $=function(s,r){return(r||document).querySelector(s)};
function showErrors(list){errors.innerHTML='';list.forEach(function(m){var p=document.createElement('p');p.textContent=m;errors.appendChild(p)});if(list.length){errors.scrollIntoView({block:'center'});}}
function data(){var fd=new FormData(form);var o={};fd.forEach(function(v,k){o[k]=v});return o}
function apply(r){
  if(r.shipping!==undefined){$('#shipping-methods').innerHTML=r.shipping}
  if(r.summary!==undefined){$('#summary-lines').innerHTML=r.summary}
  if(r.total!==undefined){var t=document.querySelectorAll('[data-total]');for(var i=0;i<t.length;i++)t[i].textContent=r.total}
  if(r.payments!==undefined){document.getElementById('payments').hidden=r.free;document.getElementById('free-note').hidden=!r.free}
  if(elements&&r.amount!==undefined&&r.amount>0)elements.update({amount:r.amount});
}
function refresh(extra){
  clearTimeout(timer);
  timer=setTimeout(function(){
    var body=data();if(extra)for(var k in extra)body[k]=extra[k];body.refresh='1';
    fetch(cfg.refreshUrl,{method:'POST',headers:{'content-type':'application/json',accept:'application/json'},body:JSON.stringify(body)})
      .then(function(r){return r.json()}).then(function(r){apply(r);var dm=$('#discount-msg');if(dm)dm.textContent=r.discountError||'';var gm=$('#gift-msg');if(gm)gm.textContent=r.giftError||'';if(extra&&extra.addGiftCardCode&&!r.giftError){var gi=$('#gift-input');if(gi)gi.value=''}if(extra&&extra.addDiscountCode&&!r.discountError){var i=$('#discount-input');if(i)i.value=''}}).catch(function(){});
  },extra?0:250);
}
form.addEventListener('change',function(e){var n=e.target.name;if(n==='countryCode')setProvinces();if(n!=='paymentMethod'&&n!=='acceptsMarketing'&&n!=='firstName'&&n!=='lastName'&&n!=='phone'&&n!=='company'&&n!=='address2')refresh();if(n==='paymentMethod')togglePanels()});
var em=document.getElementById('email');if(em)em.addEventListener('blur',function(){refresh()});
function setProvinces(){
  var c=form.elements.countryCode.value,box=document.getElementById('province-box');if(!box)return;
  var list=provinces[c],cur=(form.elements.provinceCode&&form.elements.provinceCode.value)||'';
  if(list){var h='<span>'+cfg.labels.province+'</span><select name="provinceCode" autocomplete="address-level1" required>';
    list.forEach(function(p){h+='<option value="'+p.code+'"'+(p.code===cur?' selected':'')+'>'+p.name+'</option>'});box.innerHTML=h+'</select>';}
  else{box.innerHTML='<span>'+cfg.labels.province+'</span><input name="province" autocomplete="address-level1">';}
}
function togglePanels(){var v=(form.querySelector('input[name=paymentMethod]:checked')||{}).value;
  document.querySelectorAll('[data-panel]').forEach(function(p){p.hidden=p.getAttribute('data-panel')!==v});}
togglePanels();
var sum=document.getElementById('summary'),tg=document.getElementById('summary-toggle');
if(sum&&tg){if(window.matchMedia('(max-width:899px)').matches){sum.classList.add('is-closed');tg.setAttribute('aria-expanded','false')}
  tg.addEventListener('click',function(){var c=sum.classList.toggle('is-closed');tg.setAttribute('aria-expanded',String(!c));tg.querySelector('[data-label]').textContent=c?cfg.labels.show:cfg.labels.hide})}
document.addEventListener('click',function(e){
  var a=e.target.closest('[data-discount-add]');if(a){e.preventDefault();var i=$('#discount-input');if(i&&i.value.trim())refresh({addDiscountCode:i.value.trim()});return}
  var ga=e.target.closest('[data-gift-add]');if(ga){e.preventDefault();var gi=$('#gift-input');if(gi&&gi.value.trim())refresh({addGiftCardCode:gi.value.trim()});return}
  var gr=e.target.closest('[data-gift-remove]');if(gr){e.preventDefault();refresh({removeGiftCardCode:gr.getAttribute('data-gift-remove')});return}
  var r=e.target.closest('[data-discount-remove]');if(r){e.preventDefault();refresh({removeDiscountCode:r.getAttribute('data-discount-remove')});}
});
var gin=document.getElementById('gift-input');if(gin)gin.addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();if(gin.value.trim())refresh({addGiftCardCode:gin.value.trim()})}});
var di=document.getElementById('discount-input');if(di)di.addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();if(di.value.trim())refresh({addDiscountCode:di.value.trim()})}});
if(cfg.stripe){
  var s=document.createElement('script');s.src='https://js.stripe.com/v3/';s.async=true;
  s.onload=function(){stripe=window.Stripe(cfg.stripe.publishableKey);
    elements=stripe.elements({mode:'payment',amount:Math.max(cfg.stripe.amount,1),currency:cfg.stripe.currency,appearance:{theme:'stripe',variables:{colorPrimary:'#1E40AF',borderRadius:'8px'}}});
    elements.create('payment').mount('#stripe-element')};
  document.head.appendChild(s);
}
form.addEventListener('submit',function(e){
  var method=(form.querySelector('input[name=paymentMethod]:checked')||{}).value;
  if(method!=='stripe'||!stripe)return; // regular POST
  e.preventDefault();if(busy)return;busy=true;btn.disabled=true;var label=btn.textContent;btn.textContent=cfg.labels.processing;
  var done=function(msgs){busy=false;btn.disabled=false;btn.textContent=label;showErrors(msgs||[cfg.labels.generic])};
  var confirm=function(r){return stripe.confirmPayment({elements:elements,clientSecret:r.clientSecret,confirmParams:{return_url:r.returnUrl}}).then(function(res){if(res&&res.error)done([res.error.message])})};
  elements.submit().then(function(r){
    if(r.error)return done([r.error.message]);
    if(pending)return confirm(pending); // the order exists already: retry the payment (e.g. after a declined card)
    return fetch(cfg.completeUrl,{method:'POST',headers:{'content-type':'application/json',accept:'application/json'},body:JSON.stringify(data())})
      .then(function(x){return x.json()}).then(function(r){
        if(!r.ok)return done(r.errors);
        pending=r;return confirm(r);
      });
  }).catch(function(){done()});
});
})();
`;
