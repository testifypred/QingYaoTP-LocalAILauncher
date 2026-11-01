/**
 * 首次启动「自动检查用户配置」的推荐逻辑（纯函数，便于探针单测）。
 *
 * 目标：不让第一次用的人自己猜"该下哪个模型、上下文开多少"。
 * 依据：内存总量/可用、显卡显存、Vulkan 是否可用、CPU 核数、目录里已有的模型。
 *
 * 设计原则：
 *  - 8GB 级老本（如 i5-10210U + 8GB + RX640 2GB）：0.5B + 4K 上下文，先能跑起来；
 *  - 16GB 级：0.5B/4B + 8K；
 *  - 24GB+：优先用目录里已有的 7B 级模型，16K；
 *  - KV 缓存量化默认 q8_0（内存砍半，低内存机器尤其重要）；
 *  - 显存 ≤2GB 或 Vulkan 不可用时不强求 GPU：gpu=auto，让运行时自己回落。
 */

const CATALOG = {
  "qwen25-05b-q2k": { label: "Qwen2.5-0.5B Q2_K", sizeGB: 0.4, file: "qwen2.5-0.5b-instruct-q2_k.gguf" },
  "qwen25-05b-q4km": { label: "Qwen2.5-0.5B Q4_K_M", sizeGB: 0.47, file: "qwen2.5-0.5b-instruct-q4_k_m.gguf" },
  "qwen25-05b-q8": { label: "Qwen2.5-0.5B Q8_0", sizeGB: 0.64, file: "qwen2.5-0.5b-instruct-q8_0.gguf" },
};

/**
 * 在已有模型里挑「适合当默认」的大模型（不是简单取第一个）：
 *  - 优先非思考、工具友好的（qwen2.5-7B > qwen3-4B > phi > 其它 7B/4B）；
 *  - DeepSeek-R1 这类思考模型默认不推荐（工具调用弱、更慢），只在没有别的可选时才落到 0.5B。
 */
function pickDefaultBig(models) {
  const score = (file) => {
    const f = String(file || "").toLowerCase();
    if (!f) return -1;
    let s;
    if (/0\.5b/.test(f)) s = 30;
    else if (/(7b|8b|4b|3b|2b|1\.5b)/.test(f)) s = 60;
    else return -1;
    if (/qwen2\.5-7b/.test(f)) s += 40;      // 主力 1M 上下文，工具调用稳
    else if (/qwen3.*4b/.test(f)) s += 30;   // 快、可思考
    else if (/phi/.test(f)) s += 20;         // 微软小模型
    else if (/7b/.test(f)) s += 25;
    else if (/4b/.test(f)) s += 15;
    else if (/8b/.test(f)) s += 10;
    if (/deepseek|r1/.test(f)) s -= 200;     // 思考模型：默认不推荐
    return s;
  };
  let best = "", bestScore = 0;
  for (const m of models || []) {
    const f = String(m.file || m);
    const sc = score(f);
    if (sc > bestScore) { bestScore = sc; best = f; }
  }
  return best;
}

/**
 * @param {{ramTotalGB:number, ramFreeGB:number, vramGB:number, hasVulkan:boolean, cpuCores:number, models:Array}} env
 * @returns {{tier:string, model:{id:string,label:string,sizeGB:number,file:string,catalog:boolean,existing:boolean}, contextSize:number, kvQuant:string, gpu:string, reason:string, notes:string[]}}
 */
export function recommendConfig(env = {}) {
  const ram = Number(env.ramTotalGB) || 0;
  const free = Number(env.ramFreeGB) || 0;
  const vram = Number(env.vramGB) || 0;
  const hasVulkan = env.hasVulkan === true;
  const cores = Number(env.cpuCores) || 0;
  const models = Array.isArray(env.models) ? env.models : [];
  const big = pickDefaultBig(models);

  // 可用内存：系统会把一部分拿回给缓存，按「free + 2GB 可回收」估
  const usable = free + 2;
  let tier = "medium";
  let contextSize = 8192;
  let reason = "";

  if (ram > 0 && (ram < 10 || (ram < 16 && usable < 6))) {
    tier = "tiny";
    contextSize = 4096;
    reason = `内存 ${ram.toFixed(1)}GB（可用 ${free.toFixed(1)}GB）：先跑 0.5B 小模型、4K 上下文，保证能起来`;
  } else if (ram < 16) {
    tier = "small";
    contextSize = 8192;
    reason = `内存 ${ram.toFixed(1)}GB：0.5B 起步、8K 上下文；内存富裕后可换 4B/7B`;
  } else if (ram < 24) {
    tier = "medium";
    contextSize = 8192;
    reason = `内存 ${ram.toFixed(1)}GB：可用 4B/7B，8K 上下文比较稳`;
  } else {
    tier = "large";
    contextSize = 16384;
    reason = `内存 ${ram.toFixed(1)}GB：可用 7B 级模型，16K 上下文`;
  }

  // 选模型：优先已有的大模型；否则选下载目录里的 0.5B 档
  let id = "qwen25-05b-q4km";
  if (tier === "large" && big) return finish({ id, tier, contextSize, reason, hasVulkan, vram, big, models });
  if (tier === "tiny" && usable < 4) id = "qwen25-05b-q2k";
  if (tier === "small" || tier === "medium") id = usable >= 8 ? "qwen25-05b-q8" : "qwen25-05b-q4km";
  return finish({ id, tier, contextSize, reason, hasVulkan, vram, big, models });
}

function finish({ id, tier, contextSize, reason, hasVulkan, vram, big, models }) {
  const cat = CATALOG[id] || CATALOG["qwen25-05b-q4km"];
  const existingBig = tier === "large" && big ? String(big) : "";
  const existingCat = (models || []).some((m) => String(m.file || m) === cat.file);
  const notes = [];
  if (vram > 0 && vram <= 2.5) notes.push(`显存 ${vram.toFixed(1)}GB 偏小：小模型可直接放显存，7B 会自动回落到 CPU/混合`);
  if (!hasVulkan) notes.push("Vulkan 不可用：用 CPU 后端（更稳但慢）");
  notes.push("KV 缓存量化 q8_0 已默认开启，低内存机器尤其重要");
  return {
    tier,
    model: existingBig
      ? { id: "", label: existingBig, sizeGB: 0, file: existingBig, catalog: false, existing: true }
      : { id, label: cat.label, sizeGB: cat.sizeGB, file: cat.file, catalog: true, existing: existingCat },
    contextSize,
    kvQuant: "q8_0",
    gpu: hasVulkan ? "auto" : "cpu",
    reason,
    notes,
  };
}

export const CATALOG_MODELS = CATALOG;
