import axios from 'axios';

// Create axios instance with default config
const api = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor to add auth token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor for error handling
api.interceptors.response.use(
  (response) => response,
  (error) => {
    // Handle 401 unauthorized
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

// Auth API
export const authApi = {
  login: (email, password) => api.post('/auth/login', { email, password }),
  getMe: () => api.get('/auth/me'),
  verify: () => api.get('/auth/verify'),
};

// Productos API
export const productosApi = {
  getAll: (params) => api.get('/productos', { params }),
  getOne: (id) => api.get(`/productos/${id}`),
  create: (data) => api.post('/productos', data),
  update: (id, data) => api.put(`/productos/${id}`, data),
  delete: (id) => api.delete(`/productos/${id}`),
  getCategorias: () => api.get('/productos/categorias'),
};

// Locaciones API
export const locacionesApi = {
  getAll: (params) => api.get('/locaciones', { params }),
  getOne: (id) => api.get(`/locaciones/${id}`),
  create: (data) => api.post('/locaciones', data),
  update: (id, data) => api.put(`/locaciones/${id}`, data),
  delete: (id) => api.delete(`/locaciones/${id}`),
  getTipos: () => api.get('/locaciones/tipos'),
};

// Transacciones API
export const transaccionesApi = {
  getAll: (params) => api.get('/transacciones', { params }),
  getOne: (id) => api.get(`/transacciones/${id}`),
  warehouseReceipt: (data) => api.post('/transacciones/warehouse-receipt', data),
  consignmentOut: (data) => api.post('/transacciones/consignment-out', data),
  consumption: (data) => api.post('/transacciones/consumption', data),
};

// Inventario API
export const inventarioApi = {
  getSummary: (params) => api.get('/inventario', { params }),
  getByLocation: (locationId) => api.get(`/inventario/location/${locationId}`),
  getByProduct: (productId) => api.get(`/inventario/product/${productId}`),
  getAlerts: () => api.get('/inventario/alerts'),

  // Lotes
  getLotes: (params) => api.get('/inventario/lotes', { params }),
  getLotesByLocation: (locationId, params) => api.get(`/inventario/lotes/location/${locationId}`, { params }),
  getExpiringLotes: (params) => api.get('/inventario/lotes/expiring', { params }),

  // Dashboard
  getDashboardStats: () => api.get('/inventario/dashboard/stats'),
};

// Analytics API
export const analyticsApi = {
  // Consumption analytics
  getMonthlyConsumption: (params) => api.get('/analytics/consumption/monthly', { params }),
  getConsumptionByLocation: (params) => api.get('/analytics/consumption/by-location', { params }),
  getConsumptionTrends: (params) => api.get('/analytics/consumption/trends', { params }),
  getConsumptionBySize: (params) => api.get('/analytics/consumption/by-size', { params }),

  // Planning data
  getPlanningData: (params) => api.get('/analytics/planning-data', { params }),
};

export default api;
