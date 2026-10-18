import { Box, Text } from 'ink'
import TextInput from 'ink-text-input'

/** 输入框：提交由 App 串行化；排队深度来自 App 状态。
 *  `interactive=false`（非 TTY）时不挂载 TextInput——它内部无条件启用
 *  raw mode，会把管道/CI 环境直接打挂。 */
export function Composer({
  value,
  onChange,
  onSubmit,
  disabled,
  queued,
  interactive,
}: {
  value: string
  onChange: (value: string) => void
  onSubmit: (value: string) => void
  disabled: boolean
  queued: number
  interactive: boolean
}) {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={disabled ? 'gray' : 'blue'}>
      <Text color="gray">{disabled ? `运行中（已排队 ${queued} 条）` : interactive ? '输入任务或 /命令' : '非 TTY 环境：键盘输入不可用，EOF 退出'}</Text>
      <Box>
        {interactive ? (
          <>
            <Text color="blue">❯ </Text>
            <TextInput value={value} onChange={onChange} onSubmit={onSubmit} />
          </>
        ) : null}
      </Box>
    </Box>
  )
}
