import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { JsonRpcResponseError, RequestTimeoutError, SdkProtocolError, TransportClosedError } from '@deepseek-ai/dsh-sdk-client'
import { BotError, toBotError } from '../src/core/errors.ts'

describe('toBotError', () => {
  it('TransportClosedError → transport', () => {
    const error = toBotError(new TransportClosedError('exit 1'))
    assert.ok(error instanceof BotError)
    assert.equal(error.kind, 'transport')
    assert.match(error.message, /运行时已断开/)
  })

  it('RequestTimeoutError → timeout', () => {
    assert.equal(toBotError(new RequestTimeoutError('session/prompt')).kind, 'timeout')
  })

  it('SdkProtocolError → protocol 且消息提示版本不匹配', () => {
    const error = toBotError(new SdkProtocolError('bad frame'))
    assert.equal(error.kind, 'protocol')
    assert.match(error.message, /版本可能不匹配/)
  })

  it('JsonRpcResponseError → wire', () => {
    const error = toBotError(new JsonRpcResponseError(-32601, 'no handler', undefined))
    assert.equal(error.kind, 'wire')
    assert.match(error.message, /运行时拒绝请求/)
  })

  it('普通 Error → unknown', () => {
    const error = toBotError(new Error('boom'))
    assert.equal(error.kind, 'unknown')
    assert.equal(error.cause instanceof Error, true)
  })

  it('BotError 原样返回', () => {
    const original = new BotError('wire', 'x')
    assert.equal(toBotError(original), original)
  })
})
