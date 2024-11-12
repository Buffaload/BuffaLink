import React, { ReactNode } from "react";
import { Navigate } from "react-router-dom";

interface ProtectedRouteProps {
  children: ReactNode;
  token: string | null;
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children, token }) => {
  return token ? <>{children}</> : <Navigate to="/login" />;
};

export default ProtectedRoute;
