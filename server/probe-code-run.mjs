const base = "http://127.0.0.1:8099";
const st = await (await fetch(base + "/api/state")).json();
const token = st.localToken;
let pass = 0, fail = 0;
const check = (n, c, d = "") => { if (c) { pass++; console.log("ok   " + n + (d ? "  [" + d + "]" : "")); } else { fail++; console.log("FAIL " + n + "  " + d); } };
async function run(lang, code, withToken = true) {
  const headers = { "content-type": "application/json" };
  if (withToken) headers["x-local-token"] = token;
  const r = await fetch(base + "/api/run", { method: "POST", headers, body: JSON.stringify({ lang, code }) });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, j };
}
const langs = (await (await fetch(base + "/api/run/langs")).json()).langs;
console.log("langs:", JSON.stringify(langs));
check("语言列表含 JavaScript", langs.javascript?.ok === true);
check("语言列表含 Python", langs.python?.ok === true);
check("语言列表含 C++", langs.cpp?.ok === true);
check("Java 明确标为不可用或可用", typeof langs.java?.ok === "boolean", "ok=" + langs.java?.ok);

let r = await run("python", "print('你好 ' + str(6*7))");
check("Python 执行成功", r.status === 200 && r.j.ok === true && r.j.stdout.includes("你好 42"), JSON.stringify(r.j).slice(0, 120));

r = await run("js", "console.log('js ' + (1+2))");
check("JavaScript 执行成功", r.status === 200 && r.j.ok === true && r.j.stdout.includes("js 3"));

r = await run("cpp", "#include <iostream>\nint main(){ std::cout << \"cpp42\" << std::endl; return 0; }");
check("C++ 编译并执行", r.status === 200 && r.j.ok === true && r.j.stdout.includes("cpp42"), "ms=" + (r.j && r.j.ms));

r = await run("java", "public class Main { public static void main(String[] a){ System.out.println(\"hi\"); } }");
if (langs.java?.ok) check("Java 执行成功", r.status === 200 && r.j.ok === true && r.j.stdout.includes("hi"));
else check("Java 缺 JDK 时给出明确提示", r.status === 400 && /JDK/.test(r.j.error.message), r.j?.error?.message);

r = await run("python", "print(1)", false);
check("缺本地令牌拒绝执行", r.status === 403, "status=" + r.status);
r = await run("brainfuck", "+++");
check("未知语言被拒", r.status === 400, r.j?.error?.message);
r = await run("python", "   ");
check("空代码被拒", r.status === 400, r.j?.error?.message);

r = await run("python", "while True:\n    pass");
check("超时会被杀掉", r.status === 200 && r.j.timedOut === true && r.j.ok === false, r.j?.ms + "ms");

r = await run("python", "print('x' * 100000)");
check("输出超限会截断", r.status === 200 && r.j.truncated === true && r.j.stdout.length <= 65536, "len=" + (r.j?.stdout?.length));
console.log("\nRESULT " + pass + "/" + (pass + fail));
process.exit(fail ? 1 : 0);
