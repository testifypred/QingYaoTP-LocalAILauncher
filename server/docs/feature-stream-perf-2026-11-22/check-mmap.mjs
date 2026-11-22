import { getLlama } from "node-llama-cpp";
const llama = await getLlama({ gpu: "vulkan" });
console.log(JSON.stringify({
  gpu: llama.gpu,
  supportsMmap: llama.supportsMmap,
  gpuSupportsMmap: llama.gpuSupportsMmap,
  supportsGpuOffloading: llama.supportsGpuOffloading,
}, null, 2));
await llama.dispose();
