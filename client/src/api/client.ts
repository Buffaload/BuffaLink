import axios from "axios";
import API_BASE_URL from "../config";

const api = axios.create({
    baseURL: API_BASE_URL,
});

// Attach token to every request
api.interceptors.request.use((config) => {
    const token = localStorage.getItem("token");
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

// Refresh logic
let isRefreshing = false;
let subscribers: ((token: string) => void)[] = [];

const notifySubscribers = (token: string) => {
    subscribers.forEach((cb) => cb(token));
    subscribers = [];
};

api.interceptors.response.use(
    (res) => res,
    async (err) => {
        const originalRequest = err.config;

        if (err.response?.status === 401 && !originalRequest._retry) {
            if (isRefreshing) {
                return new Promise((resolve) => {
                subscribers.push((token) => {
                    originalRequest.headers.Authorization = `Bearer ${token}`;
                    resolve(api(originalRequest));
                });
                });
            }

            originalRequest._retry = true;
            isRefreshing = true;

            try {
                const res = await axios.post(
                "/api/auth/refresh",
                {},
                {
                    headers: {
                    Authorization: `Bearer ${localStorage.getItem("token")}`,
                    },
                }
                );

                const newToken = res.data.token;
                localStorage.setItem("token", newToken);

                notifySubscribers(newToken);
                isRefreshing = false;

                originalRequest.headers.Authorization = `Bearer ${newToken}`;
                return api(originalRequest);
            } catch (error) {
                isRefreshing = false;

                localStorage.removeItem("token");
                window.location.href = "/login";

                return Promise.reject(error);
            }
        }

        return Promise.reject(err);
    }
);

export default api;