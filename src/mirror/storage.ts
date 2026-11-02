/**
 * Confluence storage format, both directions.
 *
 * Confluence stores page bodies as XHTML (the "storage" representation), while
 * our mirror speaks plain text with a fenced YAML block. The round trip is the
 * part that can be tested without a site, so it lives here; the REST calls that
 * wrap it are a thin adapter on top.
 *
 * Rules:
 *  - the fenced YAML block becomes an `<ac:structured-macro name="code">` so it
 *    survives editing in the Confluence editor without being reflowed;
 *  - everything else becomes paragraphs;
 *  - reading back strips tags and unescapes entities, which is enough for
 *    `parseDecision` to find the fence again.
 */

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' ',
};

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function unescapeXml(value: string): string {
  return value.replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, (entity) => ENTITIES[entity] ?? entity);
}

const FENCE = /```ya?ml\s*\n([\s\S]*?)```/i;

export function toStorageFormat(body: string): string {
  const match = FENCE.exec(body);
  const prose = match ? body.replace(match[0], '\u0000FENCE\u0000') : body;

  const parts: string[] = [];
  const blocks = prose.split('\u0000FENCE\u0000');

  const proseToParagraphs = (text: string): string =>
    text
      .split(/\n{2,}/)
      .map((chunk) => chunk.trim())
      .filter(Boolean)
      .map((chunk) => {
        // Preserve line structure inside a paragraph without inventing markup.
        const lines = chunk.split('\n').map((line) => escapeXml(line)).join('<br/>');
        return `<p>${lines}</p>`;
      })
      .join('\n');

  parts.push(proseToParagraphs(blocks[0] ?? ''));

  if (match?.[1]) {
    const yaml = match[1].trimEnd();
    parts.push(
      [
        '<ac:structured-macro ac:name="code">',
        '<ac:parameter ac:name="language">yaml</ac:parameter>',
        `<ac:plain-text-body><![CDATA[${yaml}]]></ac:plain-text-body>`,
        '</ac:structured-macro>',
      ].join(''),
    );
  }

  parts.push(proseToParagraphs(blocks[1] ?? ''));

  return parts.filter(Boolean).join('\n');
}

/**
 * Rebuilds plain text from storage XHTML. Deliberately forgiving: Confluence
 * editors inject their own markup, and a mirror that breaks on a stray `<span>`
 * would be worse than one that tolerates it.
 */
export function fromStorageFormat(storage: string): string {
  let text = storage;

  // Code macros become fenced blocks again.
  text = text.replace(
    /<ac:structured-macro[^>]*ac:name="code"[^>]*>([\s\S]*?)<\/ac:structured-macro>/gi,
    (_whole, inner: string) => {
      const body = /<ac:plain-text-body>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/ac:plain-text-body>/i.exec(inner);
      const content = body?.[1] ?? '';
      return `\n\`\`\`yaml\n${content.trim()}\n\`\`\`\n`;
    },
  );

  text = text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '');

  text = unescapeXml(text);

  return text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
