/**
 * 多会话接口 + 第二意见接口的回归探针（不需要加载模型）
 * 用法: node probe-sessions.mjs [base]
 */
const BASE = process.argv[2] || 'http://127.0.0.1:8098';

let pass = 0;
let fail = 0;
function ok(name, cond, extra = '') {
  if (cond) { pass += 1; console.log(`  ✅ ${name}${extra ? ' — ' + extra : ''}`); }
  else { fail += 1; console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`); }
}

async function j(method, path, body) {
  const r = await fetch(BASE + path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let data = null;
  try { data = JSON.parse(text); } catch {}
  return { status: r.status, data, text };
}

console.log(`\n== 目标 ${BASE} ==\n`);

// 1) 首页仍可访问，且带上了新的侧栏与 @ 按钮
{
  const r = await fetch(BASE + '/');
  const html = await r.text();
  ok('首页 200', r.status === 200);
  ok('侧栏容器存在', html.includes('id="sidebar"'));
  ok('@ 按钮存在', html.includes('id="atBtn"'));
  ok('朗读选项卡存在', html.includes('data-tab="tts"'));
  ok('底部旧朗读条已移除', !html.includes('id="ttsBox"'));
  ok('设置里有音色下拉', html.includes('id="setTtsVoice"'));
  ok('设置里有语速滑块', html.includes('id="setTtsSpeed"'));
}

// 2) 列表
{
  const r = await j('GET', '/api/sessions');
  ok('GET /api/sessions 200', r.status === 200);
  ok('返回 sessions 数组', Array.isArray(r.data?.sessions));
  ok('返回存储目录', typeof r.data?.dir === 'string', r.data?.dir);
}

// 3) 新建
let id = null;
{
  const r = await j('POST', '/api/sessions', {});
  ok('POST 新建 200', r.status === 200);
  id = r.data?.id;
  ok('拿到 id', typeof id === 'string' && id.length >= 6, id);
  ok('新会话标题为空（等首句推导）', r.data?.title === '');
  ok('新会话展示标题为「新对话」', r.data?.displayTitle === '新对话', r.data?.displayTitle);
}

// 4) 写入消息 → 标题应按首句推导，且不写死
{
  const msgs = [
    { role: 'user', content: '  帮我比较一下   Vulkan 和 CPU 推理的差别  ', t: Date.now() },
    { role: 'assistant', content: 'Vulkan 更快但存储占用高。', t: Date.now() },
  ];
  const r = await j('PUT', `/api/sessions/${id}`, { messages: msgs, model: 'qwen2.5-7b-instruct-1m-q4_k_m.gguf' });
  ok('PUT 保存 200', r.status === 200);
  ok('title 字段仍为空（未被钉死）', r.data?.title === '');

  const l = await j('GET', '/api/sessions');
  const found = (l.data?.sessions || []).find((s) => s.id === id);
  ok('列表里能看到这个会话', !!found);
  ok('列表标题已推导', found?.title === '帮我比较一下 Vulkan 和 CPU 推理的差别', found?.title);
  ok('列表轮数为 1', found?.turns === 1, String(found?.turns));
  ok('列表记录了模型', found?.model?.startsWith('qwen2.5'), found?.model);
}

// 5) 读回
{
  const r = await j('GET', `/api/sessions/${id}`);
  ok('GET 单会话 200', r.status === 200);
  ok('读回 2 条消息', r.data?.messages?.length === 2, String(r.data?.messages?.length));
  ok('第二意见前缀字段可空', r.data?.messages?.[1]?.ctx === undefined);
}

// 6) 重命名
{
  const r = await j('PUT', `/api/sessions/${id}`, { title: '  推理后端对比  ' });
  ok('重命名 200', r.status === 200);
  ok('重命名后 title 生效', r.data?.title === '推理后端对比', r.data?.title);
  ok('重命名不丢消息', (await j('GET', `/api/sessions/${id}`)).data?.messages?.length === 2);
}

// 7) 非法 id 防护（目录穿越）
{
  const bad = await j('GET', '/api/sessions/..%2F..%2Fapp');
  ok('非法 id 被拒', bad.status === 400, 'status=' + bad.status);
  const bad2 = await j('GET', '/api/sessions/short');
  ok('过短 id 被拒', bad2.status === 400, 'status=' + bad2.status);
}

// 8) 删除
{
  const r = await j('DELETE', `/api/sessions/${id}`);
  ok('DELETE 200', r.status === 200);
  const after = await j('GET', `/api/sessions/${id}`);
  ok('删除后读不到', after.status === 404, 'status=' + after.status);
  const list = await j('GET', '/api/sessions');
  ok('列表里已消失', !(list.data?.sessions || []).some((s) => s.id === id));
}

// 9) 第二意见的参数校验
//    注意：便携版启动时会自动加载模型（AUTO_LOAD），所以不能假设「没有已加载模型」。
//    这里只测「不该被接受」的请求，且刻意避免真触发一次模型装卸（那是 probe-second-opinion 的事）。
{
  const st = await (await fetch(BASE + '/api/state')).json();
  const noModel = !st.loaded;
  const r = await j('POST', '/api/second-opinion', { models: ['%nonexistent%.gguf'], messages: [{ role: 'user', content: 'hi' }] });
  ok(
    noModel ? '未加载模型时被拒' : '未知模型被拒',
    noModel ? r.status === 409 : r.status === 400,
    `status=${r.status} ${r.data?.error?.message || ''}`,
  );
  const r2 = await j('POST', '/api/second-opinion', { messages: [{ role: 'user', content: 'hi' }] });
  ok('缺 models 时也报错（400/409）', r2.status === 400 || r2.status === 409, 'status=' + r2.status);
}

console.log(`\n== 结果: ${pass} 通过 / ${fail} 失败 ==\n`);
process.exit(fail ? 1 : 0);
