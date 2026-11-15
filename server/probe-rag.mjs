/**
 * 文档检索（RAG）接口探针
 *
 *   node probe-rag.mjs [base]
 *
 * 覆盖：建索引、中文 bigram 召回、英文召回、改文件后重建能搜到新内容/旧内容消失、
 *       删文件后不再召回、tool 已注册、状态数字对得上。
 * 自复位：测试文档放 <工作区>\rag-probe\，跑完删掉并重建索引。
 * 工作区根不写死：从 /api/rag/status 的 dir 反推（源码目录与发布包目录不同）。
 */
import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const BASE = process.argv[2] || "http://127.0.0.1:8099";
// 工作区根从服务端自报的检索目录反推（/api/rag/status.dir = <WORKSPACE>\rag）：
// 发布包的 WORKSPACE = <安装目录>\models\workspace，不等于开发目录；写死开发路径会让
// 「新文件进了索引」永远 files=0（2026-11-02 在发布包上实测 8 条红，全是这个原因）。
let DIR = "";
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) { pass++; console.log("  ok   " + n + (d ? "  [" + d + "]" : "")); } else { fail++; console.log("  FAIL " + n + "  " + d); } };
const j = async (method, p) => {
  const r = await fetch(BASE + p, { method });
  const t = await r.text();
  let data = null;
  try { data = JSON.parse(t); } catch {}
  return { status: r.status, data, text: t };
};
const search = async (q) => (await j("GET", "/api/rag/search?q=" + encodeURIComponent(q))).data;

console.log("\n== 目标 " + BASE + " ==\n");

const baseStatus = (await j("GET", "/api/rag/status")).data;
ok("索引状态可读", typeof baseStatus?.files === "number", JSON.stringify(baseStatus).slice(0, 100));

const ragDir = String(baseStatus?.dir || "");
DIR = ragDir ? path.join(path.dirname(ragDir), "rag-probe") : path.join(os.tmpdir(), "qytp-rag-probe");

await mkdir(DIR, { recursive: true });
await writeFile(path.join(DIR, "alpha.md"), "# 量子笔记\n\n纠缠态可以用来做量子通信。\n\n第二段讲退相干与测量。\n", "utf8");
await writeFile(path.join(DIR, "beta.txt"), "Retrieval augmented generation needs chunking and ranking.\n", "utf8");

const rebuilt = await j("POST", "/api/rag/rebuild");
ok("重建索引成功", rebuilt.status === 200 && rebuilt.data?.ok === true, JSON.stringify(rebuilt.data).slice(0, 100));
ok("新文件进了索引", (rebuilt.data?.files || 0) >= (baseStatus?.files || 0) + 2, "files=" + rebuilt.data?.files);

const cn = await search("量子纠缠");
ok("中文 bigram 能召回", cn?.count >= 1 && (cn.hits || []).some((h) => h.file === "rag-probe/alpha.md"), JSON.stringify(cn?.hits || []).slice(0, 120));
ok("命中片段带出处", (cn?.hits || [])[0]?.text?.includes("纠缠态"), (cn?.hits || [])[0]?.file);
const en = await search("retrieval augmented");
ok("英文按词召回", en?.count >= 1 && (en.hits || []).some((h) => h.file === "rag-probe/beta.txt"), JSON.stringify(en?.hits || []).slice(0, 100));

// 改文件：新内容能搜到，旧内容不再从这份文件里召回
await writeFile(path.join(DIR, "alpha.md"), "# 量子笔记\n\n量子退相干是退相干的特例，讲量子测量。\n", "utf8");
await j("POST", "/api/rag/rebuild");
const fresh = await search("量子退相干");
ok("改完能搜到新内容", fresh?.count >= 1 && (fresh.hits || []).some((h) => h.file === "rag-probe/alpha.md"), JSON.stringify(fresh?.hits || []).slice(0, 100));
const old = await search("纠缠态");
ok("旧内容不再从该文件召回", !(old?.hits || []).some((h) => h.file === "rag-probe/alpha.md"), JSON.stringify(old?.hits || []).slice(0, 100));

// 二进制文档：docx / pdf 也要能抽出文字进索引
const FIX = "D:/LocalModels/server/docs/fixtures";
await copyFile(path.join(FIX, "sample.docx"), path.join(DIR, "sample.docx"));
await copyFile(path.join(FIX, "sample.pdf"), path.join(DIR, "sample.pdf"));
await j("POST", "/api/rag/rebuild");
const docxHit = await search("Word file");
ok("docx 抽文本后能召回", (docxHit?.hits || []).some((h) => h.file === "rag-probe/sample.docx"), JSON.stringify(docxHit?.hits || []).slice(0, 100));
const pdfHit = await search("chunking works");
ok("pdf 抽文本后能召回", (pdfHit?.hits || []).some((h) => h.file === "rag-probe/sample.pdf"), JSON.stringify(pdfHit?.hits || []).slice(0, 100));
const pdfCn = await search("退相干会破坏");
ok("pdf 里的中文也抽得出来", (pdfCn?.hits || []).some((h) => h.file === "rag-probe/sample.pdf"), JSON.stringify(pdfCn?.hits || []).slice(0, 80));

// 删文件
await rm(path.join(DIR, "beta.txt"), { force: true });
await j("POST", "/api/rag/rebuild");
const gone = await search("retrieval augmented");
ok("删掉的文件不再被召回", !(gone?.hits || []).some((h) => h.file === "rag-probe/beta.txt"), JSON.stringify(gone?.hits || []).slice(0, 100));

// 检索是工具，不是另一套逻辑
const tools = (await j("GET", "/api/tools")).data?.tools || [];
const sd = tools.find((t) => t.name === "search_documents");
ok("工具清单里有 search_documents", !!sd, tools.map((t) => t.name).join(","));
ok("工具参数是 query/k", !!sd && sd.params.includes("query"), JSON.stringify(sd?.params || []));

// 空查询给 400，别静默返回空
ok("空查询被拒", (await j("GET", "/api/rag/search?q=")).status === 400);

// 复位
await rm(DIR, { recursive: true, force: true });
const after = await j("POST", "/api/rag/rebuild");
ok("复位后索引回到原样", (after.data?.files || 0) === (baseStatus?.files || 0), "files=" + after.data?.files + " / 原 " + baseStatus?.files);

console.log("\n== 结果: " + pass + " 通过 / " + fail + " 失败 ==\n");
process.exit(fail ? 1 : 0);
