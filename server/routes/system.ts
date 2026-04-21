import express from 'express';
import os from 'os';

export const systemRouter = express.Router();

systemRouter.get('/system', (_req, res) => {
  const cpuCount = os.cpus().length;
  const loadAvg = os.loadavg();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  res.json({
    cpuLoad: parseFloat(Math.min((loadAvg[0] / cpuCount) * 100, 100).toFixed(1)),
    memUsed: parseFloat(((1 - freeMem / totalMem) * 100).toFixed(1)),
    uptime: Math.floor(os.uptime()),
  });
});
