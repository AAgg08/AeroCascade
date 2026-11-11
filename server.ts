import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import { SCENARIO_PRESETS } from './src/domain/scenarios.ts';
import {
  computeGraphCentrality,
  runDiscreteEventSimulation,
} from './src/domain/simulationEngine.ts';

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '5mb' }));

  const PYTHON_BACKEND_URL = process.env.PYTHON_BACKEND_URL || 'http://127.0.0.1:8000';

  async function proxyToPythonBackend(
    req: express.Request,
    res: express.Response,
    fallback: (reason?: string) => unknown
  ) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const targetUrl = `${PYTHON_BACKEND_URL}${req.originalUrl}`;

      const headers: Record<string, string> = {
        Accept: 'application/json',
      };
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        headers['Content-Type'] = 'application/json';
      }
      if (req.headers['authorization']) {
        headers['Authorization'] = String(req.headers['authorization']);
      }
      if (req.headers['x-aerocascade-role']) {
        headers['X-AeroCascade-Role'] = String(req.headers['x-aerocascade-role']);
      }

      // If payload is missing nodes or edges for simulation/centrality, populate from scenario preset
      let requestPayload = req.body;
      if (req.method === 'POST' && req.body && typeof req.body === 'object') {
        if (!req.body.nodes || !req.body.edges) {
          const preset = SCENARIO_PRESETS.find((s) => s.id === req.body.scenario_id) ?? SCENARIO_PRESETS[0];
          requestPayload = {
            ...req.body,
            nodes: req.body.nodes || preset.nodes,
            edges: req.body.edges || preset.edges,
          };
        }
      }

      const response = await fetch(targetUrl, {
        method: req.method,
        headers,
        body: req.method !== 'GET' && req.method !== 'HEAD' ? JSON.stringify(requestPayload) : undefined,
        signal: controller.signal,
      });

      if (response.ok) {
        res.setHeader('X-Backend-Engine', 'FastAPI-Python');
        const contentType = response.headers.get('content-type') || '';
        const contentDisp = response.headers.get('content-disposition');
        if (contentDisp) res.setHeader('Content-Disposition', contentDisp);
        if (contentType) res.setHeader('Content-Type', contentType);

        if (req.method === 'HEAD') {
          return res.status(response.status).end();
        }

        if (contentType.includes('application/json')) {
          const data = await response.json();
          return res.status(response.status).json(data);
        } else {
          const buffer = Buffer.from(await response.arrayBuffer());
          return res.status(response.status).send(buffer);
        }
      } else {
        const errJson = await response.json().catch(() => null);
        const errDetail = errJson?.detail || (await response.text().catch(() => ''));
        console.warn(`[Proxy] Python backend returned ${response.status} for ${req.originalUrl}. Detail: ${String(errDetail).slice(0, 160)}`);
        if (
          response.status === 400 ||
          response.status === 401 ||
          response.status === 403 ||
          response.status === 404 ||
          response.status === 409 ||
          response.status === 422
        ) {
          return res.status(response.status).json(errJson || { error: errDetail, detail: errDetail });
        }
        await fallback(`Python backend error HTTP ${response.status}: ${errDetail}`);
      }
    } catch (err) {
      await fallback(`Python backend unreachable: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      clearTimeout(timeout);
    }
  }

  app.get('/api/health', async (req, res) => {
    await proxyToPythonBackend(req, res, (reason) => {
      res.setHeader('X-Backend-Engine', 'TypeScript-Gateway');
      res.status(200).json({
        status: 'degraded',
        engine: 'AeroCascade Gateway (Python Backend Offline)',
        python_status: 'offline',
        reason,
        frameworks: [
          'Dhillon & Moores (2001) Tripartite Controls',
          'EASA Part-IS (EU) 2022/1645 & (EU) 2023/203',
          'EUROCAE ER-040 Safety-Risk Matrix',
          'PSOE Maturity Model',
        ],
      });
    });
  });

  app.get('/api/scenarios', (_req, res) => {
    res.json({ scenarios: SCENARIO_PRESETS });
  });

  app.post('/api/simulate', async (req, res) => {
    // Validate empty nodes before forwarding
    if (req.body && Array.isArray(req.body.nodes) && req.body.nodes.length === 0) {
      return res.status(400).json({ error: 'Node list cannot be empty for simulation' });
    }

    const allowLegacyDemo = req.query.allow_legacy_demo === 'true' || req.headers['x-allow-legacy-demo'] === 'true';

    await proxyToPythonBackend(req, res, (fallbackReason) => {
      if (!allowLegacyDemo) {
        res.setHeader('X-Backend-Engine', 'Python-Unavailable');
        return res.status(503).json({
          error: 'Authoritative Python simulation engine is offline',
          detail: fallbackReason,
          hint: 'Start FastAPI backend with: backend/.venv/bin/uvicorn backend.main:app --host 127.0.0.1 --port 8000 (or request with ?allow_legacy_demo=true for uncalibrated demo mode)',
          is_fallback: false,
        });
      }

      // Explicit legacy demo mode
      try {
        const payload = req.body;
        const result = runDiscreteEventSimulation({
          scenario_id: payload.scenario_id || 'rtc-optical-asmgcs-spoof',
          horizon_hours: Number(payload.horizon_hours || 24),
          baseline_movements_per_hour: Number(payload.baseline_movements_per_hour || 48),
          trigger_hour: Number(payload.trigger_hour ?? 4),
          nodes: Array.isArray(payload.nodes) ? payload.nodes : SCENARIO_PRESETS[0].nodes,
          edges: Array.isArray(payload.edges) ? payload.edges : SCENARIO_PRESETS[0].edges,
          provenance: {
            engine: 'server-typescript',
            engine_label: 'Node.js Express (Legacy Illustrative Demo - Uncalibrated)',
            model_version: '1.0.0-legacy-demo',
            input_revision: Number(payload.input_revision || 1),
            generated_at: new Date().toISOString(),
            is_fallback: true,
            fallback_reason: `Explicit legacy demo mode invoked (${fallbackReason})`,
          },
        });
        res.setHeader('X-Backend-Engine', 'TypeScript-Legacy-Demo');
        res.json(result);
      } catch (err) {
        res.status(400).json({
          error: err instanceof Error ? err.message : 'Legacy demo simulation failed',
        });
      }
    });
  });

  app.post('/api/topology/centrality', async (req, res) => {
    if (req.body && Array.isArray(req.body.nodes) && req.body.nodes.length === 0) {
      return res.status(400).json({ error: 'Node list cannot be empty for topology analysis' });
    }

    const allowLegacyDemo = req.query.allow_legacy_demo === 'true' || req.headers['x-allow-legacy-demo'] === 'true';

    await proxyToPythonBackend(req, res, (fallbackReason) => {
      if (!allowLegacyDemo) {
        res.setHeader('X-Backend-Engine', 'Python-Unavailable');
        return res.status(503).json({
          error: 'Authoritative Python centrality engine is offline',
          detail: fallbackReason,
          is_fallback: false,
        });
      }
      try {
        const { scenario_id, nodes, edges } = req.body;
        const analytics = computeGraphCentrality(
          Array.isArray(nodes) ? nodes : SCENARIO_PRESETS[0].nodes,
          Array.isArray(edges) ? edges : SCENARIO_PRESETS[0].edges
        );
        res.setHeader('X-Backend-Engine', 'TypeScript-Legacy-Demo');
        res.json({ scenario_id: scenario_id || 'rtc-optical-asmgcs-spoof', node_analytics: analytics });
      } catch (err) {
        res.status(400).json({
          error: err instanceof Error ? err.message : 'Topology analysis failed',
        });
      }
    });
  });

  app.all('/api/topologies*', async (req, res) => {
    await proxyToPythonBackend(req, res, (reason) => {
      res.status(503).json({
        error: 'Topology repository offline',
        detail: reason,
        hint: 'Start the Python backend with: python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000',
      });
    });
  });

  app.all('/api/runs*', async (req, res) => {
    await proxyToPythonBackend(req, res, (reason) => {
      res.status(503).json({
        error: 'Simulation runs repository offline',
        detail: reason,
      });
    });
  });

  app.all('/api/import*', async (req, res) => {
    await proxyToPythonBackend(req, res, (reason) => {
      res.status(503).json({
        error: 'Topology importer backend offline',
        detail: reason,
      });
    });
  });

  app.all(['/api/review*', '/api/dossier*', '/api/export*', '/api/admin*'], async (req, res) => {
    await proxyToPythonBackend(req, res, (reason) => {
      res.status(503).json({
        error: 'Backend governance service offline',
        detail: reason,
      });
    });
  });

  app.get('/api/backend-source', (_req, res) => {
    if (process.env.ENTERPRISE_MODE === 'true' || process.env.NODE_ENV === 'production') {
      return res.status(403).json({
        error: 'Backend source viewer is disabled in the enterprise profile.',
      });
    }
    try {
      const backendDir = path.resolve(process.cwd(), 'backend');
      const files = ['main.py', 'models.py', 'graph_engine.py', 'simpy_engine.py', 'requirements.txt'];
      const sources: Record<string, string> = {};
      for (const file of files) {
        const fullPath = path.join(backendDir, file);
        if (fs.existsSync(fullPath)) {
          sources[file] = fs.readFileSync(fullPath, 'utf-8');
        }
      }
      res.json({ files: sources });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Could not read Python backend source files',
      });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`AeroCascade server listening on http://localhost:${PORT}`);
  });
}

startServer();
