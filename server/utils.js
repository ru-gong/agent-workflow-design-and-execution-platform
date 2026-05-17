import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

export const ROOT = process.cwd();
export const RUNS_DIR = path.join(ROOT, "runs");
export const PLAN_SCHEMA_PATH = path.join(ROOT, "schemas", "orchestration-plan.schema.json");

export function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

export function notFound(res) {
  json(res, 404, { error: "Not found" });
}

export function badRequest(res, message, details) {
  json(res, 400, { error: message, details });
}

export async function readJsonBody(req, maxBytes = 1_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) {
      throw new Error("Request body is too large");
    }
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  return JSON.parse(raw);
}

export function safeId(prefix = "id") {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

export async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

export function sendSse(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

export function clampText(value, max = 2000) {
  return String(value ?? "").replace(/\r/g, "").slice(0, max);
}

export function parseMaybeJson(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) throw new Error("Empty JSON response");
  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) return JSON.parse(fenced[1]);
    const first = trimmed.indexOf("{");
    const last = trimmed.lastIndexOf("}");
    if (first >= 0 && last > first) return JSON.parse(trimmed.slice(first, last + 1));
    throw new Error("Could not parse JSON response");
  }
}

export function normalizeError(error) {
  return {
    message: error?.message || String(error),
    stack: process.env.NODE_ENV === "test" ? undefined : error?.stack
  };
}
