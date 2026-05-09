import * as React from "react";
import { useNavigate } from "react-router-dom";
import { ProfilePage as ProfileComponent } from "../components/ProfilePage";
import { useAuth } from "../hooks/useAuth";

export function ProfilePage() {
  const navigate = useNavigate();
  const { user, status, error, logout, updateSettings } = useAuth();

  return (
    <ProfileComponent
      user={user}
      authStatus={status}
      authError={error}
      onBack={() => navigate("/")}
      onOpenLogin={() => navigate("/auth")}
      onLogout={logout}
      onUpdateSettings={updateSettings}
    />
  );
}
