export default function diagnostics(req, res, next) {
  const enabled = process.env.ENABLE_DIAGNOSTICS === "true";
  const isAdmin = req.user?.role === "admin";
  const hasKey = req.headers["x-debug-key"] && req.headers["x-debug-key"] === process.env.DEBUG_KEY;

  const debug = enabled && isAdmin && hasKey;

  res.locals.debug = debug;
  res.set("X-BuffaLink-Build", process.env.VERCEL_GIT_COMMIT_SHA || "unknown");
  res.set("X-BuffaLink-Ref", process.env.VERCEL_GIT_COMMIT_REF || "unknown");
  res.set("X-Request-Id", req.headers["x-request-id"] || crypto.randomUUID());

  next();
}
