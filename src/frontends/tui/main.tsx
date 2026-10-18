import process from 'node:process'
import { render } from 'ink'
import { DEFAULT_CONFIG_PATH, loadConfig } from '../../config.ts'
import { RuntimePool } from '../../core/runtime.ts'
import { App } from './App.tsx'

function log(message: string): void {
  process.stderr.write(`[ds-codebot] ${message}\n`)
}

function parseConfigPath(argv: string[]): string {
  for (const arg of argv) {
    if (arg.startsWith('--config=')) return arg.slice('--config='.length)
  }
  return DEFAULT_CONFIG_PATH
}

async function main(): Promise<void> {
  const { runtime } = await loadConfig(parseConfigPath(process.argv.slice(2)))
  const pool = new RuntimePool(runtime)

  let closing = false
  const shutdown = async (code: number): Promise<void> => {
    if (closing) return
    closing = true
    log('正在关闭 dsh 运行时…')
    try {
      await pool.close()
    } catch (error) {
      log(`关闭时出错: ${error instanceof Error ? error.message : String(error)}`)
    }
    process.exit(code)
  }
  process.on('SIGINT', () => void shutdown(0))
  // 终端断开（stdin 关闭）时经此退出；TTY 内的 Ctrl-C/Ctrl-D 由 App 的 useInput 处理
  process.stdin.on('end', () => void shutdown(0))

  // TUI 的键盘输入依赖 raw mode：非 TTY（管道/CI/被无 stdin 重定向 spawn）一律拒绝启动，
  // 否则要么挂死要么在 ink 挂载时崩；这类场景应使用默认 CLI 模式。
  if (process.stdin.isTTY !== true) {
    log('TUI 需要 TTY 终端；非交互环境请使用默认模式: ds-codebot "<任务>"')
    process.exit(1)
  }

  log(`启动 dsh 运行时（profile=${runtime.profile}, model=${runtime.model}）…`)
  await pool.start()

  const instance = render(<App pool={pool} initialCwd={process.cwd()} />, {
    exitOnCtrlC: false,
    patchConsole: true,
  })
  await instance.waitUntilExit()
  await shutdown(0)
}

main().catch((error: unknown) => {
  log(`启动失败: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
