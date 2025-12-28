import fs from 'fs/promises';
import path from 'path';

type JsonRecord = Record<string, unknown>;

function isDevEnabled(): boolean {
  return process.env.NODE_ENV === 'development';
}

function getLogDir(): string {
  // Allow override, but default to a local logs folder (gitignored by default)
  const override = process.env.LANGGRAPH_DEV_LOG_DIR;
  if (override && override.trim().length > 0) return override;
  return path.resolve(process.cwd(), 'logs', 'langgraph');
}

function safeFilenamePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_');
}

async function appendJsonl(filePath: string, payload: JsonRecord): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, `${JSON.stringify(payload)}\n`, 'utf8');
}

/**
 * Development-only LangGraph logger.
 * Writes one JSON object per line to a per-session file (JSONL) for easy sharing/debugging.
 *
 * This is a best-effort logger: any write errors are swallowed to avoid breaking the main flow.
 */
export async function devLogLangGraphEvent(
  sessionId: string,
  event: string,
  data: JsonRecord = {},
): Promise<void> {
  if (!isDevEnabled()) return;

  try {
    const dir = getLogDir();
    const file = path.join(dir, `${safeFilenamePart(sessionId)}.jsonl`);
    await appendJsonl(file, {
      ts: new Date().toISOString(),
      sessionId,
      event,
      ...data,
    });
  } catch {
    // Intentionally ignore logging errors in dev.
  }
}


