import axios from "axios";
import API_BASE_URL from "../config";

const api = axios.create({
  baseURL: API_BASE_URL,
});

// Dedicated client for refresh requests only
const refreshClient = axios.create({
  baseURL: API_BASE_URL,
});

// Attach token to every request
api.interceptors.request.use((config) => {
    const token = localStorage.getItem("token");

    config.headers = config.headers ?? {};

    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    } else {
        delete config.headers.Authorization;
    }

    return config;
});

let isRefreshing = false;
let subscribers: Array<(token: string) => void> = [];

const notifySubscribers = (token: string) => {
    subscribers.forEach((cb) => cb(token));
    subscribers = [];
};

const clearAuthStorage = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("role");
    localStorage.removeItem("depot");
    localStorage.removeItem("isKioskSession");
    localStorage.removeItem("kioskLocation");
    localStorage.removeItem("kioskDeviceName");
    delete api.defaults.headers.common.Authorization;
};

api.interceptors.response.use(
    (res) => res,
    async (err) => {
        const originalRequest = err.config;

        // Never retry kiosk-check itself or refresh itself
        const requestUrl = String(originalRequest?.url ?? "");
        const isRefreshCall = requestUrl.includes("/auth/refresh");
        const isKioskCheckCall = requestUrl.includes("/auth/kiosk-check");

        if (
            err.response?.status === 401 &&
            !originalRequest?._retry &&
            !isRefreshCall &&
            !isKioskCheckCall
        ) {
        if (isRefreshing) {
            return new Promise((resolve) => {
                subscribers.push((token) => {
                    originalRequest.headers = originalRequest.headers ?? {};
                    originalRequest.headers.Authorization = `Bearer ${token}`;
                    resolve(api(originalRequest));
                });
            });
        }

        originalRequest._retry = true;
        isRefreshing = true;

        try {
            const currentToken = localStorage.getItem("token");

            if (!currentToken) {
                throw new Error("No token available for refresh");
            }

            // IMPORTANT: use refreshClient + API_BASE_URL + /auth/refresh
            const res = await refreshClient.post(
                "/auth/refresh",
                {},
                {
                    headers: {
                        Authorization: `Bearer ${currentToken}`,
                    },
                }
            );

            const newToken = res.data.token;
            localStorage.setItem("token", newToken);

            // keep axios default in sync for immediate follow-up requests
            api.defaults.headers.common.Authorization = `Bearer ${newToken}`;

            notifySubscribers(newToken);
            isRefreshing = false;

            originalRequest.headers = originalRequest.headers ?? {};
            originalRequest.headers.Authorization = `Bearer ${newToken}`;

            return api(originalRequest);
        } catch (error) {
            isRefreshing = false;
            clearAuthStorage();
            window.location.href = "/login";
            return Promise.reject(error);
        }
    }

    return Promise.reject(err);
    }
);

export default api;