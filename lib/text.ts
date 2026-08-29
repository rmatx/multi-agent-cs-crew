/**
 * Assistant text, as the customer should read it.
 *
 * The coordinator is told to reply in plain sentences, and mostly does. Sometimes it emits
 * markdown emphasis anyway — an observed turn showed the customer a ticket id as
 * `**STUB-63311DF3**`, asterisks and all, because this client renders text rather than
 * markdown. Adding a markdown renderer would be a dependency, a sanitiser, and an XSS surface
 * for the sake of bold text nobody asked for; adding another prompt line would be a request,
 * and the same lesson keeps arriving — a rule only in prompt text is not a control.
 *
 * So the presentation layer strips the markers it knows about. Deliberately narrow: paired
 * emphasis and leading list bullets, nothing else. It cannot break meaning, and if the model
 * stops emitting markdown this quietly does nothing.
 */

/** Paired `**bold**`, `__bold__`, `*italic*`, `_italic_`, and `` `code` ``. */
const PAIRED = [
  /\*\*(.+?)\*\*/g,
  // The `__` guard is not optional: without it `mcp__novamart__get_order` — a tool name that
  // appears in trace-adjacent copy — comes out as `mcpnovamartget_order`.
  /(?<![\w_])__(?!\s)(.+?)(?<!\s)__(?![\w_])/g,
  // Single markers require a non-space neighbour so "2 * 3" and snake_case survive intact.
  /(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])/g,
  /(?<![\w_])_(?!\s)(.+?)(?<!\s)_(?![\w_])/g,
  /`([^`]+?)`/g,
];

export function plainText(text: string): string {
  let out = text;
  for (const pattern of PAIRED) out = out.replace(pattern, "$1");
  // A leading "- " or "* " reads fine as a line of text; the marker itself does not.
  return out.replace(/^[ \t]*[-*][ \t]+/gm, "• ");
}
