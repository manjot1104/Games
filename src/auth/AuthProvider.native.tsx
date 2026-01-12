import Constants from "expo-constants";
import * as Linking from "expo-linking";
import * as SecureStore from "expo-secure-store";
import React, { createContext, useContext, useEffect, useState } from "react";
import Auth0 from "react-native-auth0";

// Base64 URL decode helper (works in both web and React Native)
function base64UrlDecode(str: string): string {
  // Add padding if needed
  let padded = str + '='.repeat((4 - (str.length % 4)) % 4);
  // Replace URL-safe characters
  padded = padded.replace(/-/g, '+').replace(/_/g, '/');
  
  // Use atob if available (web)
  if (typeof atob !== 'undefined') {
    return atob(padded);
  }
  
  // React Native: Try using global Buffer if available (Node.js environment)
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(padded, 'base64').toString('utf-8');
  }
  
  // If neither is available, throw error to trigger API fallback
  throw new Error('Base64 decoding not available');
}

type Session = { accessToken?: string; idToken?: string; profile?: any };

const extra = (Constants as any).expoConfig?.extra ?? {};
// Strip protocol if present (react-native-auth0 requires hostname only)
const stripProtocol = (url: string) => {
  if (!url) return url;
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
};
const domainRaw =
  (process.env.EXPO_PUBLIC_AUTH0_DOMAIN as string) || (extra.AUTH0_DOMAIN as string);
const domain = stripProtocol(domainRaw);
const clientId =
  (process.env.EXPO_PUBLIC_AUTH0_CLIENT_ID_NATIVE as string) || (extra.AUTH0_CLIENT_ID_NATIVE as string);
const audience =
  (process.env.EXPO_PUBLIC_AUTH0_AUDIENCE as string) || (extra.AUTH0_AUDIENCE as string) || undefined;

if (!domain || !clientId) {
  console.error("Auth0 native config missing. domain:", domain, "clientId:", clientId);
  throw new Error("Auth0 native: missing domain or clientId (check EXPO_PUBLIC_* or expo.extra)");
}

console.log("Auth0 Native - Domain:", domain, "ClientId:", clientId?.substring(0, 10) + "...");

const auth0 = new Auth0({ domain, clientId });

const Ctx = createContext<{
  session: Session | null;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  signup: (emailHint?: string) => Promise<void>;
}>({
  session: null,
  login: async () => {},
  logout: async () => {},
  signup: async () => {},
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    (async () => {
      const raw = await SecureStore.getItemAsync("cw.session");
      if (raw) setSession(JSON.parse(raw));
    })();
  }, []);

  const login = async () => {
    const redirectUri = Linking.createURL("/callback"); // childwellness://.../callback
    console.log("=== AUTH0 LOGIN DEBUG ===");
    console.log("Redirect URI:", redirectUri);
    console.log("Domain:", domain);
    console.log("ClientId:", clientId?.substring(0, 15) + "...");
    console.log("=========================");
    const res = await auth0.webAuth.authorize({
      scope: "openid profile email offline_access",
      ...(audience ? { audience } : {}),
      redirectUri,
    });
    
    // Decode profile from ID token instead of making an extra API call
    // This is much faster - no network request needed
    let profile: any = null;
    if (res.idToken) {
      try {
        // Decode JWT token (base64url decode the payload)
        const parts = res.idToken.split('.');
        if (parts.length === 3) {
          const payload = parts[1];
          const decodedStr = base64UrlDecode(payload);
          profile = JSON.parse(decodedStr);
        }
      } catch (e) {
        console.warn('Failed to decode ID token, falling back to userInfo API:', e);
        // Fallback to API call only if decoding fails
        profile = await auth0.auth.userInfo({ token: res.accessToken! });
      }
    } else {
      // No ID token, fallback to API call
      profile = await auth0.auth.userInfo({ token: res.accessToken! });
    }
    
    const next = { accessToken: res.accessToken, idToken: res.idToken, profile };
    setSession(next);
    await SecureStore.setItemAsync("cw.session", JSON.stringify(next));
  };

  const logout = async () => {
    try {
      await auth0.webAuth.clearSession({ redirectUri: Linking.createURL("/logout") });
    } catch {
      // best-effort: still clear local state
    }
    setSession(null);
    await SecureStore.deleteItemAsync("cw.session");
  };

  const signup = async (emailHint?: string) => {
    const redirectUri = Linking.createURL("/callback");
    console.log("Auth0 Signup - Redirect URI:", redirectUri);
    const res = await auth0.webAuth.authorize({
      scope: "openid profile email offline_access",
      ...(audience ? { audience } : {}),
      redirectUri,
      screen_hint: "signup",
      login_hint: emailHint || "",
    });
    
    // Decode profile from ID token instead of making an extra API call
    let profile: any = null;
    if (res.idToken) {
      try {
        const parts = res.idToken.split('.');
        if (parts.length === 3) {
          const payload = parts[1];
          const decodedStr = base64UrlDecode(payload);
          profile = JSON.parse(decodedStr);
        }
      } catch (e) {
        console.warn('Failed to decode ID token, falling back to userInfo API:', e);
        profile = await auth0.auth.userInfo({ token: res.accessToken! });
      }
    } else {
      profile = await auth0.auth.userInfo({ token: res.accessToken! });
    }
    
    const next = { accessToken: res.accessToken, idToken: res.idToken, profile };
    setSession(next);
    await SecureStore.setItemAsync("cw.session", JSON.stringify(next));
  };

  return <Ctx.Provider value={{ session, login, logout, signup }}>{children}</Ctx.Provider>;
};

export const useAuth = () => useContext(Ctx);
