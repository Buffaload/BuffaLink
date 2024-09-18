import React from "react";
import { Navigate } from "react-router-dom";

const ProtectedRoute = ({ component: Component, token, ...rest }) => {
  return token ? <Component {...rest} /> : <Navigate to="/login" />;
};

export default ProtectedRoute;
