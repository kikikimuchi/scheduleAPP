// チャットリプレイ診断: 指定動画の視聴ページを取得し、リプレイチャットのトークン有無を調べる。
// 実行: CHAT_IDS="id1,id2" node youtube-reader/gha-chat-probe.js
const IDS = (process.env.CHAT_IDS || 'aLRaaZwheFI,_Uw5RzvY9vE,z-jRZT6YCrE').split(',').map(s=>s.trim()).filter(Boolean);
const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const H={'User-Agent':UA,'Accept-Language':'ja,en;q=0.8','Cookie':'SOCS=CAISEwgDEgk0ODE3Nzk3MjQaAmphIAEaBgiAo_myBg; CONSENT=YES+cb; PREF=hl=ja&gl=JP'};

function extractInit(html){
  let i=html.indexOf('ytInitialData');if(i<0)return null;i=html.indexOf('{',i);if(i<0)return null;
  let d=0,s=false,e=false;for(let j=i;j<html.length;j++){const c=html[j];
    if(s){if(e)e=false;else if(c==='\\')e=true;else if(c==='"')s=false;}
    else if(c==='"')s=true;else if(c==='{')d++;else if(c==='}'){d--;if(d===0){try{return JSON.parse(html.slice(i,j+1));}catch(_){return null;}}}}
  return null;
}
function findKey(root,key){ // 最初に見つかった key の値
  let found=null;(function w(n){if(found||!n||typeof n!=='object')return;if(Array.isArray(n)){for(const x of n){w(x);if(found)return;}return;}
    if(key in n){found=n[key];return;}for(const k in n){w(n[k]);if(found)return;}})(root);return found;
}
function firstContinuation(obj){
  let t=null;(function w(n){if(t||!n||typeof n!=='object')return;if(Array.isArray(n)){for(const x of n){w(x);if(t)return;}return;}
    if(n.reloadContinuationData&&n.reloadContinuationData.continuation){t=n.reloadContinuationData.continuation;return;}
    if(n.continuation&&typeof n.continuation==='string'){t=n.continuation;return;}
    for(const k in n){w(n[k]);if(t)return;}})(obj);return t;
}

async function probe(id){
  console.log(`\n===== ${id} =====`);
  try{
    const r=await fetch(`https://www.youtube.com/watch?v=${id}`,{headers:H,redirect:'follow'});
    console.log('watch HTTP',r.status);
    const html=await r.text();
    const data=extractInit(html);
    if(!data){console.log('ytInitialData取得失敗');return;}
    const s=JSON.stringify(data);
    console.log('liveStreamingか(過去ライブ):', /"isLiveContent":true/.test(s)||/watching now|人が視聴|配信済み|streamed/i.test(s));
    const conv=findKey(data,'conversationBar');
    console.log('conversationBar:', !!conv);
    const lcr=conv?findKey(conv,'liveChatRenderer'):null;
    console.log('liveChatRenderer:', !!lcr);
    console.log('isReplay文字列:', /"isReplay":true/.test(s));
    const tok=lcr?firstContinuation(lcr):null;
    console.log('リプレイ継続トークン:', tok?('取得OK 長さ'+tok.length):'なし');
    if(tok)console.log('   token先頭:', tok.slice(0,40));
    // 埋め込みURLの応答も見る
    for(const path of ['live_chat','live_chat_replay']){
      try{const cr=await fetch(`https://www.youtube.com/${path}?v=${id}&embed_domain=kikikimuchi.github.io`,{headers:H});
        const ct=await cr.text();
        console.log(`  ${path}?v= : HTTP ${cr.status} / SomethingWentWrong=${/Something went wrong|問題が発生/i.test(ct)} / len=${ct.length}`);
      }catch(e){console.log(`  ${path}?v= err`,e.message);}
    }
    if(tok){try{const cr=await fetch(`https://www.youtube.com/live_chat_replay?continuation=${encodeURIComponent(tok)}&embed_domain=kikikimuchi.github.io`,{headers:H});
      const ct=await cr.text();
      console.log(`  live_chat_replay?continuation= : HTTP ${cr.status} / SomethingWentWrong=${/Something went wrong|問題が発生/i.test(ct)} / len=${ct.length}`);
    }catch(e){}}
  }catch(e){console.log('err',e.message);}
}
(async()=>{ for(const id of IDS) await probe(id); console.log('\n=== done ==='); })();
