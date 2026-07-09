import { Marked, type Tokens } from "marked";
import type { GitppouConfig } from "./types.js";

export function renderReportHtml(
  markdown: string,
  config: GitppouConfig,
): string {
  const html = renderMarkdown(markdown);
  const title =
    config.reportLanguage === "ja"
      ? `日報 - ${config.reportDate}`
      : `Daily Report - ${config.reportDate}`;

  return `<!doctype html>
<html lang="${config.reportLanguage}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
${REPORT_CSS}
  </style>
</head>
<body>
  <main class="report">
${html}
  </main>
  <script type="module">
    import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";
    mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "default" });
    await mermaid.run({ querySelector: ".mermaid" });
  </script>
</body>
</html>
`;
}

function renderMarkdown(markdown: string): string {
  const marked = new Marked({
    async: false,
    gfm: true,
    breaks: false,
    renderer: {
      code(token: Tokens.Code): string {
        const lang = token.lang?.trim().split(/\s+/)[0]?.toLowerCase();
        if (lang === "mermaid") {
          return `<pre class="mermaid">${escapeHtml(token.text)}</pre>\n`;
        }

        const languageClass = lang
          ? ` class="language-${escapeHtmlAttribute(lang)}"`
          : "";
        return `<pre><code${languageClass}>${escapeHtml(token.text)}</code></pre>\n`;
      },
      html(token: Tokens.HTML | Tokens.Tag): string {
        return escapeHtml(token.text);
      },
    },
  });

  return marked.parse(markdown, { async: false });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeHtmlAttribute(value: string): string {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

const REPORT_CSS = `:root {
  color-scheme: light;
  --bg: #f6f7f9;
  --paper: #ffffff;
  --text: #1f2328;
  --muted: #667085;
  --border: #d8dee4;
  --accent: #0969da;
  --code-bg: #f3f4f6;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font: 15px/1.75 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

.report {
  width: min(980px, calc(100% - 32px));
  margin: 32px auto;
  padding: 48px;
  background: var(--paper);
  border: 1px solid var(--border);
  border-radius: 8px;
}

h1,
h2,
h3 {
  line-height: 1.35;
  margin: 1.8em 0 0.7em;
}

h1 {
  margin-top: 0;
  padding-bottom: 0.35em;
  border-bottom: 1px solid var(--border);
  font-size: 2rem;
}

h2 {
  padding-bottom: 0.3em;
  border-bottom: 1px solid var(--border);
  font-size: 1.45rem;
}

h3 {
  font-size: 1.15rem;
}

p,
ul,
ol,
blockquote,
pre {
  margin: 0.85em 0;
}

ul,
ol {
  padding-left: 1.4em;
}

a {
  color: var(--accent);
  text-decoration: none;
}

a:hover {
  text-decoration: underline;
}

blockquote {
  padding: 0.6em 0 0.6em 1em;
  border-left: 4px solid var(--border);
  color: var(--muted);
}

code {
  padding: 0.15em 0.3em;
  background: var(--code-bg);
  border-radius: 4px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.92em;
}

pre {
  overflow: auto;
  padding: 1em;
  background: var(--code-bg);
  border-radius: 6px;
}

pre code {
  padding: 0;
  background: transparent;
}

.mermaid {
  background: #ffffff;
  border: 1px solid var(--border);
}

table {
  width: 100%;
  border-collapse: collapse;
}

th,
td {
  padding: 0.5em 0.7em;
  border: 1px solid var(--border);
}

th {
  background: #f6f8fa;
}

@media (max-width: 720px) {
  .report {
    width: 100%;
    margin: 0;
    padding: 24px 18px;
    border: 0;
    border-radius: 0;
  }
}

@media print {
  body {
    background: #ffffff;
  }

  .report {
    width: 100%;
    margin: 0;
    padding: 0;
    border: 0;
  }
}`;
