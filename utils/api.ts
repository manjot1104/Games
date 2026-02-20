import { Platform } from 'react-native';

const FALLBACK_BASE = Platform.select({
  ios: 'http://192.168.1.3:4000',     // Physical iOS device
  android: 'http://192.168.1.3:4000', // Physical Android device
  default: 'http://localhost:4000', // Default to localhost for web
});

// Detect if we're running on localhost (for web)
const isLocalhost =
  Platform.OS === 'web' &&
  typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' ||
   window.location.hostname === '127.0.0.1');


// Normalize API_BASE_URL: remove trailing slash and /api if present
// (since all endpoints already include /api/)
// If running on localhost, force localhost URL regardless of env var
let rawBase: string;
if (isLocalhost) {
  rawBase = 'http://localhost:4000';
} else {
  rawBase =
    process.env.EXPO_PUBLIC_API_BASE_URL?.trim() ||
    'https://child-wellness.onrender.com'; // HARD SAFE PROD FALLBACK
}


// Remove trailing slash
rawBase = rawBase.replace(/\/+$/, '');
// Remove trailing /api if present (to avoid double /api/api/)
rawBase = rawBase.replace(/\/api$/, '');

export const API_BASE_URL = rawBase;

// Debug log to verify API URL
console.log('[API] API_BASE_URL =', API_BASE_URL);
console.log('[API] Platform.OS =', Platform.OS);
console.log('[API] isLocalhost =', isLocalhost);
console.log('[API] EXPO_PUBLIC_API_BASE_URL =', process.env.EXPO_PUBLIC_API_BASE_URL);
console.log('[API] FALLBACK_BASE =', FALLBACK_BASE);

// For physical devices, set EXPO_PUBLIC_API_BASE_URL to your laptop's IP address:
// EXPO_PUBLIC_API_BASE_URL=http://192.168.x.x:4000

let tokenProvider: null | (() => Promise<string | undefined>) = null;

export function setTokenProvider(provider: () => Promise<string | undefined>) {
  tokenProvider = provider;
}

// Test network connectivity
export async function testNetworkConnectivity() {
  try {
    console.log('🔍 Testing network connectivity to:', API_BASE_URL);
    const response = await fetch(`${API_BASE_URL}/api/test`, {
      method: 'GET',
    });
    console.log('✅ Network test response:', response.status);
    return true;
  } catch (error) {
    console.log('❌ Network test failed:', error);
    return false;
  }
}

// Helper to get Auth0 user info from session (will be set by AuthTokenProvider)
let auth0UserInfo: { auth0Id?: string; email?: string; name?: string } | null = null;

export function setAuth0UserInfo(info: { auth0Id?: string; email?: string; name?: string } | null) {
  auth0UserInfo = info;
}

export async function authHeaders(opts?: { multipart?: boolean }) {
  const token = tokenProvider ? await tokenProvider().catch(() => undefined) : undefined;
  const headers: Record<string, string> = {};

  if (token) headers['Authorization'] = `Bearer ${token}`;

  // Add Auth0 user info to headers for backend
  if (auth0UserInfo?.auth0Id) {
    headers['x-auth0-id'] = auth0UserInfo.auth0Id;
  } else if (isLocalhost) {
    // For localhost development, set fallback auth0Id if not available
    headers['x-auth0-id'] = 'dev_local_tester';
  }
  if (auth0UserInfo?.email) {
    headers['x-auth0-email'] = auth0UserInfo.email;
  }
  if (auth0UserInfo?.name) {
    headers['x-auth0-name'] = auth0UserInfo.name;
  }

  // ONLY set JSON for non-multipart calls
  if (!opts?.multipart) {
    headers['Content-Type'] = 'application/json';
    headers['Accept'] = 'application/json';
  }

  return headers;
}

export type Recommendation = {
  id: string;
  skillId: string | null;
  skillTitle?: string;
  icon?: string;
  route: string;
  gameMode: string;
  activityTitle: string;
  suggestedDifficulty?: string;
  reason: string;
  priority: 'high' | 'medium' | 'low';
  accuracy?: number;
  level?: number;
  lastPlayedDate?: string | null;
};

export type NextAction = {
  id: string;
  skillId: string | null;
  headline: string;
  body: string;
  actionLabel: string;
  urgency: 'low' | 'medium' | 'high';
  route: string;
};

