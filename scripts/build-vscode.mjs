// 打包 VS Code 扩展：esbuild 打成单文件 CJS + 生成扩展清单。
// 用法: node scripts/build-vscode.mjs   (依赖 devDependencies 中的 esbuild)
import { build } from 'esbuild'
import { mkdir, writeFile } from 'node:fs/promises'

const outdir = 'dist-vscode'

await mkdir(outdir, { recursive: true })

await build({
  entryPoints: ['src/vscode/extension.ts'],
  outfile: `${outdir}/extension.js`,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['vscode'],
  sourcemap: true,
  logLevel: 'info',
})

const manifest = {
  name: 'ds-codebot-vscode',
  displayName: 'ds-codebot',
  description: 'DeepSeek Harness 编码助手（ds-codebot 的 VS Code 前端）',
  version: '0.1.0',
  publisher: 'ds-codebot',
  engines: { vscode: '^1.85.0' },
  main: './extension.js',
  activationEvents: [],
  contributes: {
    commands: [{ command: 'ds-codebot.openChat', title: 'ds-codebot: 打开编码助手' }],
  },
}

await writeFile(`${outdir}/package.json`, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
console.log(`[build-vscode] ${outdir}/extension.js + package.json 就绪`)
