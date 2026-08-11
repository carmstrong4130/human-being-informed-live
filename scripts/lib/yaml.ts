/**
 * A small YAML reader for the `openstates/people` corpus.
 *
 * Same constraint as the tar reader: the fetchers run in CI with no install
 * step, so this cannot depend on a YAML package. It is not a general parser —
 * it covers exactly the constructs that appear in those files:
 *
 *   - block mappings           `name: Ben Hansen`
 *   - nested blocks            `party:` followed by an indented block
 *   - block sequences          `- url: https://…`, including the YAML rule that
 *                              a sequence may sit at its key's own indent
 *   - empty flow collections   `other_names: []`
 *   - quoted scalars           `district: '16'`
 *   - plain scalars that wrap  a long `address:` continued on the next line,
 *                              folded with a space as YAML specifies
 *   - block scalars            `note: |` / `note: >`
 *   - comment and blank lines
 *
 * Anything outside that subset (anchors, aliases, nested flow collections) is
 * not understood. Rather than quietly dropping what it cannot read — which once
 * cost this parser everything after a wrapped `address:` line — `parseYaml`
 * throws if any line goes unconsumed. Callers treat a parse as untrusted and
 * validate the fields they need, so an unfamiliar file degrades to "skip this
 * record with a warning" rather than to bad data.
 */

export type YamlValue = string | YamlValue[] | YamlMap;
export interface YamlMap {
  [key: string]: YamlValue;
}

interface Line {
  indent: number;
  text: string;
}

/**
 * `key: value`, or `key:` introducing a nested block.
 *
 * Keys may contain spaces — `extras:` blocks in this corpus carry things like
 * `Legislative Analyst: Kevin Anderson` — so the key is "everything before the
 * first colon". Requiring whitespace or end-of-line after that colon is what
 * keeps a wrapped plain scalar containing a URL from being read as a key, since
 * `https://…` has no space after its colon.
 *
 * A leading quote rules the line out: quoted keys do not occur in this corpus,
 * but quoted *values* containing a colon do (`- 'Political Science, Minor:'`),
 * and reading one as a key would turn a string into a mapping.
 */
