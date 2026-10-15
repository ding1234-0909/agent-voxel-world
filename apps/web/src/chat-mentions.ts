/** Only inspect the text before the caret; names may contain spaces. */
export function mentionQuery(text: string, caret: number) {
  const match = text.slice(0, caret).match(/(?:^|[^a-zA-Z0-9_@])@([^@\n]*)$/u);
  if (!match) return null;
  return {
    source: 'input' as const,
    query: match[1],
    start: caret - match[1].length - 1,
    end: caret,
  };
}

/** A selected recipient becomes a chip, not another copy in the message. */
export function consumeMention(text: string, start: number, end: number) {
  return { text: text.slice(0, start) + text.slice(end), caret: start };
}
