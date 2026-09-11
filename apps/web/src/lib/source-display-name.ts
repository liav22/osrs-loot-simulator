/** Activity qualifiers already shown as grey aliases should appear only once. */
export function sourceDisplayName(name: string, aliases: readonly string[]): string {
  for (const alias of aliases) {
    const suffix = ` (${alias})`
    if (name.toLowerCase().endsWith(suffix.toLowerCase()) && name.length > suffix.length) {
      return name.slice(0, -suffix.length)
    }
  }
  return name
}
