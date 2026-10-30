const platform = typeof window === 'undefined' ? '' : window.api?.platform ?? ''

export const isMac = platform === 'darwin'
export const paletteShortcut = isMac ? '⌘K' : 'Ctrl K'
export const keychainName =
  platform === 'win32' ? 'Windows data protection (DPAPI)' : isMac ? 'the macOS Keychain' : 'the OS keyring (Secret Service)'
export const machineName = isMac ? 'this Mac' : 'this machine'
export const yourMachine = isMac ? 'your Mac' : 'your computer'
