import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { AnalysisResult, ConfirmationDecision } from '../analysis/types.js';

export interface HistoryEntry {
  readonly id: string;
  readonly prompt: string;
  readonly analysis: AnalysisResult;
  readonly decision: ConfirmationDecision;
  readonly sent: boolean;
  readonly createdAt: string;
}

interface HistoryRow {
  id: string;
  prompt: string;
  analysis_json: string;
  decision_json: string;
  sent: number;
  created_at: string;
}

export function defaultHistoryPath(): string {
  return join(homedir(), '.prompt-oscilloscope', 'history.db');
}

export class HistoryStore {
  readonly #database: DatabaseSync;

  constructor(path = defaultHistoryPath()) {
    mkdirSync(dirname(path), { recursive: true });
    this.#database = new DatabaseSync(path);
    this.#migrate();
  }

  record(
    prompt: string,
    analysis: AnalysisResult,
    decision: ConfirmationDecision,
    sent: boolean,
  ): string {
    const id = randomUUID();
    this.#database
      .prepare(
        `INSERT INTO history (
          id, prompt, analysis_json, model, latency_ms, estimated_cost_usd,
          input_tokens, output_tokens, decision_json, sent, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        prompt,
        JSON.stringify(analysis),
        analysis.model,
        analysis.latencyMs,
        analysis.estimatedCostUsd,
        analysis.usage.input,
        analysis.usage.output,
        JSON.stringify(decision),
        sent ? 1 : 0,
        new Date().toISOString(),
      );
    return id;
  }

  list(limit = 50): HistoryEntry[] {
    const rows = this.#database
      .prepare(
        `SELECT id, prompt, analysis_json, decision_json, sent, created_at
         FROM history ORDER BY created_at DESC LIMIT ?`,
      )
      .all(Math.max(1, Math.min(limit, 500))) as unknown as HistoryRow[];
    return rows.map((row) => ({
      id: row.id,
      prompt: row.prompt,
      analysis: JSON.parse(row.analysis_json) as AnalysisResult,
      decision: JSON.parse(row.decision_json) as ConfirmationDecision,
      sent: row.sent === 1,
      createdAt: row.created_at,
    }));
  }

  delete(id: string): boolean {
    return this.#database.prepare('DELETE FROM history WHERE id = ?').run(id).changes > 0;
  }

  deleteAll(): number {
    return Number(this.#database.prepare('DELETE FROM history').run().changes);
  }

  close(): void {
    this.#database.close();
  }

  #migrate(): void {
    this.#database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS history (
        id TEXT PRIMARY KEY,
        prompt TEXT NOT NULL,
        analysis_json TEXT NOT NULL,
        model TEXT NOT NULL,
        latency_ms INTEGER NOT NULL,
        estimated_cost_usd REAL,
        input_tokens INTEGER NOT NULL,
        output_tokens INTEGER NOT NULL,
        decision_json TEXT NOT NULL,
        sent INTEGER NOT NULL CHECK (sent IN (0, 1)),
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS history_created_at ON history(created_at DESC);
      PRAGMA user_version = 1;
    `);
  }
}
