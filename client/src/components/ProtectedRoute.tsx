import React, { ReactNode, useEffect, useState } from "react";
import { useNavigate, Navigate } from "react-router-dom";

interface ProtectedRouteProps {
  children: ReactNode;
  token: string | null;
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children }) => {
  const [isTokenValid, setIsTokenValid] = useState<boolean>(true);
  const navigate = useNavigate();
  const token = localStorage.getItem("token");

  useEffect(() => {
    const checkTokenValidity = () => {
      const storedToken = localStorage.getItem("token");
      const tokenExpiry = localStorage.getItem("tokenExpiry");
      const isKiosk = localStorage.getItem("isKioskSession") === "1";

      const currentTime = Date.now();
      if (!storedToken || (!isKiosk && (!tokenExpiry || Number(tokenExpiry) < currentTime))) {
        console.log("[ProtectedRoute] token invalid - redirecting");

        localStorage.clear();
        setIsTokenValid(false);
        navigate("/login");
      }
    };

    checkTokenValidity();

    const intervalId = setInterval(checkTokenValidity, 1000);

    return () => clearInterval(intervalId); // Clean up on mount
  }, [navigate]);

  // Show children only if the token is valid
  if (!isTokenValid || !token) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
};

export default ProtectedRoute;

