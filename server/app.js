const express = require('express');
const morgan = require('morgan');
const helmet = require('helmet');
const corsMiddleware = require('./util/cors');
require('./connection'); // Initialize MongoDB connection

const app = express();

// Middleware
app.use(helmet());
app.use(corsMiddleware);
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'vasculares-api',
    timestamp: new Date().toISOString()
  });
});

// API Routes
const authRoutes = require('./routes/auth');
const productosRoutes = require('./routes/productos');
const locacionesRoutes = require('./routes/locaciones');
const inventarioRoutes = require('./routes/inventario');
const transaccionesRoutes = require('./routes/transacciones');

app.use('/api/auth', authRoutes);
app.use('/api/productos', productosRoutes);
app.use('/api/locaciones', locacionesRoutes);
app.use('/api/inventario', inventarioRoutes);
app.use('/api/transacciones', transaccionesRoutes);

// Serve static files in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static('../client/dist'));
  app.get('*', (req, res) => {
    res.sendFile('index.html', { root: '../client/dist' });
  });
}

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

module.exports = app;