export type StatsResponse = {
  xp: number;
  coins: number;
  hearts: number;
  streakDays: number;
  bestStreak: number;
  lastPlayedDate: string | null;
  accuracy: number;
  globalLevel?: number;
  levelLabel?: string;
  recommendations?: Recommendation[];
  nextActions?: NextAction[];
};

export async function fetchMyStats(): Promise<StatsResponse> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/me/stats`, {
      headers: await authHeaders(),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e: any) {
    throw new Error(`Failed to load stats from ${API_BASE_URL} (${e?.message || 'network error'})`);
  }
}

export async function recordGame(pointsEarned: number) {
  try {
    console.log(`Attempting to POST to: ${API_BASE_URL}/api/games/record`);
    const headers = await authHeaders();
    console.log('Auth headers:', headers);

    const res = await fetch(`${API_BASE_URL}/api/games/record`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ xp: pointsEarned, coins: 1 }),
    });

    console.log('Response status:', res.status);
    if (!res.ok) {
      const errorText = await res.text();
      console.log('Error response:', errorText);
      throw new Error(`HTTP ${res.status}: ${errorText}`);
    }
    return await res.json();
  } catch (e: any) {
    console.error('recordGame error:', e);
    throw new Error(`Failed to record game to ${API_BASE_URL} (${e?.message || 'network error'})`);
  }
}

export async function logGameAndAward(payload: {
  type: 'tap' | 'match' | 'sort' | 'emoji' | 'quiz' | 'follow-ball' | 'follow-my-point' | 'point-to-object-appears' | 'tap-the-pointed-object' | 'moving-arm-pointing' | 'multi-point-follow' | 'tap-what-you-like' | 'which-one-moved' | 'sound-to-choice' | 'show-me-the-toy' | 'food-vs-toy' | 'pass-the-ball' | 'tap-only-on-your-turn' | 'your-turn-to-complete' | 'wait-for-the-signal' | 'turn-timer' | 'watch-and-wait' | 'growing-flower' | 'timer-bar-tap' | 'follow-slow-movement' | 'shapes-appear-one-by-one' | 'touch-the-ball' | 'tap-the-circle' | 'find-the-sound-source' | 'tap-what-i-show-you' | 'follow-the-arrow' | 'tap-the-target-ignore-distraction' | 'sound-distraction-challenge' | 'slow-task-with-pop-up-distraction' | 'sequence-with-distraction' | 'moving-target-with-extra-objects' | 'jaw-awareness-crocodile' | 'jaw-swing-adventure' | 'jaw-push-challenge' | 'jaw-rhythm-tap' | 'jaw-strength-builder' | 'rainbow-curve-trace' | 'drive-car-curvy-road' | 'trace-smiling-mouth' | 'ball-roll-curved-track' | 'paint-curved-snake';
  correct: number;
  total: number;
  accuracy: number; // 0..100
  xpAwarded: number;
  durationMs?: number;
  mode?: 'free-play' | 'therapy' | 'guided';
  skillTags?: string[];
  difficulty?: string;
  responseTimeMs?: number;
  hintsUsed?: number;
  incorrectAttempts?: number;
  feedback?: { mood?: number; notes?: string; observer?: string };
  meta?: Record<string, any>; // include skill breakdowns etc.
}) {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE_URL}/api/me/game-log`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const errorText = await res.text().catch(() => 'Unknown error');
    throw new Error(`Game log failed (${res.status}): ${errorText}`);
  }
  return res.json();
}

export type InsightsResponse = {
  rangeDays: number;
  dailySeries: Array<{ date: string; xp: number; games: number; accuracy: number; durationMs: number }>;
  aggregate: { totalGames: number; totalXp: number; avgAccuracy: number; avgSessionMinutes: number };
  strengths: Array<{ id: string; title: string; icon?: string; level: number; accuracy: number; trend: number }>;
  focus: Array<{ id: string; title: string; icon?: string; level: number; accuracy: number; trend: number }>;
  skills: Array<{ id: string; title: string; icon?: string; level: number; accuracy: number; trend: number }>;
  modesBreakdown: Record<string, number>;
  feedback: { averageMood: number | null; recentNotes: Array<{ at: string; text: string; observer?: string | null }> };
};

export async function fetchInsights(range: '7d' | '30d' | '90d' = '30d'): Promise<InsightsResponse> {
  const res = await fetch(`${API_BASE_URL}/api/me/insights?range=${encodeURIComponent(range)}`, {
    headers: await authHeaders(),
  });
  if (!res.ok) {
    throw new Error(`Failed to load insights (${res.status})`);
  }
  return res.json();
}

