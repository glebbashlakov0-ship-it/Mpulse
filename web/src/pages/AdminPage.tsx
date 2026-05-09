import * as React from "react";
import { useNavigate } from "react-router-dom";
import { AdminPage as AdminComponent } from "../components/AdminPage";
import { useAuth } from "../hooks/useAuth";

export function AdminPage() {
  const navigate = useNavigate();
  const { user, status } = useAuth();

  return (
    <AdminComponent
      user={user}
      authStatus={status}
      onOpenLogin={() => navigate("/auth")}
    />
  );
}
