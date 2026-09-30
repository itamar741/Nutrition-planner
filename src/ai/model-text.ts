const namedEntities: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"',
};

function safeCodePoint(value: string, radix: 10 | 16) {
  const codePoint = Number.parseInt(value, radix);
  if (
    !Number.isInteger(codePoint) ||
    codePoint > 0x10ffff ||
    (codePoint >= 0xd800 && codePoint <= 0xdfff) ||
    (codePoint < 0x20 && ![0x09, 0x0a, 0x0d].includes(codePoint))
  ) {
    return null;
  }
  return String.fromCodePoint(codePoint);
}

export function normalizeModelText(value: string) {
  const decoded = value.replace(
    /&#(?:x([0-9a-f]{1,6})|([0-9]{1,7}));|&(amp|apos|gt|lt|nbsp|quot);/giu,
    (
      entity,
      hexadecimal: string | undefined,
      decimal: string | undefined,
      named: string | undefined,
    ) => {
      if (hexadecimal) return safeCodePoint(hexadecimal, 16) ?? entity;
      if (decimal) return safeCodePoint(decimal, 10) ?? entity;
      return namedEntities[named?.toLowerCase() ?? ""] ?? entity;
    },
  );
  const sentences = decoded.match(/[^.!?]+[.!?]+|[^.!?]+$/gu);
  if (!sentences || sentences.length < 2) return decoded;
  const signature = (sentence: string) =>
    sentence
      .trim()
      .toLocaleLowerCase("en-US")
      .replace(/^(?:i['’]?m|i am) sorry,?\s+(?:but\s+)?/u, "")
      .replace(/\s+/gu, " ");
  return sentences
    .filter(
      (sentence, index) =>
        index === 0 || signature(sentence) !== signature(sentences[index - 1]),
    )
    .join("");
}
