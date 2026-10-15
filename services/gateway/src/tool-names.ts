// Tools are exposed as "<slug>__<tool>". Slugs never contain "__", so the first "__" always ends the slug.
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
// What MCP clients accept for a tool name.
const TOOL_NAME = /^[a-zA-Z0-9_-]{1,64}$/;

export function isValidSlug(slug: string): boolean {
  return slug.length <= 20 && SLUG.test(slug);
}

export function isValidToolName(name: string): boolean {
  return TOOL_NAME.test(name);
}

export function prefixed(slug: string, tool: string): string {
  return `${slug}__${tool}`;
}

export function splitName(name: string): { slug: string; tool: string } | null {
  const at = name.indexOf("__");
  if (at <= 0 || at + 2 >= name.length) return null;
  return { slug: name.slice(0, at), tool: name.slice(at + 2) };
}
