"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, apiRequest, resolveTenantById } from "@/lib/api";
import type { Tenant, User } from "@/lib/types";

type LoginResponse = {
  accessToken: string;
  user: User;
};

type AuthContextValue = {
  loading: boolean;
  accessToken: string | null;
  user: User | null;
  login: (email: string, password: string) => Promise<LoginResponse>;
  logout: () => Promise<void>;
  setUserSession: (nextUser: User | null) => void;
  refreshAccessToken: () => Promise<string | null>;
  authedRequest: <T>(
    path: string,
    options?: { method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; body?: unknown; formData?: FormData },
  ) => Promise<T>;
  resolveCurrentTenant: () => Promise<Tenant | null>;
};

const STORAGE_TOKEN = "ecommerce_access_token";
const STORAGE_USER = "ecommerce_user";

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const accessTokenRef = useRef<string | null>(null);
  const userRef = useRef<User | null>(null);

  useEffect(() => {
    const storedToken = window.localStorage.getItem(STORAGE_TOKEN);
    const storedUser = window.localStorage.getItem(STORAGE_USER);
    const parsedUser = storedUser ? (JSON.parse(storedUser) as User) : null;

    accessTokenRef.current = storedToken;
    userRef.current = parsedUser;
    setAccessToken(storedToken);
    setUser(parsedUser);
    setLoading(false);
  }, []);

  const persistSession = useCallback((nextToken: string | null, nextUser: User | null) => {
    accessTokenRef.current = nextToken;
    userRef.current = nextUser;
    setAccessToken(nextToken);
    setUser(nextUser);

    if (nextToken) {
      window.localStorage.setItem(STORAGE_TOKEN, nextToken);
    } else {
      window.localStorage.removeItem(STORAGE_TOKEN);
    }

    if (nextUser) {
      window.localStorage.setItem(STORAGE_USER, JSON.stringify(nextUser));
    } else {
      window.localStorage.removeItem(STORAGE_USER);
    }
  }, []);

  const refreshAccessToken = useCallback(async () => {
    try {
      const response = await apiRequest<{ accessToken: string }>("/auth/refresh", {
        method: "POST",
        body: {},
      });

      const nextToken = response.accessToken;
      persistSession(nextToken, userRef.current);
      return nextToken;
    } catch {
      persistSession(null, null);
      return null;
    }
  }, [persistSession]);

  const login = useCallback(
    async (email: string, password: string) => {
      const response = await apiRequest<LoginResponse>("/auth/login", {
        method: "POST",
        body: { email, password },
      });

      persistSession(response.accessToken, response.user);
      return response;
    },
    [persistSession],
  );

  const logout = useCallback(async () => {
    try {
      if (accessTokenRef.current) {
        await apiRequest<{ success: true }>("/auth/logout", {
          method: "POST",
          token: accessTokenRef.current,
        });
      }
    } catch {
      // Ignore network/session errors during logout.
    } finally {
      persistSession(null, null);
    }
  }, [persistSession]);

  const setUserSession = useCallback(
    (nextUser: User | null) => {
      persistSession(accessTokenRef.current, nextUser);
    },
    [persistSession],
  );

  const authedRequest = useCallback<AuthContextValue["authedRequest"]>(
    async (path, options) => {
      const currentToken = accessTokenRef.current;
      if (!currentToken) {
        throw new ApiError("Debes iniciar sesión para continuar", 401, null);
      }

      try {
        return await apiRequest(path, {
          method: options?.method,
          token: currentToken,
          body: options?.body,
          formData: options?.formData,
        });
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          const nextToken = await refreshAccessToken();
          if (!nextToken) {
            throw error;
          }

          return await apiRequest(path, {
            method: options?.method,
            token: nextToken,
            body: options?.body,
            formData: options?.formData,
          });
        }

        throw error;
      }
    },
    [refreshAccessToken],
  );

  const resolveCurrentTenant = useCallback(async () => {
    if (!userRef.current?.tenantId) {
      return null;
    }
    return resolveTenantById(userRef.current.tenantId);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      loading,
      accessToken,
      user,
      login,
      logout,
      setUserSession,
      refreshAccessToken,
      authedRequest,
      resolveCurrentTenant,
    }),
    [loading, accessToken, user, login, logout, setUserSession, refreshAccessToken, authedRequest, resolveCurrentTenant],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return context;
}