export async function submitGameFeedback(payload: { at: string; mood?: number; notes?: string; observer?: string }) {
  if (!payload?.at) throw new Error('Missing timestamp');
  const res = await fetch(`${API_BASE_URL}/api/me/game-feedback`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`Failed to save feedback (${res.status})`);
  }
  return res.json();
}

export async function startTapRound() {
  const res = await fetch(`${API_BASE_URL}/api/tap/start`, {
    method: 'POST',
    headers: await authHeaders(),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} – ${text}`);
  return JSON.parse(text) as { roundId: string; targetSeconds: number };
}

export async function finishTapRound(roundId: string) {
  const res = await fetch(`${API_BASE_URL}/api/tap/finish`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ roundId }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} – ${text}`);
  return JSON.parse(text) as {
    pointsAwarded: number;
    deltaMs: number;
    targetSeconds: number;
    stats: { points: number; streakDays: number; totalGamesPlayed: number };
  };
}

export async function ensureUser(auth0Id: string, email: string, name?: string) {
  try {
    console.log(`Attempting to POST to: ${API_BASE_URL}/api/users/ensure`);
    const headers = await authHeaders();
    console.log('Auth headers:', headers);

    const res = await fetch(`${API_BASE_URL}/api/users/ensure`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        auth0Id,
        email,
        name: name || email || 'User',
      }),
    });

    console.log('Response status:', res.status);
    if (!res.ok) {
      const errorText = await res.text();
      console.log('Error response:', errorText);
      throw new Error(`HTTP ${res.status}: ${errorText}`);
    }
    return await res.json();
  } catch (e: any) {
    console.error('ensureUser error:', e);
    throw new Error(`Failed to ensure user at ${API_BASE_URL} (${e?.message || 'network error'})`);
  }
}

export type Profile = { firstName: string; lastName?: string; email: string; dob: string | null; gender: string | null; phoneCountryCode?: string; phoneNumber?: string };

export async function getMyProfile(): Promise<Profile> {
  const res = await fetch(`${API_BASE_URL}/api/me/profile`, {
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const p = await res.json();
  return {
    firstName: p.firstName || '',
    lastName: p.lastName || '',
    email: p.email || '',
    dob: p.dob ? new Date(p.dob).toISOString().slice(0, 10) : null,
    gender: p.gender || null,
    phoneCountryCode: p.phoneCountryCode || '+91',
    phoneNumber: p.phoneNumber || ''
  };
}

export async function updateMyProfile(data: { firstName: string; lastName?: string; dob?: string; gender?: string; phoneCountryCode?: string; phoneNumber?: string }) {
  try {
    console.log('updateMyProfile called with data:', data);
    console.log('API_BASE_URL:', API_BASE_URL);

    const headers = await authHeaders();
    console.log('Auth headers:', headers);

    const url = `${API_BASE_URL}/api/me/profile`;
    console.log('Making POST request to:', url);

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(data),
    });

    console.log('Response status:', res.status);
    console.log('Response ok:', res.ok);

    if (!res.ok) {
      const errorText = await res.text();
      console.error('Error response:', errorText);
      throw new Error(`HTTP ${res.status}: ${errorText}`);
    }

    const result = await res.json();
    console.log('Response data:', result);
    return result;
  } catch (e: any) {
    console.error('updateMyProfile error:', e);
    throw e;
  }
}

// ----- Therapy Progress APIs -----
export type TherapyProgress = {
  therapy: string;
  // Standard structure
  levels?: Array<{
    levelNumber: number;
    sessions: Array<{
      sessionNumber: number;
      completedGames: string[];
      completed: boolean;
      lastPlayedAt?: string;
    }>;
  }>;
  currentLevel?: number;
  currentSession?: number;
  // Special Education structure
  sections?: Array<{
    sectionNumber: number;
    levels: Array<{
      levelNumber: number;
      games: Array<{
        gameNumber: number;
        completed: boolean;
        accuracy: number;
        lastPlayedAt?: string;
      }>;
      completed: boolean;
    }>;
    completed: boolean;
    unlocked: boolean;
  }>;
  currentSection?: number;
  currentLevelSE?: number;
  currentGame?: number;
  updatedAt?: string;
};

