import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import { resolveProvider } from '../providers/index.js';
import { encrypt, decrypt, maskKey } from '../lib/crypto.js';

export const keysRouter = Router();

// Active providers — must match providers/index.ts registrations + shared/types.ts Platform.
const PLATFORMS = [
  'google', 'groq', 'cerebras', 'sambanova', 'nvidia', 'mistral',
  'openrouter', 'github', 'cohere', 'cloudflare', 'huggingface', 'together', 'zhipu', 'ollama',
  'kilo', 'pollinations', 'llm7', 'bedrock', 'custom',
] as const;

// `key` is optional so keyless providers can be added without one;
// the handler enforces a non-empty key for everyone else.
const addKeySchema = z.object({
  platform: z.enum(PLATFORMS),
  key: z.string().optional(),
  label: z.string().optional(),
});

const updateKeySchema = z.object({
  enabled: z.boolean().optional(),
  label: z.string().optional(),
}).refine(data => data.enabled !== undefined || data.label !== undefined, {
  message: 'At least one of enabled or label must be provided',
});

// List all keys (masked)
keysRouter.get('/', (_req: Request, res: Response) => {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM api_keys ORDER BY created_at DESC').all() as any[];

  const keys = rows.map(row => {
    let maskedKey = '****';
    try {
      const realKey = decrypt(row.encrypted_key, row.iv, row.auth_tag);
      maskedKey = maskKey(realKey);
    } catch {
      maskedKey = '[decrypt failed]';
    }
    return {
      id: row.id,
      platform: row.platform,
      label: row.label,
      maskedKey,
      baseUrl: row.base_url ?? null,
      status: row.status,
      enabled: row.enabled === 1,
      createdAt: row.created_at,
      lastCheckedAt: row.last_checked_at,
    };
  });

  res.json(keys);
});

// Add a key
keysRouter.post('/', (req: Request, res: Response) => {
  const parsed = addKeySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: parsed.error.errors.map(e => e.message).join(', ') } });
    return;
  }

  const { platform, label } = parsed.data;
  const isKeyless = resolveProvider(platform)?.keyless === true;
  const rawKey = parsed.data.key?.trim() ?? '';

  if (!isKeyless && !rawKey) {
    res.status(400).json({ error: { message: 'key is required' } });
    return;
  }

  // Keyless providers store a sentinel so routing sees the platform as
  // configured; the provider omits the auth header on outgoing calls.
  const keyToStore = isKeyless ? (rawKey || 'no-key') : rawKey;

  const db = getDb();

  // A keyless provider needs only one sentinel row — re-enable an existing one.
  if (isKeyless) {
    const existing = db.prepare('SELECT id FROM api_keys WHERE platform = ? LIMIT 1').get(platform) as { id: number } | undefined;
    if (existing) {
      db.prepare("UPDATE api_keys SET enabled = 1, status = 'unknown' WHERE id = ?").run(existing.id);
      res.status(200).json({
        id: existing.id,
        platform,
        label: label ?? '',
        maskedKey: maskKey(keyToStore),
        status: 'unknown',
        enabled: true,
      });
      return;
    }
  }

  const { encrypted, iv, authTag } = encrypt(keyToStore);
  const result = db.prepare(`
    INSERT INTO api_keys (platform, label, encrypted_key, iv, auth_tag, status, enabled)
    VALUES (?, ?, ?, ?, ?, 'unknown', 1)
  `).run(platform, label ?? '', encrypted, iv, authTag);

  res.status(201).json({
    id: result.lastInsertRowid,
    platform,
    label: label ?? '',
    maskedKey: maskKey(keyToStore),
    status: 'unknown',
    enabled: true,
  });
});

// ── Custom OpenAI-compatible endpoint ────────────────────────────────────────
// Registers a local or self-hosted inference server (llama.cpp, LM Studio,
// vLLM, local Ollama, etc.) by base URL. One shared 'custom' api_keys row
// holds the endpoint; each model registered through it enters the fallback chain.
const customProviderSchema = z.object({
  baseUrl: z.string().url('baseUrl must be a valid URL'),
  model: z.string().min(1, 'model is required'),
  displayName: z.string().optional(),
  apiKey: z.string().optional(),
  label: z.string().optional(),
});

