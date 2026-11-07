import axios from 'axios';

// Backend address: set VITE_API_BASE_URL in Vercel (no trailing slash).
export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000').replace(/\/+$/, '');

const axiosClient = axios.create({
  baseURL: API_BASE_URL,
});

export default axiosClient;
