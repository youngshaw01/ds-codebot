import process from 'node:process'
import { resolve } from 'node:path'
import { DEFAULT_CONFIG_PATH, loadConfig } from '../../config.ts'
import { RuntimePool } from '../../core/runtime.ts'
import { SessionRegistry } from '../../core/registry.ts'
import { FeishuBot } from './bot.ts'
import { LarkGateway } from './lark.ts'

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
  const appId = process.env.FEISHU_APP_ID
  const appSecret = process.env.FEISHU_APP_SECRET
  if (!appId || !appSecret) {
    log('缺少 FEISHU_APP_ID / FEISHU_APP_SECRET 环境变量（凭据只走环境变量，不落配置）')
    process.exit(1)
  }

  const config = await loadConfig(parseConfigPath(process.argv.slice(2)))
  const pool = new RuntimePool(config.runtime)
  await pool.start()

  const registry = new SessionRegistry(resolve('state', 'feishu-registry.json'))
  await registry.load()

  const gateway = new LarkGateway(appId, appSecret)
  const bot = new FeishuBot(pool, registry, gateway, {
    defaultCwd: config.feishu?.defaultCwd ?? process.cwd(),
  })

  const shutdown = async (code: number): Promise<void> => {
    log('正在关闭…')
    try {
      await gateway.stop()
      await pool.close()
    } catch (error) {
      log(`关闭时出错: ${error instanceof Error ? error.message : String(error)}`)
    }
    process.exit(code)
  }
  process.on('SIGINT', () => void shutdown(0))

  log('启动飞书长连接…')
  await bot.start()
  log('飞书 bot 已就绪：群内 @bot 或私聊发送任务')
}

main().catch((error: unknown) => {
  log(`启动失败: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