// List custom models
keysRouter.get('/custom/models', (_req: Request, res: Response) => {
  const db = getDb();
  const modelRows = db.prepare(`
    SELECT id, model_id, display_name, enabled, intelligence_rank, speed_rank, size_label, base_url
    FROM models
    WHERE platform = 'custom'
    ORDER BY id ASC
  `).all() as any[];

  const models = modelRows.map(row => ({
    id: row.id,
    modelId: row.model_id,
    displayName: row.display_name,
    enabled: row.enabled === 1,
    sizeLabel: row.size_label,
    baseUrl: row.base_url ?? null,
    keyStatus: 'unknown',
  }));
  res.json(models);
});

// ── Discover models from custom endpoint ───────────────────────────────────
// Probes {baseUrl}/models to list available models for bulk import.
const discoverSchema = z.object({
  baseUrl: z.string().url('baseUrl must be a valid URL'),
  apiKey: z.string().optional(),
});

keysRouter.post('/custom/discover', async (req: Request, res: Response) => {
  const parsed = discoverSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: parsed.error.errors.map(e => e.message).join(', ') } });
    return;
  }

  const baseUrl = parsed.data.baseUrl.trim().replace(/\/+$/, '');
  const apiKey = parsed.data.apiKey?.trim() || '';

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 10000);

    const resp = await fetch(`${baseUrl}/models`, { headers, signal: abort.signal });
    clearTimeout(timer);

    if (!resp.ok) {
      const errBody = await resp.json().catch(() => ({}));
      res.status(502).json({
        error: { message: `Endpoint returned ${resp.status}: ${(errBody as any).error?.message ?? resp.statusText}` },
      });
      return;
    }

    const body = await resp.json() as { data?: Array<{ id: string; object?: string }> };
    if (!body.data || !Array.isArray(body.data)) {
      res.status(502).json({ error: { message: 'Unexpected response format from /v1/models' } });
      return;
    }

    // Filter to likely chat-capable models (non-embedding).
    // OpenAI-compatible /v1/models returns objects like:
    //   { id: "gpt-4", object: "model" }
    // Some endpoints return flat string arrays under data.
    const models = body.data
      .filter((m: any) => {
        if (typeof m === 'string') return true;
        // Skip embedding-only models
        const id = (m.id ?? '').toLowerCase();
        if (id.includes('embedding') || id.includes('ada')) return false;
        return true;
      })
      .map((m: any) => ({
        id: typeof m === 'string' ? m : m.id,
        object: typeof m === 'string' ? 'model' : (m.object ?? 'model'),
      }));

    res.json({ baseUrl, models });
  } catch (err: any) {
    if (err.name === 'AbortError') {
      res.status(504).json({ error: { message: 'Endpoint timed out after 10 seconds' } });
    } else {
      res.status(502).json({ error: { message: `Failed to reach endpoint: ${err.message}` } });
    }
  }
});

// ── Bulk import custom models ───────────────────────────────────────────────
// Accepts a base URL and array of model IDs, registers all at once.
const bulkImportSchema = z.object({
  baseUrl: z.string().url('baseUrl must be a valid URL'),
  models: z.array(z.string().min(1)).min(1, 'At least one model is required'),
  apiKey: z.string().optional(),
  label: z.string().optional(),
});

