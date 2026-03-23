import axios from 'axios';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api';

const api = axios.create({
  baseURL: API_BASE,
  headers: { 'Content-Type': 'application/json' }
});

// Attach token to every request
api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('accessToken');
    if (token) config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Handle 401 → refresh token
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;
    if (error.response?.status === 401 && error.response?.data?.code === 'TOKEN_EXPIRED' && !original._retry) {
      original._retry = true;
      try {
        const refreshToken = localStorage.getItem('refreshToken');
        const { data } = await axios.post(`${API_BASE}/auth/refresh`, { refreshToken });
        localStorage.setItem('accessToken', data.accessToken);
        original.headers.Authorization = `Bearer ${data.accessToken}`;
        return api(original);
      } catch {
        localStorage.clear();
        if (typeof window !== 'undefined') window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

// ─── AUTH ────────────────────────────────────────────────────────────
export const authAPI = {
  login: (email, password) => api.post('/auth/login', { email, password }),
  register: (data) => api.post('/auth/register', data),
  me: () => api.get('/auth/me'),
  logout: () => api.post('/auth/logout'),
};

// ─── DASHBOARD ──────────────────────────────────────────────────────
export const dashboardAPI = {
  getStats: () => api.get('/dashboard/stats'),
  getAttendanceChart: (days = 7) => api.get(`/dashboard/attendance-chart?days=${days}`),
  getPOPipeline: () => api.get('/dashboard/po-pipeline'),
  getRecentActivity: () => api.get('/dashboard/recent-activity'),
  getProjectSummary: (id) => api.get(`/dashboard/project-summary/${id}`),
};

// ─── PROJECTS ───────────────────────────────────────────────────────
export const projectsAPI = {
  getAll: (params) => api.get('/projects', { params }),
  getById: (id) => api.get(`/projects/${id}`),
  create: (data) => api.post('/projects', data),
  update: (id, data) => api.put(`/projects/${id}`, data),
  updateGeofence: (id, data) => api.put(`/projects/${id}/geofence`, data),
};

// ─── USERS ──────────────────────────────────────────────────────────
export const usersAPI = {
  getAll: (params) => api.get('/users', { params }),
  getById: (id) => api.get(`/users/${id}`),
  update: (id, data) => api.put(`/users/${id}`, data),
  getByRole: (role) => api.get(`/users/by-role/${role}`),
  resetPassword: (id, password) => api.put(`/users/${id}/reset-password`, { password }),
};

// ─── ATTENDANCE ─────────────────────────────────────────────────────
export const attendanceAPI = {
  getToday: (projectId) => api.get('/attendance/today', { params: { projectId } }),
  getHistory: (params) => api.get('/attendance/history', { params }),
};

// ─── TASKS ──────────────────────────────────────────────────────────
export const tasksAPI = {
  getAll: (params) => api.get('/tasks', { params }),
  create: (data) => api.post('/tasks', data),
  updateStatus: (id, status) => api.put(`/tasks/${id}/status`, { status }),
  update: (id, data) => api.put(`/tasks/${id}`, data),
  delete: (id) => api.delete(`/tasks/${id}`),
};

// ─── LABOUR ─────────────────────────────────────────────────────────
export const labourAPI = {
  getLabourers: (params) => api.get('/labour/labourers', { params }),
  createLabourer: (data) => api.post('/labour/labourers', data),
  getAttendance: (params) => api.get('/labour/attendance', { params }),
  markAttendance: (data) => api.post('/labour/attendance/mark', data),
  getWageReport: (params) => api.get('/labour/wage-report', { params }),
};

// ─── PURCHASE ORDERS ────────────────────────────────────────────────
export const purchaseOrdersAPI = {
  getAll: (params) => api.get('/purchase-orders', { params }),
  getById: (id) => api.get(`/purchase-orders/${id}`),
  create: (data) => api.post('/purchase-orders', data),
  approve: (id) => api.put(`/purchase-orders/${id}/approve`),
  reject: (id, reason) => api.put(`/purchase-orders/${id}/reject`, { rejectionReason: reason }),
  assignVendor: (id, data) => api.put(`/purchase-orders/${id}/assign-vendor`, data),
  assignDelivery: (id, deliveryPersonId) => api.put(`/purchase-orders/${id}/assign-delivery`, { deliveryPersonId }),
};

// ─── DELIVERIES ─────────────────────────────────────────────────────
export const deliveriesAPI = {
  getAll: (params) => api.get('/deliveries', { params }),
  getById: (id) => api.get(`/deliveries/${id}`),
  markDelivered: (id, deliveryPhotoUrl) => api.put(`/deliveries/${id}/delivered`, { deliveryPhotoUrl }),
  verify: (id, data) => api.put(`/deliveries/${id}/verify`, data),
};

// ─── VENDORS ────────────────────────────────────────────────────────
export const vendorsAPI = {
  getAll: (params) => api.get('/vendors', { params }),
  getById: (id) => api.get(`/vendors/${id}`),
  create: (data) => api.post('/vendors', data),
  update: (id, data) => api.put(`/vendors/${id}`, data),
};

// ─── NOTIFICATIONS ──────────────────────────────────────────────────
export const notificationsAPI = {
  getAll: (params) => api.get('/notifications', { params }),
  markRead: (id) => api.put(`/notifications/${id}/read`),
  markAllRead: () => api.put('/notifications/read-all'),
};

// ─── UPLOADS ────────────────────────────────────────────────────────
export const uploadsAPI = {
  uploadPhoto: (file, type = 'photos') => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post(`/uploads/photo?type=${type}`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
  },
};

export default api;

// ─── MATERIALS ──────────────────────────────────────────────────────
export const materialsAPI = {
  getCatalog: (params) => api.get('/materials/catalog', { params }),
  getCategories: () => api.get('/materials/catalog/categories'),
  getById: (id) => api.get(`/materials/catalog/${id}`),
  create: (data) => api.post('/materials/catalog', data),
  update: (id, data) => api.put(`/materials/catalog/${id}`, data),
  delete: (id) => api.delete(`/materials/catalog/${id}`),
};
