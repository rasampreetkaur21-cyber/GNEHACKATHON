import { createContext, useContext, useEffect, useState } from "react";
import { api } from "../services/api";
const Auth = createContext();
export const useAuth = () => useContext(Auth);
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    api("/auth/me")
      .then((d) => setUser(d.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);
  async function logout() {
    await api("/auth/logout", { method: "POST" });
    setUser(null);
  }
  return (
    <Auth.Provider value={{ user, setUser, loading, logout }}>
      {children}
    </Auth.Provider>
  );
}
