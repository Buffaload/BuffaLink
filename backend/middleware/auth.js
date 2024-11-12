import jwt from "jsonwebtoken";

const auth = (req, res, next) => {
  const authHeader = req.header("Authorization");

  if (!authHeader) {
    res.status(401).json({ msg: "No token, authorization denied" });
    return;
  }

  const token = authHeader.split(" ")[1];

  if (!token) {
    res.status(401).json({ msg: "Token missing, authorization denied" });
    return;
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded.user;
    next();
  } catch (err) {
    res.status(401).json({ msg: "Token is not valid" });
  }
};

export default auth;
