import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { Pool } from 'pg';
import { z } from 'zod';

const app = express();
const port = process.env.PORT || 3000;

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// Middleware
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true,
}));
app.use(express.json());

// Health check endpoints
app.get('/healthz', (req, res) => {
  res.status(200).json({ status: 'healthy', timestamp: new Date().toISOString() });
});

app.get('/ready', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.status(200).json({ status: 'ready', timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(503).json({ status: 'not ready', error: 'Database connection failed' });
  }
});

// Scorecard schema
const ScorecardSchema = z.object({
  service: z.string(),
  score: z.number().min(0).max(100),
  metrics: z.object({
    security: z.number().min(0).max(100),
    reliability: z.number().min(0).max(100),
    performance: z.number().min(0).max(100),
    maintainability: z.number().min(0).max(100),
  }),
  checks: z.array(z.object({
    name: z.string(),
    status: z.enum(['pass', 'fail', 'warning']),
    message: z.string(),
    score: z.number().min(0).max(100),
  })),
  lastUpdated: z.string().datetime(),
});

type Scorecard = z.infer<typeof ScorecardSchema>;

// Initialize database
async function initDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS scorecards (
        id SERIAL PRIMARY KEY,
        service VARCHAR(255) UNIQUE NOT NULL,
        score INTEGER NOT NULL,
        metrics JSONB NOT NULL,
        checks JSONB NOT NULL,
        last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS services (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) UNIQUE NOT NULL,
        repository VARCHAR(255) NOT NULL,
        owner VARCHAR(255) NOT NULL,
        description TEXT,
        status VARCHAR(50) DEFAULT 'active',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);
    
    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Database initialization failed:', error);
  }
}

// API Routes

// Get all scorecards
app.get('/api/scorecards', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT service, score, metrics, checks, last_updated 
      FROM scorecards 
      ORDER BY last_updated DESC
    `);
    
    const scorecards = result.rows.map(row => ({
      service: row.service,
      score: row.score,
      metrics: row.metrics,
      checks: row.checks,
      lastUpdated: row.last_updated,
    }));
    
    res.json(scorecards);
  } catch (error) {
    console.error('Error fetching scorecards:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get scorecard for specific service
app.get('/api/scorecards/:service', async (req, res) => {
  try {
    const { service } = req.params;
    const result = await pool.query(
      'SELECT service, score, metrics, checks, last_updated FROM scorecards WHERE service = $1',
      [service]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Scorecard not found' });
    }
    
    const scorecard = {
      service: result.rows[0].service,
      score: result.rows[0].score,
      metrics: result.rows[0].metrics,
      checks: result.rows[0].checks,
      lastUpdated: result.rows[0].last_updated,
    };
    
    res.json(scorecard);
  } catch (error) {
    console.error('Error fetching scorecard:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update or create scorecard
app.post('/api/scorecards/:service', async (req, res) => {
  try {
    const { service } = req.params;
    const scorecardData = ScorecardSchema.parse({
      ...req.body,
      service,
      lastUpdated: new Date().toISOString(),
    });
    
    const result = await pool.query(`
      INSERT INTO scorecards (service, score, metrics, checks, last_updated)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (service) 
      DO UPDATE SET 
        score = EXCLUDED.score,
        metrics = EXCLUDED.metrics,
        checks = EXCLUDED.checks,
        last_updated = EXCLUDED.last_updated
      RETURNING service, score, metrics, checks, last_updated
    `, [
      scorecardData.service,
      scorecardData.score,
      JSON.stringify(scorecardData.metrics),
      JSON.stringify(scorecardData.checks),
      scorecardData.lastUpdated,
    ]);
    
    res.json(result.rows[0]);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid scorecard data', details: error.errors });
    }
    console.error('Error updating scorecard:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all services
app.get('/api/services', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT s.*, sc.score, sc.last_updated as scorecard_updated
      FROM services s
      LEFT JOIN scorecards sc ON s.name = sc.service
      ORDER BY s.created_at DESC
    `);
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching services:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Register a new service
app.post('/api/services', async (req, res) => {
  try {
    const { name, repository, owner, description } = req.body;
    
    if (!name || !repository || !owner) {
      return res.status(400).json({ error: 'Missing required fields: name, repository, owner' });
    }
    
    const result = await pool.query(`
      INSERT INTO services (name, repository, owner, description)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [name, repository, owner, description]);
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') { // Unique violation
      return res.status(409).json({ error: 'Service already exists' });
    }
    console.error('Error creating service:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get service templates
app.get('/api/templates', async (req, res) => {
  try {
    // This would typically fetch from a templates repository
    const templates = [
      {
        id: 'node-service',
        name: 'Node.js Service',
        description: 'A production-ready Node.js microservice with TypeScript',
        language: 'typescript',
        framework: 'express',
        features: ['api', 'database', 'testing', 'ci-cd', 'monitoring'],
        repository: `https://github.com/${process.env.GITHUB_ORG}/devopscanvas-templates`,
        path: 'node-service',
      },
      {
        id: 'python-service',
        name: 'Python Service',
        description: 'A FastAPI-based Python microservice',
        language: 'python',
        framework: 'fastapi',
        features: ['api', 'database', 'testing', 'ci-cd', 'monitoring'],
        repository: `https://github.com/${process.env.GITHUB_ORG}/devopscanvas-templates`,
        path: 'python-service',
      },
      {
        id: 'react-app',
        name: 'React Application',
        description: 'A modern React application with TypeScript',
        language: 'typescript',
        framework: 'react',
        features: ['spa', 'testing', 'ci-cd', 'monitoring'],
        repository: `https://github.com/${process.env.GITHUB_ORG}/devopscanvas-templates`,
        path: 'react-app',
      },
    ];
    
    res.json(templates);
  } catch (error) {
    console.error('Error fetching templates:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Error handling middleware
app.use((error: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Unhandled error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
async function startServer() {
  await initDatabase();
  
  app.listen(port, () => {
    console.log(`DevOpsCanvas Control Plane API running on port ${port}`);
    console.log(`Environment: ${process.env.NODE_ENV}`);
    console.log(`GitHub Org: ${process.env.GITHUB_ORG}`);
  });
}

startServer().catch(console.error);

export default app;