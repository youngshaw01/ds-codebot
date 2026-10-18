#!/usr/bin/env node
import { createInterface } from 'node:readline'
import { DEFAULT_CONFIG_PATH, loadConfig } from './config.ts'
import { RuntimePool } from './core/runtime.ts'
import { BotError } from './core/errors.ts'

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
  const argv = process.argv.slice(2)
  if (argv[0] === 'tui') {
    await import('./frontends/tui/main.tsx')
    return // TUI 自行管理进程生命周期（waitUntilExit 后退出）
  }
  const configPath = parseConfigPath(argv)
  const { runtime } = await loadConfig(configPath)
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

  log(`启动 dsh 运行时（profile=${runtime.profile}, model=${runtime.model}）…`)
  await pool.start()
  log(`会话 ${pool.sessionId} 就绪；输入任务后回车，空行或 Ctrl-C 退出`)

  // 串行化多轮 prompt：协议无排队语义，客户端 FIFO
  let queue: Promise<void> = Promise.resolve()
  const turn = (text: string): void => {
    queue = queue.then(async () => {
      try {
        const outcome = await pool.prompt(text)
        if (outcome.toolCallCount > 0) {
          log(`工具调用 ${outcome.toolCallCount} 次: ${outcome.toolNames.join(', ')}`)
        }
        if (outcome.finalResponse.length > 0) {
          process.stdout.write(`${outcome.finalResponse}\n`)
        } else {
          log('本轮无文本回复')
        }
      } catch (error) {
        if (closing) return // 关闭流程触发的 TransportClosed 是预期行为，不打扰用户
        const described = error instanceof BotError ? error : new BotError('unknown', String(error))
        log(described.message)
        if (described.kind === 'transport') await shutdown(1)
      }
    })
  }

  const rl = createInterface({ input: process.stdin, terminal: false })
  rl.on('line', (line) => {
    if (closing) return
    const text = line.trim()
    if (text.length === 0) {
      rl.close()
      return
    }
    turn(text)
  })
  // EOF/空行退出：先排空已排队的所有 turn 再关闭，管道输入不得丢任务
  rl.on('close', () => void queue.then(() => shutdown(0)))
}

main().catch((error: unknown) => {
  log(`启动失败: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