const KEY_RE = /^([^:#\s'"][^:]*?):(?:[ \t]+(.*))?$/;

function isMappingStart(text: string): boolean {
  if (text === "-" || text.startsWith("- ")) return false;
  return KEY_RE.test(text);
}

function unquote(raw: string): string {
  const text = raw.trim();
  if (text.length >= 2) {
    if (text.startsWith("'") && text.endsWith("'")) {
      return text.slice(1, -1).replace(/''/g, "'");
    }
    if (text.startsWith('"') && text.endsWith('"')) {
      return text.slice(1, -1).replace(/\\"/g, '"').replace(/\\n/g, "\n").replace(/\\\\/g, "\\");
    }
  }
  // YAML's null spellings; the callers treat missing and empty alike.
  if (text === "null" || text === "~") return "";
  return text;
}

function tokenize(source: string): Line[] {
  const lines: Line[] = [];
  for (const raw of source.split(/\r?\n/)) {
    const trimmedStart = raw.trimStart();
    if (trimmedStart === "" || trimmedStart.startsWith("#")) continue;
    if (trimmedStart.startsWith("---") || trimmedStart.startsWith("...")) continue;
    lines.push({
      indent: raw.length - trimmedStart.length,
      text: raw.trimEnd().slice(raw.length - trimmedStart.length),
    });
  }
  return lines;
}

class Reader {
  private index = 0;
  // Spelled out rather than a constructor parameter property: Node runs these
  // scripts by stripping types, which only supports erasable syntax.
  private readonly lines: Line[];

  constructor(lines: Line[]) {
    this.lines = lines;
  }

  private peek(): Line | undefined {
    return this.lines[this.index];
  }

  parseDocument(): YamlValue {
    const first = this.peek();
    if (!first) return {};
    return this.parseBlock(first.indent);
  }

  /** A block is either a sequence or a mapping, decided by its first line. */
  private parseBlock(indent: number): YamlValue {
    const line = this.peek();
    if (!line || line.indent < indent) return "";
    if (this.isDash(line.text)) return this.parseSequence(indent);
    const map: YamlMap = {};
    this.parseMappingInto(map, indent);
    return map;
  }

  private isDash(text: string): boolean {
    return text === "-" || text.startsWith("- ");
  }

  private parseSequence(indent: number): YamlValue[] {
    const items: YamlValue[] = [];
    for (;;) {
      const line = this.peek();
      if (!line || line.indent !== indent || !this.isDash(line.text)) break;
      this.index += 1;

      // A sequence item's block starts at the column of its first content
      // character, which is not always dash + 2 spaces. It has to be measured
      // from the dash rather than read off the following line: when the item's
      // first value wraps, that following line is the wrapped remainder sitting
      // deeper still, and treating its indent as the item's would strand it.
      let offset = 1;
      while (offset < line.text.length && /[ \t]/.test(line.text[offset] ?? "")) offset += 1;
      const remainder = offset < line.text.length ? line.text.slice(offset).trim() : "";
      const itemIndent = indent + (remainder === "" ? 2 : offset);

      if (remainder === "") {
        const next = this.peek();
        items.push(next && next.indent > indent ? this.parseBlock(next.indent) : "");
        continue;
      }
      if (isMappingStart(remainder)) {
        const map: YamlMap = {};
        this.consumeEntry(map, remainder, itemIndent);
        this.parseMappingInto(map, itemIndent);
        items.push(map);
        continue;
      }
      items.push(this.foldPlain(remainder, indent));
    }
    return items;
  }

  private parseMappingInto(map: YamlMap, indent: number): void {
    for (;;) {
      const line = this.peek();
      if (!line || line.indent !== indent || !isMappingStart(line.text)) break;
      this.index += 1;
      this.consumeEntry(map, line.text, indent);
    }
  }

  /** Adds one `key: value` entry, resolving a nested block if the value is empty. */
  private consumeEntry(map: YamlMap, text: string, indent: number): void {
    const match = KEY_RE.exec(text);
    if (!match) return;
    const key = match[1];
    if (key === undefined) return;
    map[key] = this.valueFor((match[2] ?? "").trim(), indent);
  }

  private valueFor(rest: string, indent: number): YamlValue {
    if (rest === "[]") return [];
    if (rest === "{}") return {};
    if (rest.startsWith("|") || rest.startsWith(">")) {
      return this.blockScalar(indent, rest.startsWith(">"));
    }
    if (rest !== "") return this.foldPlain(rest, indent);

    const next = this.peek();
    if (!next) return "";
    // A sequence is allowed to sit at its own key's indent.
    if (next.indent === indent && this.isDash(next.text)) return this.parseSequence(indent);
    if (next.indent > indent) return this.parseBlock(next.indent);
    return "";
  }

  /**
   * A scalar may continue on following, more-indented lines; YAML joins them
   * with a single space. This is how the corpus wraps long `address:` values and
   * biography notes at 80 columns.
   *
   * Once a key has a non-empty value, *every* deeper line belongs to that
   * scalar — a sibling key or sequence item would sit at the same indent, not a
   * greater one. So this deliberately does not stop at a wrapped line that
   * happens to look like structure, which is what a prose value continuing
   * "- Board (2002-2012), …" looks like.
   */
  private foldPlain(first: string, indent: number): string {
    const parts = [first];
    for (;;) {
      const next = this.peek();
      if (!next || next.indent <= indent) break;
      this.index += 1;
      parts.push(next.text.trim());
    }
    return unquote(parts.join(" "));
  }

  /** True once every tokenized line has been consumed. */
  atEnd(): boolean {
    return this.index >= this.lines.length;
  }

  remainingLine(): string {
    return this.lines[this.index]?.text ?? "";
  }

  private blockScalar(indent: number, folded: boolean): string {
    const parts: string[] = [];
    for (;;) {
      const line = this.peek();
      if (!line || line.indent <= indent) break;
      this.index += 1;
      parts.push(line.text);
    }
    return folded ? parts.join(" ").trim() : parts.join("\n");
  }
}

/**
 * Parses one YAML document. Throws if the reader could not account for every
 * line — a silent partial parse would look like a record with missing fields,
 * which is far worse than a skipped record.
 */
export function parseYaml(source: string): YamlValue {
  const reader = new Reader(tokenize(source));
  const value = reader.parseDocument();
  if (!reader.atEnd()) {
    throw new Error(`unsupported YAML near: ${reader.remainingLine().slice(0, 80)}`);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Typed accessors — parsed YAML is untrusted, so every read is checked.
// ---------------------------------------------------------------------------

export function isYamlMap(value: YamlValue | undefined): value is YamlMap {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asString(value: YamlValue | undefined): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/** Reads a field that may legitimately be a single item or a list of them. */
export function asList(value: YamlValue | undefined): YamlValue[] {
  if (value === undefined) return [];
  if (Array.isArray(value)) return value;
  if (value === "") return [];
  return [value];
}

/** The `url` of each entry in a `links:` / `sources:` style list, in order. */
export function urlList(value: YamlValue | undefined): string[] {
  const out: string[] = [];
  for (const entry of asList(value)) {
    if (isYamlMap(entry)) {
      const url = asString(entry["url"]);
      if (url) out.push(url);
    } else if (typeof entry === "string" && /^https?:\/\//.test(entry.trim())) {
      out.push(entry.trim());
    }
  }
  return out;
}
