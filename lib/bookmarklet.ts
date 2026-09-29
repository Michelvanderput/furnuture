/**
 * The "Product naar furnuture" bookmark: runs on a shop's product page in the user's
 * own browser (where the shop's bot check passes) and sends name, price and photo
 * to the app as #product={u,t,p,i}.
 *
 * Shops put their data in different places, so it looks in turn at: structured data
 * (JSON-LD, also nested), microdata, the shop's tracking data (dataLayer), and last
 * at what is on screen: the largest price near the top that is not struck through,
 * and the largest product photo. No price found: it asks.
 *
 * Kept as plain JavaScript in a string (no backticks, no ${…}) so the production
 * build cannot rewrite it; APP is replaced by the app's address.
 */
const SOURCE = String.raw`(function(){
var APP="__APP__";
function meta(n){var e=document.querySelector('meta[property="'+n+'"],meta[name="'+n+'"],meta[itemprop="'+n+'"]');return e?(e.getAttribute("content")||""):"";}
function types(o){return [].concat(o&&o["@type"]||[]).join(" ");}
var found=null;
function walk(o,d){if(!o||typeof o!=="object"||d>8||found)return;if(Array.isArray(o)){o.forEach(function(x){walk(x,d+1)});return;}if(/Product/.test(types(o))){found=o;return;}for(var k in o){if(o[k]&&typeof o[k]==="object")walk(o[k],d+1);}}
document.querySelectorAll('script[type="application/ld+json"]').forEach(function(s){try{walk(JSON.parse(s.textContent),0)}catch(e){}});
var P=found||{};
if(P.hasVariant&&!P.offers){var v=[].concat(P.hasVariant).filter(function(x){return x&&x.offers})[0];if(v){P.offers=v.offers;P.image=P.image||v.image;}}
function offerPrice(of,d){var list=[].concat(of||[]);for(var i=0;i<list.length;i++){var o=list[i];if(!o||typeof o!=="object")continue;var sp=[].concat(o.priceSpecification||[])[0]||{};var p=o.price||o.lowPrice||sp.price;if(p)return String(p);if(o.offers&&d<2){var q=offerPrice(o.offers,d+1);if(q)return q;}}return "";}
var price=offerPrice(P.offers,0)||meta("product:price:amount")||meta("og:price:amount")||meta("price");
if(!price){var mp=document.querySelector('[itemprop="price"]');if(mp)price=mp.getAttribute("content")||mp.textContent||"";}
function fromLayer(){var dl=window.dataLayer||[];for(var i=dl.length-1;i>=0;i--){var x=dl[i]||{};var ec=x.ecommerce||{};var items=ec.items||(ec.detail&&ec.detail.products)||(x.items)||[];var it=[].concat(items)[0];if(it&&(it.price||it.item_price))return String(it.price||it.item_price);if(ec.value)return String(ec.value);}return "";}
if(!price)price=fromLayer();
function visible(e){var r=e.getBoundingClientRect();return r.width>0&&r.height>0&&r.top<innerHeight*1.6;}
function struck(e){for(var n=e;n&&n!==document.body;n=n.parentElement){var cs=getComputedStyle(n);if(/line-through/.test(cs.textDecorationLine||cs.textDecoration))return true;if(/(^|[-_\s])(old|was|from|strike|previous|original|advies|list)/i.test(n.className&&n.className.baseVal===undefined?n.className:""))return true;}return false;}
function readPrice(e){var parts=[];e.childNodes.forEach(function(n){var t=(n.textContent||"").replace(/\s+/g,"").replace(/^(€|EUR)/,"");if(t)parts.push(t);});
if(parts.length>=2&&/^\d{1,5}[,.]?$/.test(parts[0])&&/^[,.]?(\d{2}|-{1,2})$/.test(parts[1])){var c=parts[1].replace(/[,.]/,"");return parts[0].replace(/[,.]$/,"")+"."+(c.indexOf("-")>=0?"00":c);}
var t=(e.innerText||e.textContent||"").replace(/\s+/g," ").replace(/(\d) ?([,.]) ?(\d{2}|-)/g,"$1$2$3");var m=t.match(/(?:€|EUR)?\s*(\d{1,3}(?:[.\s]\d{3})+|\d{1,5})(?:([,.])(\d{2}|-{1,2}))?/);if(!m)return "";var whole=m[1].replace(/[.\s]/g,"");var cents=m[3]&&m[3].indexOf("-")<0?m[3]:"00";return whole+"."+cents;}
if(!price){var best=null;document.querySelectorAll('[class*="price" i],[class*="prijs" i],[data-testid*="price" i],[id*="price" i]').forEach(function(e){if(!visible(e)||struck(e))return;if(e.querySelector('[class*="price" i],[class*="prijs" i]')&&e.children.length>3)return;var v=readPrice(e);if(!v||parseFloat(v)<=0)return;var fs=parseFloat(getComputedStyle(e).fontSize)||0;var top=e.getBoundingClientRect().top;var score=fs*10-top/100;if(!best||score>best.s)best={v:v,s:score};});if(best)price=best.v;}
var img=[].concat(P.image||[])[0];if(img&&typeof img==="object")img=img.url||img.contentUrl||"";
img=img||meta("og:image")||meta("twitter:image")||meta("image");
if(!img){var l=document.querySelector('link[rel="image_src"]');if(l)img=l.href;}
if(!img){var big=null;document.querySelectorAll("img").forEach(function(im){var r=im.getBoundingClientRect();var a=r.width*r.height;if(!im.currentSrc&&!im.src)return;if(r.width<150||r.height<150||r.top>innerHeight*1.5)return;if(/logo|icon|sprite|avatar|banner|payment/i.test(im.currentSrc||im.src))return;if(!big||a>big.a)big={a:a,src:im.currentSrc||im.src};});if(big)img=big.src;}
var h1=document.querySelector("h1");
var title=P.name||(h1&&h1.innerText.trim())||meta("og:title")||document.title;
if(!price){var typed=prompt("De prijs van dit product werd niet gevonden. Wat kost het? (mag leeg)","");if(typed)price=typed;}
var d={u:location.href.split("#")[0],t:String(title).slice(0,200),p:String(price||""),i:img?new URL(img,location.href).href:""};
location.href=APP+"/#product="+encodeURIComponent(JSON.stringify(d));
})()`;

/** The bookmark's address (javascript:…) for this app. */
export const bookmarkletUrl = (app: string) => `javascript:${encodeURIComponent(SOURCE.replace("__APP__", app.replace(/"/g, "")))}`;

/** The plain code (for tests). */
export const bookmarkletCode = (app: string) => SOURCE.replace("__APP__", app.replace(/"/g, ""));
