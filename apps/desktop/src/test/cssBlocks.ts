/** A deliberately small CSS reader for token files: blocks, their selector path and declarations. */
export interface CssBlock {
  /** Selectors from the outermost at-rule to the rule itself, whitespace-normalised. */
  path: string[];
  declarations: Map<string, string>;
}

function normalise(selector: string): string {
  return selector.replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').trim();
}

function parseDeclarations(body: string): Map<string, string> {
  const declarations = new Map<string, string>();
  for (const part of body.split(';')) {
    const colon = part.indexOf(':');
    if (colon < 0) continue;
    const name = part.slice(0, colon).trim();
    const value = part.slice(colon + 1).replace(/\s+/g, ' ').trim();
    if (name) declarations.set(name, value);
  }
  return declarations;
}

export function parseCssBlocks(css: string): CssBlock[] {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const blocks: CssBlock[] = [];
  const stack: string[] = [];
  let buffer = '';
  for (const char of source) {
    if (char === '{') {
      stack.push(normalise(buffer));
      buffer = '';
    } else if (char === '}') {
      const declarations = parseDeclarations(buffer);
      if (declarations.size > 0) blocks.push({ path: [...stack], declarations });
      stack.pop();
      buffer = '';
    } else {
      buffer += char;
    }
  }
  return blocks;
}

export function findBlock(blocks: CssBlock[], ...path: string[]): CssBlock | undefined {
  const wanted = path.map(normalise);
  return blocks.find((block) => block.path.length === wanted.length && block.path.every((p, i) => p === wanted[i]));
}
