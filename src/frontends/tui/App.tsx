import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Box, Text, useApp, useInput } from 'ink'
import type { RuntimePool } from '../../core/runtime.ts'
import { EventRouter, type UiEvent } from '../../core/router.ts'
import type { BotError } from '../../core/errors.ts'
import { Composer } from './Composer.tsx'
import { Transcript, type Entry } from './Transcript.tsx'

function describe(error: BotError): string {
  return error.message
}

/** TUI 根组件：状态栏 + 正文 + 输入框；所有渲染数据来自 `UiEvent`。 */
export function App({ pool, initialCwd }: { pool: RuntimePool; initialCwd: string }) {
  const [entries, setEntries] = useState<Entry[]>([])
  const [cwd, setCwd] = useState(initialCwd)
  const [running, setRunning] = useState(false)
  const [queued, setQueued] = useState(0)
  const [value, setValue] = useState('')
  const queue = useRef<Promise<void>>(Promise.resolve())
  const { exit } = useApp()

  const push = useCallback((entry: Entry) => {
    setEntries((previous) => [...previous, entry])
  }, [])

  const onEvent = useCallback(
    (event: UiEvent) => {
      push(event)
      if (event.kind === 'status') setRunning(event.running)
      else if (event.kind === 'turn-start') setRunning(true)
      else if (event.kind === 'turn-end') setRunning(false)
    },
    [push],
  )
  const router = useMemo(() => new EventRouter(pool.sessionId, onEvent), [pool.sessionId, onEvent])
  useEffect(() => pool.subscribeSession((notification) => router.dispatch(notification)), [pool, router])

  const quit = useCallback(() => {
    void (async () => {
      await pool.close()
      exit()
      process.exit(0)
    })()
  }, [exit, pool])

  // 非 TTY 下 useInput 不做 raw mode 尝试（main 已 fail-loud，此处是纵深防御）
  const interactive = process.stdin.isTTY === true
  // raw mode 下 Ctrl-D 不会产生 stdin EOF（以按键交付），与 Ctrl-C 同等处理
  useInput(
    (input, key) => {
      if (key.ctrl && (input === 'c' || input === 'd')) quit()
    },
    { isActive: interactive },
  )

  const submit = useCallback(
    (line: string) => {
      const text = line.trim()
      setValue('')
      if (text.length === 0) return
      if (text === '/quit' || text === '/exit') {
        quit()
        return
      }
      if (text === '/help') {
        push({ kind: 'notice', tone: 'info', text: '输入任务直接发给 Agent；/cwd <目录> 切换工作目录；/quit 退出' })
        return
      }
      if (text.startsWith('/cwd')) {
        const target = text.slice('/cwd'.length).trim()
        if (target.length === 0) {
          push({ kind: 'notice', tone: 'error', text: '用法: /cwd <目录>' })
          return
        }
        void (async () => {
          try {
            const absolute = await pool.setCwd(target)
            setCwd(absolute)
            push({ kind: 'notice', tone: 'info', text: `工作目录 → ${absolute}` })
          } catch (error) {
            push({ kind: 'notice', tone: 'error', text: describe(error as BotError) })
          }
        })()
        return
      }
      setQueued((n) => n + 1)
      queue.current = queue.current.then(async () => {
        try {
          await pool.prompt(text)
        } catch (error) {
          const described = error as BotError
          push({ kind: 'notice', tone: 'error', text: describe(described) })
          if (described.kind === 'transport') quit()
        } finally {
          setQueued((n) => n - 1)
        }
      })
    },
    [pool, push, quit],
  )

  return (
    <Box flexDirection="column">
      <Box borderStyle="single" borderColor="green" paddingX={1}>
        <Text color="green" bold>
          ds-codebot TUI
        </Text>
        <Text> · model </Text>
        <Text color="cyan">{pool.modelId}</Text>
        <Text> · session </Text>
        <Text color="cyan">{pool.sessionId}</Text>
        <Text> · cwd </Text>
        <Text color="cyan">{cwd}</Text>
        <Text> · </Text>
        <Text color={running ? 'yellow' : 'gray'}>{running ? '● 运行中' : '○ 空闲'}</Text>
      </Box>
      <Transcript entries={entries} />
      <Composer value={value} onChange={setValue} onSubmit={submit} disabled={running} queued={queued} interactive={interactive} />
    </Box>
  )
}
