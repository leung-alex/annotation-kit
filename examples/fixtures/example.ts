export function nextStep(items: readonly string[]) {
  return items.find(item => item.length > 0) ?? "Review the draft"
}
