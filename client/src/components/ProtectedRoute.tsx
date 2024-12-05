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

      const currentTime = Date.now();
      if (!token || !tokenExpiry || Number(tokenExpiry) < currentTime) {
        // Clear invalid token
        localStorage.removeItem("token");
        localStorage.removeItem("tokenExpiry");
        localStorage.removeItem("role");
        localStorage.removeItem("username");

        setIsTokenValid(false); // Mark token as invalid
        navigate("/login"); // Redirect ot login
      }
    };

    checkTokenValidity();

    const intervalId = setInterval(() => {
      checkTokenValidity();
    }, 1000);

    return () => clearInterval(intervalId); // Clean up on mount
  }, [navigate]);

  // Show children only if the token is valid
  return isTokenValid ? <>{children}</> : null;
};

export default ProtectedRoute;
