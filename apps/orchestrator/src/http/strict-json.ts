export class StrictJsonError extends Error {
  constructor() {
    super('JSON input is invalid.')
    this.name = 'StrictJsonError'
  }
}

export function parseStrictJson(text: string, maximumDepth = 32): unknown {
  const parser = new JsonParser(text, maximumDepth)
  return parser.parse()
}

class JsonParser {
  #position = 0

  constructor(
    readonly text: string,
    readonly maximumDepth: number,
  ) {}

  parse(): unknown {
    const value = this.#value(0)
    this.#space()
    if (this.#position !== this.text.length) throw new StrictJsonError()
    return value
  }

  #value(depth: number): unknown {
    if (depth > this.maximumDepth) throw new StrictJsonError()
    this.#space()
    const character = this.text[this.#position]
    if (character === '{') return this.#object(depth + 1)
    if (character === '[') return this.#array(depth + 1)
    if (character === '"') return this.#string()
    if (character === '-' || (character !== undefined && /\d/u.test(character))) {
      return this.#number()
    }
    if (this.text.startsWith('true', this.#position)) return this.#literal('true', true)
    if (this.text.startsWith('false', this.#position)) return this.#literal('false', false)
    if (this.text.startsWith('null', this.#position)) return this.#literal('null', null)
    throw new StrictJsonError()
  }

  #object(depth: number): Record<string, unknown> {
    this.#position += 1
    const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>
    const keys = new Set<string>()
    this.#space()
    if (this.#consume('}')) return result
    for (;;) {
      this.#space()
      if (this.text[this.#position] !== '"') throw new StrictJsonError()
      const key = this.#string()
      if (keys.has(key)) throw new StrictJsonError()
      keys.add(key)
      this.#space()
      if (!this.#consume(':')) throw new StrictJsonError()
      Object.defineProperty(result, key, {
        value: this.#value(depth),
        enumerable: true,
        configurable: false,
        writable: false,
      })
      this.#space()
      if (this.#consume('}')) return result
      if (!this.#consume(',')) throw new StrictJsonError()
    }
  }

  #array(depth: number): unknown[] {
    this.#position += 1
    const result: unknown[] = []
    this.#space()
    if (this.#consume(']')) return result
    for (;;) {
      result.push(this.#value(depth))
      this.#space()
      if (this.#consume(']')) return result
      if (!this.#consume(',')) throw new StrictJsonError()
    }
  }

  #string(): string {
    const start = this.#position
    this.#position += 1
    let escaped = false
    while (this.#position < this.text.length) {
      const character = this.text[this.#position]
      this.#position += 1
      if (escaped) {
        escaped = false
        continue
      }
      if (character === '\\') {
        escaped = true
        continue
      }
      if (character === '"') {
        try {
          return JSON.parse(this.text.slice(start, this.#position)) as string
        } catch {
          throw new StrictJsonError()
        }
      }
      if (character !== undefined && character.charCodeAt(0) < 0x20) throw new StrictJsonError()
    }
    throw new StrictJsonError()
  }

  #number(): number {
    const start = this.#position
    this.#consume('-')
    this.#integerDigits()
    this.#fractionalDigits()
    this.#exponentDigits()
    const number = Number(this.text.slice(start, this.#position))
    if (!Number.isFinite(number)) throw new StrictJsonError()
    return number
  }

  #integerDigits(): void {
    if (this.#consume('0')) return
    if (!isNonzeroDigit(this.text[this.#position])) throw new StrictJsonError()
    this.#position += 1
    this.#digits()
  }

  #fractionalDigits(): void {
    if (!this.#consume('.')) return
    this.#requiredDigits()
  }

  #exponentDigits(): void {
    if (!this.#consume('e') && !this.#consume('E')) return
    if (!this.#consume('+')) this.#consume('-')
    this.#requiredDigits()
  }

  #requiredDigits(): void {
    if (!isDigit(this.text[this.#position])) throw new StrictJsonError()
    this.#digits()
  }

  #digits(): void {
    while (isDigit(this.text[this.#position])) this.#position += 1
  }

  #literal<T>(text: string, value: T): T {
    this.#position += text.length
    return value
  }

  #space(): void {
    while (' \t\r\n'.includes(this.text[this.#position] ?? '\0')) this.#position += 1
  }

  #consume(expected: string): boolean {
    if (this.text[this.#position] !== expected) return false
    this.#position += 1
    return true
  }
}

function isDigit(character: string | undefined): boolean {
  return character !== undefined && character >= '0' && character <= '9'
}

function isNonzeroDigit(character: string | undefined): boolean {
  return character !== undefined && character >= '1' && character <= '9'
}
