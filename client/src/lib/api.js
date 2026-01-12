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

// Inventario Objetivos API (Per-location targets)
export const inventarioObjetivosApi = {
  getAll: (params) => api.get('/inventario-objetivos', { params }),
  getOne: (id) => api.get(`/inventario-objetivos/${id}`),
  upsert: (data) => api.post('/inventario-objetivos', data), // Create or update
  update: (id, data) => api.put(`/inventario-objetivos/${id}`, data),
  delete: (id) => api.delete(`/inventario-objetivos/${id}`),
};

// Consignaciones API (Bulk consignments)
export const consignacionesApi = {
  getAll: (params) => api.get('/consignaciones', { params }),
  getOne: (id) => api.get(`/consignaciones/${id}`),
  create: (data) => api.post('/consignaciones', data),
  confirm: (id, data) => api.put(`/consignaciones/${id}/confirm`, data),
  retrySap: (id) => api.post(`/consignaciones/${id}/retry-sap`),
};

// SAP Integration API (for stock transfers, batch queries, etc.)
export const sapApi = {
  testConnection: () => api.get('/sap/test'),
  getWarehouses: () => api.get('/sap/warehouses'),
  getBinLocations: (warehouse) => api.get('/sap/bin-locations', { params: { warehouse } }),
  getItems: (params) => api.get('/sap/items', { params }),
  getSuppliers: (params) => api.get('/sap/suppliers', { params }),
  getCustomers: (params) => api.get('/sap/customers', { params }),
  getBatchStock: (itemCode, warehouseCode) => api.get('/sap/batch-stock', { params: { itemCode, warehouseCode } }),
  getInventory: (locationId) => api.get('/sap/inventory', { params: { locationId } }),
  createStockTransfer: (data) => api.post('/sap/stock-transfer', data),
};

// Goods Receipt API (App → SAP)
export const goodsReceiptApi = {
  getProducts: (search) => api.get('/goods-receipt/products', { params: { search } }),
  getWarehouses: () => api.get('/goods-receipt/warehouses'),
  create: (data) => api.post('/goods-receipt', data),
  // History and management
  getHistory: (params) => api.get('/goods-receipt/history', { params }),
  getOne: (id) => api.get(`/goods-receipt/${id}`),
  retrySap: (id) => api.post(`/goods-receipt/${id}/retry-sap`),
  // Packing list extraction
  extract: (files) => {
    const formData = new FormData();
    files.forEach((file) => {
      formData.append('files', file);
    });
    return api.post('/goods-receipt/extract', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
  },
};

// Consumption API (Centro consumptions → SAP DeliveryNotes)
export const consumptionApi = {
  // Get available inventory at a Centro
  getInventory: (centroId) => api.get(`/consumption/inventory/${centroId}`),
  // Create consumption record
  create: (data) => api.post('/consumption', data),
  // Get consumption history
  getHistory: (params) => api.get('/consumption/history', { params }),
  // Get single consumption
  getOne: (id) => api.get(`/consumption/${id}`),
  // Retry failed SAP sync
  retrySap: (id) => api.post(`/consumption/${id}/retry-sap`),
  // Extract from uploaded documents
  extract: (files, centroId) => {
    const formData = new FormData();
    files.forEach((file) => {
      formData.append('files', file);
    });
    if (centroId) {
      formData.append('centroId', centroId);
    }
    return api.post('/consumption/extract', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
  },
};

export default api;
