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

  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      engine: 'AeroCascade Simulation & Graph Centrality Engine',
      frameworks: [
        'Dhillon & Moores (2001) Tripartite Controls',
        'EASA Part-IS (EU) 2022/1645 & (EU) 2023/203',
        'EUROCAE ER-040 Safety-Risk Matrix',
        'PSOE Maturity Model',
      ],
    });
  });

  app.get('/api/scenarios', (_req, res) => {
    res.json({ scenarios: SCENARIO_PRESETS });
  });

  app.post('/api/simulate', (req, res) => {
    try {
      const payload = req.body;
      const result = runDiscreteEventSimulation({
        scenario_id: payload.scenario_id || 'rtc-optical-asmgcs-spoof',
        horizon_hours: Number(payload.horizon_hours || 24),
        baseline_movements_per_hour: Number(payload.baseline_movements_per_hour || 48),
        trigger_hour: Number(payload.trigger_hour || 4),
        nodes: Array.isArray(payload.nodes) ? payload.nodes : SCENARIO_PRESETS[0].nodes,
        edges: Array.isArray(payload.edges) ? payload.edges : SCENARIO_PRESETS[0].edges,
      });
      res.json(result);
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Simulation failed',
      });
    }
  });

  app.post('/api/topology/centrality', (req, res) => {
    try {
      const { scenario_id, nodes, edges } = req.body;
      const analytics = computeGraphCentrality(
        Array.isArray(nodes) ? nodes : SCENARIO_PRESETS[0].nodes,
        Array.isArray(edges) ? edges : SCENARIO_PRESETS[0].edges
      );
      res.json({ scenario_id: scenario_id || 'rtc-optical-asmgcs-spoof', node_analytics: analytics });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Topology analysis failed',
      });
    }
  });

  app.get('/api/backend-source', (_req, res) => {
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
