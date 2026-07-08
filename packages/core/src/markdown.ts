const URL_PATTERN = /https?:\/\/[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+/g;

export function normalizeMarkdownLinks(markdown: string): string {
  let inFence = false;

  return markdown
    .split("\n")
    .map((line) => {
      if (/^\s*```/.test(line)) {
        inFence = !inFence;
        return line;
      }

      return inFence ? line : formatMarkdownInlineText(line);
    })
    .join("\n");
}

export function formatMarkdownInlineText(value: string): string {
  return value.replace(URL_PATTERN, (url, offset, input) => {
    if (isMarkdownLinkTarget(input, offset)) {
      return url;
    }

    const { cleanUrl, suffix } = trimUrlSuffix(url);
    return `[リンク](${markdownLinkUrl(cleanUrl)})${suffix}`;
  });
}

export function markdownLinkUrl(value: string): string {
  return value.replace(/\(/g, "%28").replace(/\)/g, "%29");
}

function isMarkdownLinkTarget(input: string, offset: number): boolean {
  if (input[offset - 1] !== "(") {
    return false;
  }

  return /\[[^\]]+\]\($/.test(input.slice(Math.max(0, offset - 200), offset));
}

function trimUrlSuffix(url: string): { cleanUrl: string; suffix: string } {
  let cleanUrl = url;
  let suffix = "";

  while (/[.,;:!?]+$/.test(cleanUrl)) {
    suffix = `${cleanUrl.slice(-1)}${suffix}`;
    cleanUrl = cleanUrl.slice(0, -1);
  }

  while (cleanUrl.endsWith(")") && countChar(cleanUrl, ")") > countChar(cleanUrl, "(")) {
    suffix = `)${suffix}`;
    cleanUrl = cleanUrl.slice(0, -1);
  }

  return { cleanUrl, suffix };
}

function countChar(value: string, char: string): number {
  return [...value].filter((current) => current === char).length;
}
