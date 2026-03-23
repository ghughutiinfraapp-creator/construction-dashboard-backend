import AsyncStorage from '@react-native-async-storage/async-storage';

const API_BASE = __DEV__ ? 'http://10.0.2.2:5000/api' : 'https://your-production-api.com/api';

class ApiService {
  async getToken() {
    return await AsyncStorage.getItem('accessToken');
  }

  async request(method, endpoint, data = null, isFormData = false) {
    const token = await this.getToken();
    const headers = { ...(token && { Authorization: `Bearer ${token}` }) };
    if (!isFormData) headers['Content-Type'] = 'application/json';

    const config = { method, headers };
    if (data && !isFormData) config.body = JSON.stringify(data);
    if (data && isFormData) config.body = data;

    const response = await fetch(`${API_BASE}${endpoint}`, config);

    if (response.status === 401) {
      const body = await response.json();
      if (body.code === 'TOKEN_EXPIRED') {
        const refreshed = await this.refreshToken();
        if (refreshed) return this.request(method, endpoint, data, isFormData);
      }
      await AsyncStorage.clear();
      throw new Error('UNAUTHORIZED');
    }

    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Request failed');
    return result;
  }

  async refreshToken() {
    try {
      const refreshToken = await AsyncStorage.getItem('refreshToken');
      if (!refreshToken) return false;
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken })
      });
      if (!res.ok) return false;
      const data = await res.json();
      await AsyncStorage.setItem('accessToken', data.accessToken);
      return true;
    } catch { return false; }
  }

  get(endpoint) { return this.request('GET', endpoint); }
  post(endpoint, data) { return this.request('POST', endpoint, data); }
  put(endpoint, data) { return this.request('PUT', endpoint, data); }
  delete(endpoint) { return this.request('DELETE', endpoint); }

  async uploadPhoto(file, type = 'photos') {
    const formData = new FormData();
    formData.append('file', { uri: file.uri, type: file.type || 'image/jpeg', name: file.fileName || 'photo.jpg' });
    return this.request('POST', `/uploads/photo?type=${type}`, formData, true);
  }
}

const api = new ApiService();

// ─── AUTH ────────────────────────────────────────────────────────────
export const authAPI = {
  login: (email, password) => api.post('/auth/login', { email, password }),
  me: () => api.get('/auth/me'),
  logout: () => api.post('/auth/logout'),
  updateFCM: (fcmToken) => api.put('/auth/update-fcm', { fcmToken }),
};

// ─── ATTENDANCE ─────────────────────────────────────────────────────
export const attendanceAPI = {
  punchIn: (data) => api.post('/attendance/punch-in', data),
  punchOut: (data) => api.post('/attendance/punch-out', data),
  getStatus: () => api.get('/attendance/status'),
  getToday: (projectId) => api.get(`/attendance/today?projectId=${projectId}`),
  getHistory: (params) => api.get(`/attendance/history?${new URLSearchParams(params)}`),
};

// ─── TASKS ──────────────────────────────────────────────────────────
export const tasksAPI = {
  getAll: (params) => api.get(`/tasks?${new URLSearchParams(params)}`),
  updateStatus: (id, status) => api.put(`/tasks/${id}/status`, { status }),
};

// ─── LABOUR ─────────────────────────────────────────────────────────
export const labourAPI = {
  getLabourers: (projectId) => api.get(`/labour/labourers?projectId=${projectId}`),
  createLabourer: (data) => api.post('/labour/labourers', data),
  markAttendance: (data) => api.post('/labour/attendance/mark', data),
  getAttendance: (params) => api.get(`/labour/attendance?${new URLSearchParams(params)}`),
};

// ─── PURCHASE ORDERS ────────────────────────────────────────────────
export const purchaseOrdersAPI = {
  getAll: (params) => api.get(`/purchase-orders?${new URLSearchParams(params)}`),
  getById: (id) => api.get(`/purchase-orders/${id}`),
  create: (data) => api.post('/purchase-orders', data),
};

// ─── DELIVERIES ─────────────────────────────────────────────────────
export const deliveriesAPI = {
  getAll: (params) => api.get(`/deliveries?${new URLSearchParams(params)}`),
  getById: (id) => api.get(`/deliveries/${id}`),
  markPickedUp: (id) => api.put(`/deliveries/${id}/picked-up`),
  markDelivered: (id, photoUrl) => api.put(`/deliveries/${id}/delivered`, { deliveryPhotoUrl: photoUrl }),
  verify: (id, data) => api.put(`/deliveries/${id}/verify`, data),
};

// ─── PROJECTS ───────────────────────────────────────────────────────
export const projectsAPI = {
  getAll: () => api.get('/projects'),
  getById: (id) => api.get(`/projects/${id}`),
};

// ─── NOTIFICATIONS ──────────────────────────────────────────────────
export const notificationsAPI = {
  getAll: (params) => api.get(`/notifications?${new URLSearchParams(params)}`),
  markRead: (id) => api.put(`/notifications/${id}/read`),
  markAllRead: () => api.put('/notifications/read-all'),
};

// ─── MATERIALS ──────────────────────────────────────────────────────
export const materialsAPI = {
  getCatalog: (params) => api.get('/materials/catalog', { params }),
  getCategories: () => api.get('/materials/catalog/categories'),
};

export { api as default };
