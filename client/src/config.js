const API_BASE_URL =
  window.location.hostname === "localhost"
    ? "http://localhost:5050/api" // Local backend
    : "https://buffa-link-backend.vercel.app/api"; // Production backend

export default API_BASE_URL;
