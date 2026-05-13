import crypto from "crypto";

export default function diagnostics(req, res, next) {
    const enabled = process.env.ENABLE_DIAGNOSTICS === "true";
    const isAdmin = req.user?.role === "admin";

    const headerKey = req.headers["x-debug-key"];
    const queryKey = req.query.debugKey;

    const hasKey =
    (headerKey && headerKey === process.env.DEBUG_KEY) ||
    (queryKey && queryKey === process.env.DEBUG_KEY);

    const debug = enabled && isAdmin && hasKey;
    res.locals.debug = debug;
    res.set("X-Debug-Enabled", String(debug));
    next();
}
