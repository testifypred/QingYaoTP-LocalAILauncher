/**
 * 「@ 第二意见」端到端探针：需要真加载模型，耗时约 1-3 分钟。
 * 用法: node probe-second-opinion.mjs [base]
 *
 * 验证点：
 *  1) 主模型能加载
 *  2) 第二意见事件流顺序完整：loading → thinking → answer → restoring → done
 *  3) 确实拿到内容，且模型名对得上
 *  4) 结束后主模型被换回来（这一条最关键，错了下次提问会打到别人的权重上）
 *  5) 换回来之后主模型仍能正常对话
 */
const BASE = process.argv[2] || 'http://127.0.0.1:8098';
const MAIN = 'qwen2.5-7b-instruct-1m-q4_k_m.gguf';
const SECOND = 'Phi-4-mini-instruct-Q4_K_M.gguf';

let pass = 0;
let fail = 0;
function ok(name, cond, extra = '') {
  if (cond) { pass += 1; console.log(`  ✅ ${name}${extra ? ' — ' + extra : ''}`); }
  else { fail += 1; console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`); }
}
const t = () => new Date().toISOString().slice(11, 19);

async function state() {
  return (await (await fetch(BASE + '/api/state')).json());
}

console.log(`\n== 目标 ${BASE} ==\n`);

// ---- 1. 加载主模型 ----
console.log(`${t()} 加载主模型 ${MAIN} …`);
{
  const t0 = Date.now();
  const r = await fetch(BASE + '/api/load', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ file: MAIN, contextSize: 8192 }),
  });
  const j = await r.json();
  ok('主模型加载成功', r.status === 200, `${((Date.now() - t0) / 1000).toFixed(1)}s`);
  if (r.status !== 200) { console.log(j); process.exit(1); }
}

// ---- 2. 先问一轮，建立 KV 缓存与会话 ----
{
  const r = await fetch(BASE + '/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      messages: [
        { role: 'system', content: '你是一个中文助手，回答简短。' },
        { role: 'user', content: '用一句话说明磁盘和内存的区别。' },
      ],
      max_tokens: 160,
      temperature: 0.3,
      stream: false,
    }),
  });
  const j = await r.json();
  ok('主模型能回答', r.status === 200 && !!j.choices?.[0]?.message?.content, (j.choices?.[0]?.message?.content || '').slice(0, 40));
}

// ---- 3. 征询第二意见 ----
console.log(`${t()} 征询第二意见 ${SECOND} …`);
const phases = [];
let answer = null;
let answerModel = '';
let doneEvent = null;
const t1 = Date.now();
{
  const r = await fetch(BASE + '/api/second-opinion', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      models: [SECOND],
      messages: [
        { role: 'user', content: '用一句话说明磁盘和内存的区别。' },
        { role: 'assistant', content: '内存是断电就没的临时工作区，磁盘是断电还在的长期仓库。' },
        { role: 'user', content: '（以上是主模型的回答。请你以「第二意见」的身份发言，只补充差异，300 字以内。）' },
      ],
      max_tokens: 300,
      temperature: 0.3,
    }),
  });
  ok('接口 200', r.status === 200);
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split('\n\n');
    buf = parts.pop();
    for (const p of parts) {
      const line = p.replace(/^data:\s*/, '').trim();
      if (!line) continue;
      let ev;
      try { ev = JSON.parse(line); } catch { continue; }
      phases.push(ev.phase);
      if (ev.phase === 'answer') { answer = ev.content; answerModel = ev.model; }
      if (ev.phase === 'done') doneEvent = ev;
      if (ev.phase === 'error') console.log('   服务端 error:', ev.message);
    }
  }
}
const secs = ((Date.now() - t1) / 1000).toFixed(1);
ok('事件流顺序正确', phases.join(',') === 'loading,thinking,answer,restoring,done', phases.join(','));
ok('拿到了第二意见内容', typeof answer === 'string' && answer.trim().length > 0, (answer || '').slice(0, 50));
ok('作答模型是被 @ 的那个', answerModel === SECOND, answerModel);
ok('done 报告已恢复主模型', doneEvent?.restored === true);
ok('耗时记录', true, secs + 's');

// ---- 4. 主模型必须被换回来 ----
{
  const s = await state();
  ok('当前加载的是主模型', s.loaded === MAIN, String(s.loaded));
}

// ---- 5. 恢复后仍能正常对话（KV 已冷，会重新预填充）----
console.log(`${t()} 恢复后再次对话 …`);
{
  const r = await fetch(BASE + '/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      messages: [
        { role: 'system', content: '你是一个中文助手，回答简短。' },
        { role: 'user', content: '再说一句话：SSD 比机械硬盘快在哪里？' },
      ],
      max_tokens: 160,
      temperature: 0.3,
      stream: false,
    }),
  });
  const j = await r.json();
  ok('主模型恢复后仍能回答', r.status === 200 && !!j.choices?.[0]?.message?.content, (j.choices?.[0]?.message?.content || '').slice(0, 40));
  ok('指标里有预填充耗时', typeof j.metrics?.prefillMs === 'number', String(j.metrics?.prefillMs));
}

console.log(`\n== 结果: ${pass} 通过 / ${fail} 失败 ==\n`);
process.exit(fail ? 1 : 0);
