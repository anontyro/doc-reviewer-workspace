import type { Element, Root } from "hast";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";

/** Parser shared by rendering and resolving so both see the same document structure. */
export const parser = unified().use(remarkParse).use(remarkGfm);

/** Adds `data-sourcepos="l1:c1-l2:c2"` (comrak's format, spec D13: 1-based, end column inclusive). */
function sourcepos() {
  const walk = (node: Root | Element) => {
    if (node.type === "element" && node.position) {
      const { start, end } = node.position;
      node.properties["dataSourcepos"] =
        `${start.line}:${start.column}-${end.line}:${end.column - 1}`;
    }
    for (const child of node.children) if (child.type === "element") walk(child);
  };
  return walk;
}

// Sanitising runs after sourcepos so only the allow-listed attribute survives; raw HTML is dropped (spec D15).
const schema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    "*": [...(defaultSchema.attributes?.["*"] ?? []), "dataSourcepos"],
  },
};

const renderer = parser()
  .use(remarkRehype)
  .use(sourcepos)
  .use(rehypeSanitize, schema)
  .use(rehypeStringify);

export function renderMarkdown(source: string): string {
  return String(renderer.processSync(source));
}
