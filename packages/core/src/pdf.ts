import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const CHROME_CANDIDATES = [
  "google-chrome",
  "google-chrome-stable",
  "chromium",
  "chromium-browser",
  "microsoft-edge",
];

export async function saveReportPdf(
  html: string,
  pdfPath: string,
): Promise<void> {
  const absolutePdfPath = path.resolve(pdfPath);
  await mkdir(path.dirname(absolutePdfPath), { recursive: true });

  const chromePath = await resolveChromeExecutable();
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "gitppou-pdf-"));

  try {
    const htmlPath = path.join(tempDir, "report.html");
    await writeFile(htmlPath, html, "utf8");
    await runChrome(chromePath, [
      "--headless",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--no-sandbox",
      "--no-pdf-header-footer",
      "--run-all-compositor-stages-before-draw",
      "--virtual-time-budget=10000",
      `--print-to-pdf=${absolutePdfPath}`,
      pathToFileURL(htmlPath).href,
    ]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function resolveChromeExecutable(): Promise<string> {
  const configured =
    process.env.GITPPOU_CHROME_PATH?.trim() ||
    process.env.CHROME_PATH?.trim() ||
    process.env.PUPPETEER_EXECUTABLE_PATH?.trim();
  if (configured) {
    if (await canRun(configured)) {
      return configured;
    }

    throw new Error(
      `Configured Chrome executable cannot be run: ${configured}`,
    );
  }

  for (const candidate of CHROME_CANDIDATES) {
    if (await canRun(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    "PDF report output requires Google Chrome or Chromium. Install Chrome or set GITPPOU_CHROME_PATH.",
  );
}

function canRun(command: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(command, ["--version"], {
      stdio: "ignore",
    });
    child.on("error", () => resolve(false));
    child.on("exit", (code) => resolve(code === 0));
  });
}

function runChrome(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const stderr: string[] = [];
    const child = spawn(command, args, {
      stdio: ["ignore", "ignore", "pipe"],
    });

    child.stderr.on("data", (chunk) => {
      stderr.push(String(chunk));
    });
    child.on("error", (error) => {
      reject(
        new Error(`Failed to run Chrome for PDF output. ${error.message}`),
      );
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          `Chrome PDF generation failed with exit code ${code ?? "unknown"}. ${truncate(stderr.join("").trim(), 500)}`,
        ),
      );
    });
  });
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }

  return `${value.slice(0, maxChars)}...`;
}
