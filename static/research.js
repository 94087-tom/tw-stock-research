'use strict';
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pct=v=>v==null?'—':(v*100).toFixed(1)+'%';
let historyVersion=0;
let auditData=null,auditLimit=20;
async function api(path,body){
 if(body)throw new Error('免費展示版只提供已保存結果，不執行匯入或重算。');
 const target=window.PAGES_ROUTES[path];if(!target)throw new Error('本次快照未包含此資料');
 const response=await fetch(target);if(!response.ok)throw new Error('快照讀取失敗');return response.json();
}
function message(text){$('message').hidden=!text;$('message').textContent=text;}
function table(headers,rows){return `<table><thead><tr>${headers.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(v=>`<td>${v}</td>`).join('')}</tr>`).join('')}</tbody></table>`;}
function cards(items){return items.map(([title,value,note])=>`<article class="metric"><div class="label">${esc(title)}</div><strong>${esc(value)}</strong><small>${esc(note)}</small></article>`).join('');}
function plot(container,rows,keys,scale=1){
  if(rows.length<2){$(container).innerHTML='<p class="chart-empty">至少需要兩筆資料才能畫出趨勢。</p>';return;}
  const width=800,height=280,left=64,right=18,top=20,bottom=38;
  const values=rows.flatMap(r=>keys.map(k=>r[k]==null?null:r[k]/scale)).filter(v=>v!=null&&Number.isFinite(v));
  const low=Math.min(0,...values),high=Math.max(1,...values),span=high-low;
  const x=i=>left+i/(rows.length-1)*(width-left-right),y=v=>top+(high-v)/span*(height-top-bottom);
  let content='';
  for(let i=0;i<=4;i++){const v=low+span*i/4,yy=y(v);content+=`<line x1="${left}" x2="${width-right}" y1="${yy}" y2="${yy}" stroke="#e3e9eb"/><text x="${left-8}" y="${yy+4}" text-anchor="end" fill="#65758c" font-size="12">${v.toLocaleString('zh-TW',{maximumFractionDigits:0})}</text>`;}
  keys.forEach((key,index)=>{let points=[];const flush=()=>{if(points.length)content+=`<polyline points="${points.join(' ')}" fill="none" stroke="${index?'#dfc18b':'#8bbcff'}" stroke-width="2.3"/>`;points=[];};rows.forEach((r,i)=>{if(r[key]==null){flush();return;}points.push(`${x(i).toFixed(1)},${y(r[key]/scale).toFixed(1)}`);});flush();});
  [...new Set([0,Math.floor(rows.length/3),Math.floor(rows.length*2/3),rows.length-1])].forEach(i=>{content+=`<text x="${x(i)}" y="${height-8}" text-anchor="${i===0?'start':i===rows.length-1?'end':'middle'}" fill="#65758c" font-size="12">${esc(rows[i].date.slice(0,7))}</text>`;});
  $(container).innerHTML=`<svg class="line-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${container==='history-chart'?'十年營收與淨利趨勢，精確數值見下方表格':'策略與買入持有累積指數，精確結果見下方表格'}"><title>完整期間 ${esc(rows[0].date)} 至 ${esc(rows.at(-1).date)}</title>${content}</svg>`;
}
async function loadHistory(){
  const version=++historyVersion,ticker=$('company').value;
  loadAudit(ticker,version);
  $('history-chart').textContent='讀取歷史資料…';$('history-table').replaceChildren();$('coverage').replaceChildren();
  try{const data=await api(`/api/history/${ticker}`);if(version!==historyVersion)return;
    $('coverage').innerHTML=cards([['損益表',`${data.coverage.income.present} / ${data.coverage.income.expected}`,'季報筆數'],['資產負債表',`${data.coverage.balance.present} / ${data.coverage.balance.expected}`,'季報筆數'],['現金流量表',`${data.coverage.cash_flow.present} / ${data.coverage.cash_flow.expected}`,'來源原值 · 口徑待核對'],['每日行情',data.prices.count.toLocaleString(),'有效收盤價筆數']]);
    $('download').href=`/api/history/${ticker}/export.csv`;
    const income=data.records.filter(r=>r.statement==='income').map(r=>({date:r.period_end,revenue:r.metrics.revenue,net_income:r.metrics.net_income}));plot('history-chart',income,['revenue','net_income'],1e8);
    const grouped={};data.records.forEach(r=>{grouped[r.period_end]??={};grouped[r.period_end][r.statement]=r;});
    const amount=v=>v==null?'缺值':(v/1e8).toLocaleString('zh-TW',{maximumFractionDigits:2});
    $('history-table').innerHTML=table(['季末','營收（億）','淨利（億）','資產（億）','負債（億）','營業現金流來源值（億）','來源'],Object.entries(grouped).reverse().map(([period,r])=>[esc(period),amount(r.income?.metrics.revenue),amount(r.income?.metrics.net_income),amount(r.balance?.metrics.assets),amount(r.balance?.metrics.liabilities),amount(r.cash_flow?.metrics.operating_cash_flow),Object.entries(r).map(([kind,v])=>`<a href="/api/history/snapshot/${encodeURIComponent(v.snapshot_id)}" target="_blank" rel="noopener">${{income:'損益',balance:'資負',cash_flow:'現流'}[kind]}</a>`).join(' / ')]));
    if(data.records.length===0)message('此公司尚未匯入歷史資料。');
  }catch(error){if(version===historyVersion){$('history-chart').textContent='無法取得歷史資料。';message(error.message);}}
}
async function loadAudit(ticker,version){
  auditData=null;auditLimit=20;$('indicator-groups').replaceChildren();$('audit-filter').value='review';
  $('audit-export').href=`/api/history/${ticker}/audit.zip`;
  $('audit-more').hidden=true;$('audit-shown').textContent='';
  $('audit-summary').textContent='正在查核已匯入財報…';$('audit-findings').replaceChildren();$('audit-counts').replaceChildren();$('audit-limits').replaceChildren();
  try{const data=await api(`/api/history/${ticker}/audit`);if(version!==historyVersion)return;
    $('audit-summary').textContent=`${$('company').selectedOptions[0].textContent}：${data.summary} 官方原文涵蓋 ${data.official_coverage?.available??0} / ${data.official_coverage?.expected??data.periods} 期（含暖身期間）。`;
    $('audit-counts').innerHTML=cards([['待查線索',data.counts.review,'需人工追查，不等於造假'],['規則未觸發',data.counts.consistent,'不代表資訊真實'],['證據缺口',data.counts.missing,'缺值或口徑待核對'],['涵蓋期間',data.periods,'已匯入財報期數']]);
    auditData=data;renderIndicators(data.indicator_groups||[]);renderAudit();
    $('audit-limits').innerHTML=[...data.limitations,...(data.filing_errors||[]).map(e=>'原文完整性或解析失敗：'+e.sha256+' '+e.detail)].map(t=>`<li>${esc(t)}</li>`).join('');
  }catch(error){if(version===historyVersion)$('audit-summary').textContent='查核失敗：'+error.message;}
}
function evidenceTable(e){
  const names={assets:'資產（元）',liabilities:'負債（元）',equity:'權益（元）',difference:'差額（元）',tolerance:'容許誤差（元）',net_income:'單季淨利（元）',operating_cash_flow:'單季營業現金流（元）',current:'本期科目金額（元）',prior:'去年同季科目金額（元）',revenue:'本期營收（元）',prior_revenue:'去年同季營收（元）',growth:'科目年增率',revenue_growth:'營收年增率',gap:'增速差距（百分點）',observed_versions:'已觀察來源版本數'};
  Object.assign(names,{ytd_net_income:'累計淨利（元）',ytd_operating_cash_flow:'累計營業現金流（元）',cash_profit_ratio:'營業現金流／淨利（倍）',start_date:'期間起日',end_date:'期間末日',profit_context:'淨利原文 context',cash_context:'現金流原文 context',auditor_firm:'會計師事務所',report_date:'報告日期',report_kind:'報告種類',opinion:'來源意見',integrity_valid:'快照完整性',stored_sha256:'保存時指紋',calculated_sha256:'本次重算指紋'});
  const rows=Object.entries(e).filter(([k])=>k!=='changes'&&k!=='report_body').map(([k,v])=>[esc(names[k]||k),esc(k==='report_kind'?({audit:'年度查核',review:'期中核閱',other:'待判讀'}[v]||v):k==='integrity_valid'?(v?'一致（非真實性認證）':'未通過'):k==='gap'?(v*100).toFixed(2):['growth','revenue_growth'].includes(k)?pct(v):typeof v==='number'?v.toLocaleString('zh-TW',{maximumFractionDigits:2}):v==null?'未提供':v)]);
  let html=rows.length?table(['查核數值','金額／結果'],rows):'<p>尚無足夠數值可計算。</p>';
  if(e.report_body)html+=`<details><summary>會計師報告全文（公司申報原文）</summary><p style="white-space:pre-wrap">${esc(e.report_body)}</p></details>`;
  for(const c of e.changes||[]){html+=`<p>版本比較：<a href="/api/history/snapshot/${encodeURIComponent(c.before_snapshot)}" target="_blank" rel="noopener">先前來源</a> → <a href="/api/history/snapshot/${encodeURIComponent(c.after_snapshot)}" target="_blank" rel="noopener">後來來源</a></p>`+table(['來源欄位','變動類型','先前值','後來值'],Object.entries(c.fields).map(([k,v])=>[esc(k),esc({added:'新增',removed:'移除',changed:'改值'}[v.kind]||'改值'),v.before_present===false?'未提供':v.before===null?'空值':esc(v.before),v.after_present===false?'未提供':v.after===null?'空值':esc(v.after)]));}
  return html;
}
function renderAudit(){
  if(!auditData)return;
  const labels={review:'待查線索',consistent:'規則未觸發',missing:'證據不足',info:'觀察紀錄'};
  const names={balance:'資產負債表',income:'損益表',cash_flow:'現金流量表',official_filing:'官方合併報表',year_to_date:'年初至季末累計',TWD:'新臺幣元',single_quarter:'單季',point_in_time:'季末時點',source_reported_unverified:'來源口徑待核對'};
  const findings=auditData.findings.filter(f=>$('audit-filter').value==='all'||f.status===$('audit-filter').value);
  $('audit-findings').innerHTML=findings.slice(0,auditLimit).map(f=>`<details><summary>${esc(labels[f.status])} ｜ ${esc(f.period||'全部期間')} ｜ ${esc(f.rule.replace('balance','資產負債表').replace('cash_flow','現金流量表').replace('income','損益表'))}</summary><p>${esc(f.detail)}</p><p>判斷依據：${esc(f.formula)}</p><p>下一步：${esc(f.followup)}</p><p>${f.statements.map(s=>esc(`${names[s.statement]||s.statement} ${s.period} · ${names[s.unit]||s.unit} · ${names[s.basis]||s.basis}`)).join('<br>')}</p><div class="table-scroll">${evidenceTable(f.evidence)}</div><p>${f.sources.map(s=>`<a href="${esc(s.snapshot_url)}" target="_blank" rel="noopener">來源原文 ${esc(s.id.slice(0,8))}</a> ${esc(s.fetched_at||'時間未知')}`).join('<br>')||'尚無可用來源'}</p></details>`).join('')||'<p>此分類沒有項目；仍需查看證據不足與查核限制。</p>';
  $('audit-more').hidden=findings.length<=auditLimit;
  $('audit-shown').textContent=`顯示 ${Math.min(auditLimit,findings.length)} / ${findings.length} 項`;
}
$('audit-filter').addEventListener('change',()=>{auditLimit=20;renderAudit();});
$('audit-more').addEventListener('click',()=>{auditLimit+=20;renderAudit();});
function renderRun(data){
  const m=data.metrics,b=data.benchmark,c=data.config;
  $('verdict').textContent=m.total_return>b.total_return?'這組規則在本次樣本高於買入持有，但資料與選樣限制仍在。':'這組規則在本次樣本沒有打敗買入持有；目前沒有證據支持它比較好。';
  $('run-info').textContent=`${c.start} 至 ${c.end} ｜ ${c.strategy==='ma_10_30'?'10／30日均線 · 次交易日收盤成交':'財務條件 · 季末後 '+c.lag_days+' 天假設'} ｜ ${c.version} ｜ 執行紀錄 ${data.id}`;
  $('strategy-rule').textContent=c.rule;
  $('strategy-legend').textContent=c.strategy==='ma_10_30'?'10／30日均線策略':'財務條件策略';
  $('performance').innerHTML=cards([['策略累積試算',pct(m.total_return),'已扣交易成本'],['買入持有試算',pct(b.total_return),'同一批公司、同一價格口徑'],['策略年化試算',pct(m.cagr),'按實際日數年化'],['策略最大回落',pct(m.max_drawdown),'每日曲線計算']]);
  plot('equity-chart',data.curve,['strategy','benchmark'],.01);
  $('company-results').innerHTML=table(['公司','策略試算','買入持有','策略最大回落','買賣次數','有效訊號覆蓋'],data.companies.map(r=>[esc(r.name+' '+r.ticker),pct(r.metrics.total_return),pct(r.metrics.benchmark.total_return),pct(r.metrics.max_drawdown),r.metrics.trades,pct(r.metrics.signal_coverage)]));
  $('annual').innerHTML=table(['年度','策略試算','買入持有'],data.annual.map(r=>[r.year,pct(r.strategy),pct(r.benchmark)]));
  $('sensitivity').innerHTML=table(['可用時間','成本倍數¹','策略試算'],data.sensitivity.map(r=>[r.lag_days==null?'次交易日收盤':r.lag_days+' 天',r.cost_multiplier_excluding_tax+'×',pct(r.total_return)]))+'<p class="metadata">¹ 手續費與滑價倍數；賣出交易稅固定。完整呈現各情境，未挑最高報酬。</p>';
  const trades=data.companies.flatMap(r=>r.trades.map(t=>({...t,ticker:r.ticker}))).sort((a,b)=>a.date.localeCompare(b.date));
  $('trades').innerHTML=table(['成交日','公司','操作','原始收盤價','訊號所屬日','可用日／假設日','原因'],trades.map(r=>[r.date,r.ticker,r.side==='buy'?'買進':'賣出',r.raw_close,r.signal_period,r.available_on_assumed,esc(r.reason)]));
  $('limits').innerHTML=data.warnings.map(w=>`<li>${esc(w)}</li>`).join('');
}
async function loadRun(){try{renderRun(await api('/api/research/latest'));}catch(error){$('verdict').textContent=error.message;}}
$('company').addEventListener('change',loadHistory);
$('strategy').addEventListener('change',()=>{$('lag').disabled=$('strategy').value==='ma_10_30';});
$('run-form').addEventListener('submit',async e=>{e.preventDefault();$('run').disabled=true;message('正在使用本機資料庫重新計算…');try{const data=await api('/api/research/run',{strategy:$('strategy').value,lag_days:Number($('lag').value),strict:$('mode').value==='strict'});renderRun(data);message('回測已保存。結果包含時間與價格口徑假設，請一起閱讀限制。');}catch(error){message(error.message+'。下方保留上次成功的試算結果。');}finally{$('run').disabled=false;}});
$('import').addEventListener('click',async()=>{$('import').disabled=true;message('開始匯入歷史資料；已有來源快照會直接重用。');try{const job=await api('/api/history/import',{});let done=false;for(let i=0;i<160;i++){await new Promise(r=>setTimeout(r,1500));const state=await api('/jobs/'+job.job_id);if(state.status==='failed')throw new Error('部分資料未完成，已成功資料會保留；可重新匯入重試。');if(state.status==='completed'){done=true;break;}message(`匯入中，已完成 ${state.detail.completed_datasets||0} 個資料集。`);}if(!done)throw new Error('工作仍在背景執行，稍後重載頁面查看。');await loadHistory();message('歷史資料匯入完成。可按「重新回測」使用資料庫重算。');}catch(error){message(error.message);}finally{$('import').disabled=false;}});
loadHistory();loadRun();

function renderIndicators(groups){
  const labels={review:'待查線索',missing:'證據不足',consistent:'規則未觸發',info:'觀察紀錄'};
  $('indicator-groups').innerHTML=groups.map(g=>`<article class="indicator-card"><h3>${esc(g.title)}</h3><strong>${esc(labels[g.status])}</strong><p>最新已匯入期間：${esc(g.latest_period||'尚無資料')}</p><p>歷史 ${g.observed_periods} 期中，${g.review_periods} 期有待查線索（非造假件數）。</p><p>${esc(g.next_step)}</p>${g.current.map(f=>`<details><summary>${esc(f.rule)}：${esc(labels[f.status])}</summary><p>${esc(f.detail)}</p><p>${esc(f.formula)}</p><div class="table-scroll">${evidenceTable(f.evidence)}</div><p>${f.sources.map(x=>`<a href="${esc(x.snapshot_url)}" target="_blank" rel="noopener">來源原文 ${esc(x.id.slice(0,8))}</a>`).join(" / ")}</p></details>`).join('')}<details><summary>歷年比較與來源</summary><p>增速差距＝科目年增率減營收年增率；空白表示不適用或不可計算。</p><div class="table-scroll">${indicatorTimeline(g,labels)}</div></details><p class="section-note">${g.limitations.map(esc).join(' ')}</p></article>`).join('');
}

function indicatorTimeline(g,labels){
  const cash=g.id==='cash';
  const headers=cash?['期末（年初起累計）','結果','淨利（億）','營業現金流（億）','現金流／淨利（倍）','來源']:['期間','項目','結果','增速差距（百分點）','來源'];
  const amount=v=>v==null?'—':(v/1e8).toFixed(2);
  return table(headers,g.timeline.slice().reverse().map(t=>[...(cash?[esc(t.period),esc(labels[t.status]),amount(t.ytd_net_income),amount(t.ytd_operating_cash_flow),t.cash_profit_ratio==null?'—':t.cash_profit_ratio.toFixed(2)]:[esc(t.period),esc(t.rule),esc(labels[t.status]),t.gap==null?'—':(t.gap*100).toFixed(2)]),t.sources.map(x=>`<a href="${esc(x.snapshot_url)}" target="_blank" rel="noopener">${esc(x.id.slice(0,8))}</a>`).join(' / ')]));
}

async function loadLegacyValidation(){
  const labels={execution_failed:'工具未完成',issues_found:'發現待查問題',warnings_found:'有警告待確認',no_issues_reported:'未回報問題（非真實性認證）'};
  const describe=m=>m?`${esc(labels[m.status]||'未知狀態')}<br>錯誤紀錄 ${Object.values(m.errors||{}).reduce((a,b)=>a+b,0)} 筆`:'缺少結果';
  const sourceLink=(url,label)=>{try{const u=new URL(url);if(u.protocol==='https:'&&u.hostname==='mopsov.twse.com.tw')return `<a href="${esc(u.href)}" target="_blank" rel="noopener">${label}</a>`;}catch{}return '來源網址待確認';};
  try{
    const response=await fetch('static/legacy-validation.json',{cache:'no-store'});
    if(!response.ok)throw new Error('無法讀取驗證摘要');
    const data=await response.json();
    $('legacy-status').textContent=`${data.tool} ${data.version} ｜ ${data.samples.length} 份樣本 ｜ 檢查時間 ${data.checked_at}。錯誤筆數是工具紀錄數，不是造假件數。`;
    $('legacy-results').innerHTML=table(['樣本','結構檢查','計算驗證'],data.samples.map(s=>[esc(s.sample),describe(s.modes.find(m=>m.mode==='none')),describe(s.modes.find(m=>m.mode==='xbrl21'))]));
    $('legacy-sources').innerHTML=data.samples.map(s=>`<details><summary>${esc(s.sample)} 來源</summary><p>${sourceLink(s.source_url,'官方財報原文')} ／ ${sourceLink(s.taxonomy_url,'官方分類標準')}</p><p style="overflow-wrap:anywhere">原文 SHA-256：${esc(s.source_sha256)}<br>分類標準 ZIP SHA-256：${esc(s.taxonomy_sha256)}</p>${s.modes.map(m=>`<p>${esc(m.mode)}：${Object.entries(m.errors||{}).map(([k,v])=>`${esc(k)} (${esc(v)})`).join('；')||'沒有錯誤紀錄；仍須確認工具完成狀態'}</p>`).join('')}</details>`).join('');
    $('legacy-limits').innerHTML=data.limitations.map(x=>`<li>${esc(x)}</li>`).join('');
  }catch(error){$('legacy-status').textContent='驗證結果讀取失敗：'+error.message;}
}
loadLegacyValidation();
