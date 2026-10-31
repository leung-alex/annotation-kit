import type { SpreadsheetSnapshot } from './snapshot.ts'

const viewers = new Map<string, (snapshot: SpreadsheetSnapshot) => void>()
export function registerSpreadsheet(address: string, reveal: (snapshot: SpreadsheetSnapshot) => void) {
  viewers.set(address, reveal)
  return () => { if (viewers.get(address) === reveal) viewers.delete(address) }
}
export function revealSpreadsheet(snapshot: SpreadsheetSnapshot): boolean {
  const reveal = viewers.get(snapshot.address)
  if (!reveal) return false
  reveal(snapshot)
  return true
}
