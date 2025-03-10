import express from 'express';
import cors from 'cors';
import { config } from './config';
import urlRoutes from './routes/urls';

const app = express();

// Middleware
app.use(cors({
  origin: config.cors.origin,
  methods: ['GET', 'POST']
}));
app.use(express.json());

// Add request logging
app.use((req, _res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

// Routes
app.use('/api/urls', urlRoutes);

// Error handling
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something broke!' });
});

// Start server
const port = config.server.port;
app.listen(port, () => {
  console.log(`Server running on port ${port} in ${config.server.nodeEnv} mode`);
});