keysRouter.post('/custom/bulk', (req: Request, res: Response) => {
  const parsed = bulkImportSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: parsed.error.errors.map(e => e.message).join(', ') } });
    return;
  }

  const baseUrl = parsed.data.baseUrl.trim().replace(/\/+$/, '');
  const modelIds = parsed.data.models;
  const rawKey = parsed.data.apiKey?.trim() || 'no-key';
  const label = parsed.data.label ?? 'Custom';

  const db = getDb();
  const doImport = db.transaction(() => {
    // Find or create an api_keys row for this base_url
    const existingKey = db.prepare(
      "SELECT id FROM api_keys WHERE platform = 'custom' AND base_url = ? LIMIT 1"
    ).get(baseUrl) as { id: number } | undefined;

    let keyId: number;
    const { encrypted, iv, authTag } = encrypt(rawKey);
    if (existingKey) {
      db.prepare("UPDATE api_keys SET encrypted_key = ?, iv = ?, auth_tag = ?, status = 'unknown', enabled = 1 WHERE id = ?")
        .run(encrypted, iv, authTag, existingKey.id);
      keyId = existingKey.id;
    } else {
      const r = db.prepare(`
        INSERT INTO api_keys (platform, label, encrypted_key, iv, auth_tag, status, enabled, base_url)
        VALUES ('custom', ?, ?, ?, ?, 'unknown', 1, ?)
      `).run(label, encrypted, iv, authTag, baseUrl);
      keyId = Number(r.lastInsertRowid);
    }

    // Get the max priority currently in fallback chain
    const maxPriority = (db.prepare('SELECT COALESCE(MAX(priority), 0) AS m FROM fallback_config').get() as { m: number }).m;

    const imported: Array<{ modelId: string; displayName: string }> = [];

    for (let i = 0; i < modelIds.length; i++) {
      const modelId = modelIds[i].trim();
      // Skip if model already exists for this base_url
      const existing = db.prepare(
        "SELECT id FROM models WHERE platform = 'custom' AND model_id = ? AND base_url = ?"
      ).get(modelId, baseUrl) as { id: number } | undefined;
      if (existing) {
        imported.push({ modelId, displayName: modelId });
        continue;
      }

      const displayName = modelId;

      db.prepare(`
        INSERT INTO models
          (platform, model_id, display_name, intelligence_rank, speed_rank, size_label,
           rpm_limit, rpd_limit, tpm_limit, tpd_limit, monthly_token_budget, context_window, enabled, base_url)
        VALUES ('custom', ?, ?, 50, 50, 'Custom', NULL, NULL, NULL, NULL, '', NULL, 1, ?)
      `).run(modelId, displayName, baseUrl);

      const modelRow = db.prepare(
        "SELECT id FROM models WHERE platform = 'custom' AND model_id = ?"
      ).get(modelId) as { id: number };

      db.prepare('INSERT INTO fallback_config (model_db_id, priority, enabled) VALUES (?, ?, 1)')
        .run(modelRow.id, maxPriority + 1 + i);

      imported.push({ modelId, displayName });
    }

    return { keyId, imported };
  });

  const result = doImport();

  res.status(201).json({
    success: true,
    keyId: result.keyId,
    baseUrl,
    imported: result.imported,
    count: result.imported.length,
  });
});

// Delete a single custom model
keysRouter.delete('/custom/model/:modelId', (req: Request, res: Response) => {
  const modelId = String(req.params.modelId).trim();
  if (!modelId) {
    res.status(400).json({ error: { message: 'modelId is required' } });
    return;
  }

  const db = getDb();

  // Get the model's db id and priority
  const modelRow = db.prepare("SELECT id, enabled FROM models WHERE platform = 'custom' AND model_id = ?").get(modelId) as { id: number; enabled: number } | undefined;
  if (!modelRow) {
    res.status(404).json({ error: { message: 'Model not found' } });
    return;
  }

  // Delete from fallback_config first
  db.prepare('DELETE FROM fallback_config WHERE model_db_id = ?').run(modelRow.id);

  // Delete the model
  const result = db.prepare("DELETE FROM models WHERE platform = 'custom' AND model_id = ?").run(modelId);

  if (result.changes === 0) {
    res.status(404).json({ error: { message: 'Model not found' } });
    return;
  }

  // If this was the last custom model, also clean up the custom api_keys row
  const remaining = db.prepare("SELECT 1 FROM models WHERE platform = 'custom' LIMIT 1").get();
  if (!remaining) {
    // No more custom models, remove the custom api_keys entry too
    db.prepare("DELETE FROM api_keys WHERE platform = 'custom'").run();
  } else {
    // Re-assign priorities to keep fallback chain contiguous
    const models = db.prepare("SELECT id FROM models WHERE platform = 'custom' ORDER BY id ASC").all() as { id: number }[];
    models.forEach((m, idx) => {
      db.prepare('INSERT OR REPLACE INTO fallback_config (model_db_id, priority, enabled) VALUES (?, ?, 1)')
        .run(m.id, idx);
    });
  }

  res.json({ success: true, deletedModelId: modelId });
});

