import { Box, Text } from 'ink'
import type { UiEvent } from '../../core/router.ts'

export type Entry = UiEvent | { kind: 'notice'; tone: 'info' | 'error'; text: string }

const HELP_TEXT = '命令: /cwd <目录> 切换工作目录 · /quit 退出 · 空输入忽略 · Ctrl-C 安全退出'

function renderEntry(entry: Entry, index: number) {
  switch (entry.kind) {
    case 'user-text':
      return (
        <Box key={index} flexDirection="column">
          <Text color="cyan" bold>
            {'> '}
            {entry.text}
          </Text>
        </Box>
      )
    case 'assistant-text':
      return (
        <Box key={index} flexDirection="column">
          <Text>{entry.text}</Text>
        </Box>
      )
    case 'tool-call':
      return (
        <Text key={index} color="yellow">
          ⚙ {entry.name}({truncate(entry.args, 120)})
        </Text>
      )
    case 'tool-result':
      return (
        <Text key={index} color={entry.isError ? 'red' : 'gray'}>
          {entry.isError ? '✗ 工具失败' : '✓ 工具完成'}
        </Text>
      )
    case 'turn-start':
      return (
        <Text key={index} color="gray">
          ── turn 开始 ──
        </Text>
      )
    case 'turn-end':
      return (
        <Text key={index} color="gray">
          ── turn 结束 ──
        </Text>
      )
    case 'status':
      return null // 状态由状态栏呈现，不入正文
    case 'notice':
      return (
        <Text key={index} color={entry.tone === 'error' ? 'red' : 'magenta'}>
          {entry.text}
        </Text>
      )
  }
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`
}

/** 会话正文：纯由 `Entry` 渲染，无自有状态（可回放即重建）。 */
export function Transcript({ entries }: { entries: readonly Entry[] }) {
  return (
    <Box flexDirection="column">
      {entries.map(renderEntry)}
      <Text color="gray">{HELP_TEXT}</Text>
    </Box>
  )
}