export async function fetchTherapyProgress(): Promise<{ therapies: TherapyProgress[] }> {
  const res = await fetch(`${API_BASE_URL}/api/therapy/progress`, {
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function initTherapyProgress(): Promise<{ ok: boolean; therapies: TherapyProgress[] }> {
  const res = await fetch(`${API_BASE_URL}/api/therapy/progress/init`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function advanceTherapyProgress(payload: {
  therapy: string;
  levelNumber?: number;
  sessionNumber?: number;
  gameId?: string;
  markCompleted?: boolean;
  // Special Education fields
  sectionNumber?: number;
  levelNumberSE?: number;
  gameNumber?: number;
  accuracy?: number;
}): Promise<{ ok: boolean; therapy: TherapyProgress }> {
  const res = await fetch(`${API_BASE_URL}/api/therapy/progress/advance`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export type SkillStat = {
  totalPrompts: number;
  correctPrompts: number;
  accuracy: number;
  avgResponseMs: number;
  attempts: number;
  ewmaAccuracy: number;
  streak: number;
  bestStreak: number;
  level: number;
  trend: number;
  lastPlayedDate: string | null;
};

export type SkillProfileEntry = {
  id: string;
  title: string;
  description: string;
  icon: string;
  tags: string[];
  stats: SkillStat | null;
};

export async function fetchSkillProfile(): Promise<{ skills: SkillProfileEntry[] }> {
  const res = await fetch(`${API_BASE_URL}/api/me/skill-profile`, {
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error('Failed to load skill profile');
  return res.json();
}

// Helper function for authenticated requests
async function authedFetch(endpoint: string, options: RequestInit = {}) {
  const url = `${API_BASE_URL}${endpoint}`;
  const headers = await authHeaders();

  const res = await fetch(url, {
    ...options,
    headers: {
      ...headers,
      ...options.headers,
    },
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`HTTP ${res.status}: ${errorText}`);
  }

  return res.json();
}

// Favorites API
export async function getFavorites(): Promise<{ favorites: string[] }> {
  return authedFetch('/api/me/favorites', { method: 'GET' });
}

export async function toggleFavorite(tileId: string): Promise<{ isFavorite: boolean; favorites: string[] }> {
  return authedFetch('/api/me/favorites/toggle', {
    method: 'POST',
    body: JSON.stringify({ tileId }),
  });
}

// Custom Tiles API
export type CustomTile = { id: string; label: string; emoji?: string; imageUrl?: string };

export async function getCustomTiles(): Promise<{ tiles: CustomTile[] }> {
  return authedFetch('/api/me/custom-tiles', { method: 'GET' });
}

export async function addCustomTile(tile: CustomTile): Promise<{ tile: CustomTile }> {
  return authedFetch('/api/me/custom-tiles', {
    method: 'POST',
    body: JSON.stringify(tile),
  });
}

export async function deleteCustomTile(id: string): Promise<{ ok: true }> {
  return authedFetch(`/api/me/custom-tiles/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

// Contact API
export async function sendContactMessage(payload: { subject?: string; message: string }): Promise<{ ok: boolean; id?: string }> {
  return authedFetch('/api/me/contact', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

// ----- Smart Explorer API -----

export type SmartSceneSummary = {
  _id: string;
  slug: string;
  title: string;
  imageUrl: string;
  meta?: Record<string, unknown>;
  itemCount: number;
};

export type SmartSceneDetail = {
  scene: SmartSceneSummary;
  items: Array<{
    _id: string;
    label: string;
    altLabels?: string[];
    bbox: { x: number; y: number; w: number; h: number };
    tags?: string[];
    tts?: Record<string, string | undefined>;
  }>;
  prompts: Array<any>;
};

async function apiGet(path: string) {
  try {
    const headers = await authHeaders();
    
    // Ensure x-auth0-id header is set (fallback for localhost)
    if (!headers['x-auth0-id'] && !auth0UserInfo?.auth0Id) {
      headers['x-auth0-id'] = 'dev_local_tester'; // fallback for dev/testing
    }
    
    const url = `${API_BASE_URL}${path}`;
    console.log(`[API] GET ${url}`);
    console.log(`[API] Headers:`, Object.keys(headers));
    
    // Create abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
    
    try {
      const res = await fetch(url, {
        headers,
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        console.error(`[API] HTTP ${res.status} error for ${url}:`, text);
        throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
      }
      
      return res.json();
    } catch (fetchError: any) {
      clearTimeout(timeoutId);
      console.error(`[API] Fetch error for ${url}:`, fetchError);
      
      // Provide more helpful error messages
      if (fetchError.name === 'AbortError' || fetchError.name === 'TimeoutError') {
        throw new Error(`Request to ${url} timed out after 30 seconds. Please check if the server is running.`);
      } else if (fetchError.message?.includes('Failed to fetch') || fetchError.message?.includes('NetworkError')) {
        throw new Error(`Failed to connect to server at ${API_BASE_URL}. Please ensure the backend server is running on port 4000.`);
      }
      throw fetchError;
    }
  } catch (error: any) {
    console.error(`[API] Error in apiGet for ${path}:`, error);
    // Re-throw with more context
    if (error.message) {
      throw error;
    }
    throw new Error(`Failed to fetch ${path}: ${error.message || 'Unknown error'}`);
  }
}

async function apiPost(path: string, body?: any) {
  const headers = await authHeaders();
  
  // Ensure x-auth0-id header is set (fallback for localhost)
  if (!headers['x-auth0-id'] && !auth0UserInfo?.auth0Id) {
    headers['x-auth0-id'] = 'dev_local_tester'; // fallback for dev/testing
  }
  
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
  }
  return res.json();
}

export async function fetchSmartScenes(): Promise<{ scenes: SmartSceneSummary[] }> {
  return apiGet('/api/smart-explorer/scenes');
}

export async function fetchSmartSceneDetail(slug: string): Promise<SmartSceneDetail> {
  return apiGet(`/api/smart-explorer/scenes/${encodeURIComponent(slug)}`);
}

export async function startSmartExplorerSession(payload: {
  sceneSlug: string;
  mode: 'learn' | 'play' | 'therapy';
}) {
  return apiPost('/api/smart-explorer/sessions/start', payload);
}

export async function submitSmartExplorerPrompt(
  sessionId: string,
  payload: {
    promptId: string;
    correct: boolean;
    responseTimeMs: number;
    incorrectTaps?: number;
    hintsUsed?: string[];
    events?: Array<{ event: string; data?: Record<string, unknown>; correct?: boolean }>;
  },
) {
  return apiPost(`/api/smart-explorer/sessions/${sessionId}/prompt`, payload);
}

export async function completeSmartExplorerSession(sessionId: string) {
  return apiPost(`/api/smart-explorer/sessions/${sessionId}/complete`);
}

// ========== Subscription & Payment APIs ==========

export type SubscriptionStatus = {
  ok: boolean;
  hasAccess: boolean;
  status: 'none' | 'trial' | 'active' | 'expired' | 'cancelled' | 'past_due';
  isTrial: boolean;
  isActive: boolean;
  trialEndDate: string | null;
  subscriptionEndDate: string | null;
  nextBillingDate: string | null;
  razorpaySubscriptionId: string | null;
};

/**
 * Get current subscription status
 */
export async function getSubscriptionStatus(): Promise<SubscriptionStatus> {
  return apiGet('/api/subscription/status');
}

/**
 * Create Razorpay subscription
 */
export async function createSubscription(): Promise<{
  ok: boolean;
  subscriptionId: string;
  planId: string;
  customerId: string;
  amount: number;
  currency: string;
}> {
  return apiPost('/api/subscription/create-subscription');
}

/**
 * Verify payment after Razorpay checkout
 */
export async function verifyPayment(paymentData: {
  razorpay_payment_id: string;
  razorpay_subscription_id: string;
  razorpay_signature: string;
}): Promise<{ ok: boolean; message: string; subscriptionStatus: string }> {
  return apiPost('/api/subscription/verify-payment', paymentData);
}

/**
 * Cancel subscription
 */
export async function cancelSubscription(reason?: string): Promise<{ ok: boolean; message: string }> {
  return apiPost('/api/subscription/cancel', { reason });
}

/**
 * Sync subscription status from Razorpay
 * Useful when payment is successful but status wasn't updated
 */
export async function syncSubscriptionStatus(): Promise<{ ok: boolean; message: string; status?: string }> {
  return apiPost('/api/subscription/sync-status');
}

/**
 * Expire trial for testing (development only)
 */
export async function expireTrialForTesting(): Promise<{ ok: boolean; message: string; trialEndDate: string }> {
  return apiPost('/api/subscription/expire-trial');
}


