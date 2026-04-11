import { useEffect } from "react";
import { HashRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import AuthPage from "@/pages/Auth";
import DashboardPage from "@/pages/Dashboard";
import DeviceDetailPage from "@/pages/DeviceDetail";
import { useAuthStore } from "@/stores/authStore";

export default function App() {
  const session = useAuthStore((s) => s.session);

  useEffect(() => {
    const onBeforeUnload = () => {
      const { session, signOut } = useAuthStore.getState();
      if (session) void signOut();
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, []);

  return (
    <Router>
      <Routes>
        <Route path="/auth" element={session ? <Navigate to="/" replace /> : <AuthPage />} />
        <Route path="/" element={session ? <DashboardPage /> : <Navigate to="/auth" replace />} />
        <Route
          path="/devices/:deviceId"
          element={session ? <DeviceDetailPage /> : <Navigate to="/auth" replace />}
        />
        <Route path="*" element={<Navigate to={session ? "/" : "/auth"} replace />} />
      </Routes>
    </Router>
  );
}
