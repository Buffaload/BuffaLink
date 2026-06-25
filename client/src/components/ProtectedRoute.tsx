import React, { ReactNode, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

interface ProtectedRouteProps {
  children: ReactNode;
  token: string | null;
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children }) => {
  const [isTokenValid, setIsTokenValid] = useState<boolean>(true);
  const navigate = useNavigate();

  useEffect(() => {
    const checkTokenValidity = () => {
      const token = localStorage.getItem("token");
      const tokenExpiry = localStorage.getItem("tokenExpiry");
      const isKiosk = localStorage.getItem("isKioskSession") === "1";

      const currentTime = Date.now();
      if (!token || (!isKiosk && (!tokenExpiry || Number(tokenExpiry) < currentTime))) {
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
  return isTokenValid ? <>{children}</> : null;
};

export default ProtectedRoute;