keysRouter.post('/custom', (req: Request, res: Response) => {
  const parsed = customProviderSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: parsed.error.errors.map(e => e.message).join(', ') } });
    return;
  }

  const baseUrl = parsed.data.baseUrl.trim().replace(/\/+$/, '');
  const modelId = parsed.data.model.trim();
  const displayName = (parsed.data.displayName ?? modelId).trim();
  const rawKey = parsed.data.apiKey?.trim() || 'no-key';
  const label = parsed.data.label ?? 'Custom';

  const db = getDb();
  const upsert = db.transaction(() => {
    // Find or create an api_keys row for this base_url — models sharing
    // the same endpoint should share one key.
    const existingKey = db.prepare(
      "SELECT id FROM api_keys WHERE platform = 'custom' AND base_url = ? LIMIT 1"
    ).get(baseUrl) as { id: number } | undefined;

    let keyId: number;
    const { encrypted, iv, authTag } = encrypt(rawKey);
    if (existingKey) {
      db.prepare("UPDATE api_keys SET encrypted_key = ?, iv = ?, auth_tag = ?, status = 'unknown', enabled = 1 WHERE id = ?")
        .run(encrypted, iv, authTag, existingKey.id);
      keyId = existingKey.id;
    } else {
      const r = db.prepare(`
        INSERT INTO api_keys (platform, label, encrypted_key, iv, auth_tag, status, enabled, base_url)
        VALUES ('custom', ?, ?, ?, ?, 'unknown', 1, ?)
      `).run(label, encrypted, iv, authTag, baseUrl);
      keyId = Number(r.lastInsertRowid);
    }

    // Register the model — insert if new, or update base_url if it already exists.
    // This ensures models created before base_url was added get their endpoint set.
    db.prepare(`
      INSERT INTO models
        (platform, model_id, display_name, intelligence_rank, speed_rank, size_label,
         rpm_limit, rpd_limit, tpm_limit, tpd_limit, monthly_token_budget, context_window, enabled, base_url)
      VALUES ('custom', ?, ?, 50, 50, 'Custom', NULL, NULL, NULL, NULL, '', NULL, 1, ?)
      ON CONFLICT(platform, model_id) DO UPDATE SET base_url = ?
    `).run(modelId, displayName, baseUrl, baseUrl);

    const modelRow = db.prepare("SELECT id FROM models WHERE platform = 'custom' AND model_id = ?").get(modelId) as { id: number };

    // Append to fallback chain if not already present.
    const inChain = db.prepare('SELECT 1 FROM fallback_config WHERE model_db_id = ?').get(modelRow.id);
    if (!inChain) {
      const max = db.prepare('SELECT COALESCE(MAX(priority), 0) AS m FROM fallback_config').get() as { m: number };
      db.prepare('INSERT INTO fallback_config (model_db_id, priority, enabled) VALUES (?, ?, 1)').run(modelRow.id, max.m + 1);
    }

    return { keyId, modelDbId: modelRow.id };
  });

  const { keyId, modelDbId } = upsert();
  res.status(201).json({
    success: true,
    keyId,
    modelDbId,
    platform: 'custom',
    baseUrl,
    model: modelId,
    displayName,
    maskedKey: maskKey(rawKey),
  });
});

// Toggle all keys for a platform
keysRouter.patch('/platform/:platform', (req: Request, res: Response) => {
  const platform = req.params.platform as string;
  if (!(PLATFORMS as readonly string[]).includes(platform)) {
    res.status(400).json({ error: { message: `Invalid platform '${platform}'` } });
    return;
  }

  const { enabled } = req.body;
  if (typeof enabled !== 'boolean') {
    res.status(400).json({ error: { message: 'enabled must be a boolean' } });
    return;
  }

  const db = getDb();
  const result = db.prepare('UPDATE api_keys SET enabled = ? WHERE platform = ?').run(enabled ? 1 : 0, platform);

  res.json({ success: true, enabled, updatedKeys: result.changes });
});

// Delete a key
keysRouter.delete('/:id', (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: { message: 'Invalid key ID' } });
    return;
  }

  const db = getDb();
  const result = db.prepare('DELETE FROM api_keys WHERE id = ?').run(id);

  if (result.changes === 0) {
    res.status(404).json({ error: { message: 'Key not found' } });
    return;
  }

  res.json({ success: true });
});

// Update key — toggle enable/disable and/or edit label
keysRouter.patch('/:id', (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: { message: 'Invalid key ID' } });
    return;
  }

  const parsed = updateKeySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: parsed.error.errors.map(e => e.message).join(', ') } });
    return;
  }

  const { enabled, label } = parsed.data;
  const updates: string[] = [];
  const values: (string | number)[] = [];

  if (enabled !== undefined) {
    updates.push('enabled = ?');
    values.push(enabled ? 1 : 0);
  }
  if (label !== undefined) {
    updates.push('label = ?');
    values.push(label);
  }

  values.push(id);

  const db = getDb();
  const result = db.prepare(`UPDATE api_keys SET ${updates.join(', ')} WHERE id = ?`).run(...values);

  if (result.changes === 0) {
    res.status(404).json({ error: { message: 'Key not found' } });
    return;
  }

  const response: Record<string, unknown> = { success: true };
  if (enabled !== undefined) response.enabled = enabled;
  if (label !== undefined) response.label = label;
  res.json(response);
});
