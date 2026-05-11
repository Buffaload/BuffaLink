const ENV_API = process.env.REACT_APP_API_BASE_URL;

// Explicit, safe defaults
const DEV_API = "http://localhost:5055/api";
const PROD_API = "https://buffa-link-backend.vercel.app/api";

// CRA / Vercel builds inject NODE_ENV at build time
const isProd = process.env.NODE_ENV === "production";

// Priority order:
// 1. Explicit env var
// 2. Production-safe default
// 3. Localhost ONLY in non-prod
const API_BASE_URL =
  (ENV_API && ENV_API.trim()) ||
  (isProd ? PROD_API : DEV_API);

export default API_BASE_URL;
