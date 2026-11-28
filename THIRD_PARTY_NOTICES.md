# 第三方组件与许可（THIRD_PARTY_NOTICES）

QingYaoTP AILauncher 发行包内含或依赖以下第三方组件。各组件的版权归其各自作者所有，
本项目按各自的许可条款使用与分发。**若你重新分发本软件或视觉增强包，请一并保留本文件。**

## 一、清单

| 组件 | 版本 / 形态 | 用途 | 许可 | 版权 |
|---|---|---|---|---|
| node-llama-cpp | 3.22.1（npm） | 本机 llama.cpp 推理绑定 | MIT | Copyright (c) 2023 Gilad S. |
| llama.cpp（llama-server） | b12144（视觉增强包内二进制） | 看图 sidecar | MIT | Copyright (c) 2023-2026 The ggml authors |
| ws | 8.22.0（npm） | WebSocket | MIT | Copyright (c) 2011 Einar Otto Stangvik; (c) 2013 Arnout Kazemier and contributors; (c) 2016 Luigi Pinca and contributors |
| msedge-tts | 2.1.0（npm） | 语音合成 | MIT | Copyright (c) 2023 Migushthe2nd |
| KaTeX（含字体） | vendor/katex | 公式渲染 | MIT；字体 SIL OFL 1.1 | Copyright (c) 2013-2020 Khan Academy and other contributors |
| Noto Serif SC（子集） | vendor/fonts/noto-serif-sc（woff2，仅开场白问候语用到的 20 余字形） | 开场白「早上/中午/下午/晚上好 / 今天做点什么？」标题字体 | SIL OFL 1.1 | Copyright 2014-2025 Adobe / Google LLC（Noto CJK） |
| mhchem（KaTeX 扩展） | vendor/katex/contrib/mhchem | 化学式 | Apache-2.0 | 见文件头版权声明 |
| MathLive | vendor/mathlive | 公式面板 | MIT | Copyright (c) 2017 - present Arno Gourdol |
| CodeMirror | vendor/codemirror（v5） | 代码编辑器 | MIT | Copyright (C) 2017 by Marijn Haverbeke and others |
| Node.js 运行时 | v24.19.0（runtime/node.exe） | 服务端运行时 | MIT | Copyright Node.js contributors |
| Microsoft Edge WebView2 | 运行时 DLL | 内嵌窗口 | Microsoft 可再分发组件条款 | Microsoft Corporation |
| Microsoft VC++ Redistributable | vc_redist.x64.exe | 运行库 | Microsoft 可再分发组件条款 | Microsoft Corporation |

说明：

- `node_modules/` 内各 npm 包自带其 LICENSE 文件，随包分发时一并保留。
- 视觉增强包（`app/llama`）内含 llama.cpp 的 `llama-server.exe` 等二进制，适用上表 llama.cpp 的 MIT 许可；
  重新分发增强包时请保留本文件。
- 本软件**不随包分发模型权重**；用户自行下载的模型（Qwen / DeepSeek / Phi / gpt-oss / Llama 等）
  适用各自模型许可，由使用者自行遵守。

- Noto Serif SC 只内嵌开场白用到的字形子集（`vendor/fonts/noto-serif-sc/noto-serif-sc-subset.woff2`，约 5.7KB）；
  许可证全文随文件放在同目录的 `OFL.txt`，重新分发时请一并保留。

## 二、MIT 许可全文（适用于上表标注 MIT 的组件）

MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## 三、其他许可

- **Apache-2.0**（mhchem）：https://www.apache.org/licenses/LICENSE-2.0
- **SIL Open Font License 1.1**（KaTeX 字体）：https://openfontlicense.org
- **Microsoft WebView2 / VC++ 运行库**：按微软对应的可再分发组件条款使用；
  详见 https://learn.microsoft.com/microsoft-edge/webview2/ 与 https://learn.microsoft.com/cpp/windows/latest-supported-vc-redist
