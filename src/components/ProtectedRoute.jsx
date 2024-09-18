import React from "react";
import { Navigate } from "react-router-dom";

const ProtectedRoute = ({ children, token }) => {
  return token ? children : <Navigate to="/login" />;
};

export default ProtectedRoute;
