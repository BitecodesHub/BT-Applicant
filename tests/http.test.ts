import { describe, expect, it } from 'vitest'
import { assertSafeRemoteUrl, blockedHostReason } from '@main/connectors/http'

describe('outbound URL guard', () => {
  it('allows public http and https destinations', () => {
    expect(blockedHostReason('boards-api.greenhouse.io')).toBeNull()
    expect(blockedHostReason('93.184.216.34')).toBeNull()
    expect(blockedHostReason('2001:4860:4860::8888')).toBeNull()
    expect(assertSafeRemoteUrl('https://remotive.com/api/remote-jobs').hostname).toBe('remotive.com')
  })

  it('blocks loopback, private, link-local, and metadata hosts', () => {
    const blocked = [
      'localhost',
      'api.localhost',
      'printer.local',
      'metadata.google.internal',
      '127.0.0.1',
      '10.0.0.8',
      '172.16.4.2',
      '192.168.1.10',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '224.0.0.1',
      '[::1]',
      '[::]',
      '[fd00::1]',
      '[fe80::1]',
      '[ff02::1]'
    ]
    for (const host of blocked) {
      expect(blockedHostReason(host), host).not.toBeNull()
    }
  })

  it('rejects numeric and single-label hostnames', () => {
    expect(blockedHostReason('2130706433')).not.toBeNull()
    expect(blockedHostReason('intranet')).not.toBeNull()
    expect(() => assertSafeRemoteUrl('http://2130706433/')).toThrow(/Private IPv4/)
    expect(() => assertSafeRemoteUrl('http://0x7f000001/')).toThrow(/Private IPv4/)
  })

  it('rejects non-http protocols and embedded credentials', () => {
    expect(() => assertSafeRemoteUrl('file:///etc/passwd')).toThrow(/http and https/)
    expect(() => assertSafeRemoteUrl('javascript:alert(1)')).toThrow(/http and https/)
    expect(() => assertSafeRemoteUrl('https://user:pass@example.com/')).toThrow(/credentials/)
  })

  it('rejects credentials hidden in a URL', () => {
    expect(() => assertSafeRemoteUrl('https://user@example.com/')).toThrow(/credentials/)
  })
})
