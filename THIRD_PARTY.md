# Third-party software

FlowChat uses Electron (MIT), React (MIT), Vite / electron-vite (MIT), TypeScript (Apache-2.0), Tailwind CSS (MIT), Radix UI (MIT), shadcn/ui component patterns (MIT, Copyright shadcn), class-variance-authority (Apache-2.0), clsx (MIT), tailwind-merge (MIT), Lucide (ISC), Ant Design Icons (MIT), Motion (MIT), react-markdown / remark-gfm (MIT), Sonner (MIT), Zod (MIT), and the official `@opencode/client` package (MIT).

Syntax highlighting uses rehype-highlight and lowlight (MIT) with highlight.js (BSD-3-Clause).
Math rendering uses remark-math, rehype-katex, and KaTeX (MIT), with KaTeX fonts included from the package.

Instant Markdown editing uses Vditor and its Lute parser (MIT). Vditor's on-demand rendering assets and their upstream license notices are bundled locally; its KaTeX assets use the same version as the application's Markdown renderer.

Development tools include electron-builder (MIT), Vitest (MIT), Playwright (Apache-2.0), and Prettier (MIT). Each package and its transitive dependencies retain their upstream license files. Electron distributions include Chromium and Node.js notices in `LICENSE`, `LICENSES.chromium.html`, and associated runtime files.

Bundled fonts include the upright and italic variable faces of Geist Sans and Geist Mono from Vercel's official `geist` 1.9.2 package (SIL Open Font License 1.1), and unmodified HarmonyOS Sans SC Regular, Medium, and Bold fonts (HarmonyOS Sans Fonts License Agreement, Copyright 2021 Huawei Device Co., Ltd.). Their full copyright and license notices are included in `assets/licenses/Geist-LICENSE.txt` and `assets/licenses/HarmonyOS-Sans-SC-LICENSE.txt`.

shadcn/ui license: Copyright (c) 2023 shadcn. Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

The application does not redistribute the Codex, Claude Code or OpenCode CLI executables. They are separately installed and licensed by the user.

Provider icons for OpenAI and Claude use the `OpenAIOutlined` and `ClaudeFilled` components from [Ant Design Icons](https://github.com/ant-design/ant-design-icons), distributed under its MIT license. The OpenCode icon is a local SVG drawn to match their monochrome style and rendered through the same icon component. These icons identify compatible third-party tools; their trademarks remain with their respective owners and do not imply endorsement.
