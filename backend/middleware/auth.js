import jwt from "jsonwebtoken";

const auth = (req, res, next) => {
  const authHeader = req.header("Authorization");
  console.log("[auth] Authorization header:", authHeader);

  if (!authHeader) {
    console.log("[auth] Missing Authorization header");
    res.status(401).json({ msg: "No token, authorization denied" });
    return;
  }

  const token = authHeader.split(" ")[1];
  console.log("[auth] Bearer token present:", Boolean(token));
  console.log("[auth] Token preview:", token ? `${token.slice(0, 20)}...` : null)

  if (!token) {
    console.log("[auth] Token missing after Bearer split");
    res.status(401).json({ msg: "Token missing, authorization denied" });
    return;
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log("Decoded token:", decoded);
    req.user = decoded.user;
    next();
  } catch (err) {
    console.log("[auth] Token verify failed:", err.message);
    res.status(401).json({ msg: "Token is not valid" });
  }
};

export default auth;
