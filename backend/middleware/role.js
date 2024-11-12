const checkRole = (role) => {
  return (req, res, next) => {
    if (!req.user || req.user.role !== role) {
      res
        .status(403)
        .json({ msg: "Access denied. User is not authenticated." });
      return;
    }
    next();
  };
};

export default checkRole;
