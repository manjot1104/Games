import Paywall from '@/components/Paywall';
import { DailyActivitiesVideos } from '@/components/daily-activities/DailyActivitiesVideos';
import {
    advanceTherapyProgress,
    fetchTherapyProgress,
    getSubscriptionStatus,
    initTherapyProgress,
    type SubscriptionStatus,
    type TherapyProgress,
} from '@/utils/api';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Linking from 'expo-linking';
import React, { useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Platform,
    SafeAreaView,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

// Therapy Avatar website URL
const THERAPY_AVATAR_URL = 'https://therapy-avatar.vercel.app';

// FOR TESTING: Set to true to force progressive unlocking even for free access users
// Set to false in production
// IMPORTANT: Set this to true to test progressive unlocking with non-free-access users
const FORCE_PROGRESSIVE_UNLOCK = true; // Changed to true for testing

// Helper function to convert hex to rgba
const hexToRgba = (hex: string, alpha: number): string => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const THERAPIES = [
  { id: 'speech', label: 'Speech Therapy', desc: 'Improve communication and speech skills', color: '#2563EB', icon: 'mic' },
  { id: 'occupational', label: 'Occupational Therapy', desc: 'Develop daily living and motor skills', color: '#10B981', icon: 'hand-left' },
  { id: 'behavioral', label: 'Behavioral Therapy', desc: 'Learn positive behaviors and social skills', color: '#F59E0B', icon: 'sparkles' },
  { id: 'special-education', label: 'Special Education', desc: 'Educational activities tailored for special needs', color: '#8B5CF6', icon: 'school' },
  { id: 'daily-activities', label: 'Social Stories', desc: 'Learn through animated social stories', color: '#EC4899', icon: 'book' },
  { id: 'therapy-avatar', label: 'Therapy Avatar', desc: 'Interactive avatar-based learning', color: '#0EA5E9', icon: 'happy' },
];

type ViewMode = 'therapies' | 'levels' | 'sessions';

export default function TherapyProgressScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [therapies, setTherapies] = useState<TherapyProgress[]>([]);
  const [mode, setMode] = useState<ViewMode>('therapies');
  const [selectedTherapy, setSelectedTherapy] = useState<string | null>(null);
  const [selectedLevel, setSelectedLevel] = useState<number | null>(null);
  
  // Subscription access control
  const [subscriptionStatus, setSubscriptionStatus] = useState<SubscriptionStatus | null>(null);
  const [checkingAccess, setCheckingAccess] = useState(true);

  const fetchData = async (autoInit = true) => {
    setLoading(true);
    try {
      const res = await fetchTherapyProgress();
      const list = res.therapies || [];
      if (list.length === 0 && autoInit) {
        const init = await initTherapyProgress();
        setTherapies(init.therapies || []);
      } else {
        setTherapies(list);
      }
    } catch (e: any) {
      console.error('Failed to load therapy progress', e);
      Alert.alert('Error', e?.message || 'Could not load progress');
    } finally {
      setLoading(false);
    }
  };

  // Check subscription access on mount
  useEffect(() => {
    checkSubscriptionAccess();
  }, []);

  // Re-check access when returning from Paywall
  useEffect(() => {
    const unsubscribe = router.addListener?.('focus', () => {
      checkSubscriptionAccess();
    });
    return unsubscribe;
  }, [router]);

  const checkSubscriptionAccess = async () => {
    try {
      setCheckingAccess(true);
      const status = await getSubscriptionStatus();
      console.log('[THERAPY PROGRESS] Subscription status:', status);
      setSubscriptionStatus(status);
      
      // If user has access (trial or active subscription), load therapy data
      if (status.hasAccess) {
        console.log('[THERAPY PROGRESS] User has access - loading therapy data');
        await fetchData();
      } else {
        console.log('[THERAPY PROGRESS] User does NOT have access - will show Paywall');
      }
    } catch (error: any) {
      console.error('Failed to check subscription access:', error);
      // On error, still try to load data (graceful degradation)
      await fetchData();
    } finally {
      setCheckingAccess(false);
    }
  };

  const progressMap = useMemo(() => new Map(therapies.map((t) => [t.therapy, t])), [therapies]);
  const hasData = therapies && therapies.length > 0;

  // Show Paywall if user doesn't have access
  if (checkingAccess) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#8B5CF6" />
          <Text style={styles.loadingText}>Checking access...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!subscriptionStatus?.hasAccess) {
    return <Paywall onSuccess={checkSubscriptionAccess} />;
  }

  const handleSelectTherapy = async (therapyId: string) => {
    // If Therapy Avatar is selected, open the external website
    if (therapyId === 'therapy-avatar') {
      try {
        const url = THERAPY_AVATAR_URL;
        console.log('[TherapyProgress] Opening Therapy Avatar website:', url);

        if (Platform.OS === 'web') {
          // On web, open in new tab
          if (typeof window !== 'undefined' && window.open) {
            window.open(url, '_blank', 'noopener,noreferrer');
          } else {
            Alert.alert('Error', 'Could not open the Therapy Avatar website. Please check your browser settings.');
          }
        } else {
          // On native (iOS/Android), open in browser
          const canOpen = await Linking.canOpenURL(url);
          if (canOpen) {
            await Linking.openURL(url);
          } else {
            Alert.alert('Error', 'Could not open the Therapy Avatar website. Please check the URL.');
          }
        }
      } catch (error: any) {
        console.error('[TherapyProgress] Failed to open Therapy Avatar website:', error);
        Alert.alert('Error', error?.message || 'Could not open the Therapy Avatar website.');
      }
      return;
    }

    // For daily-activities, navigate directly to videos (skip levels/sessions)
    if (therapyId === 'daily-activities') {
      router.push({
        pathname: '/(tabs)/SessionGames',
        params: {
          therapy: 'daily-activities',
        },
      });
      return;
    }

    // For special-education, navigate directly to special education navigator (skip levels/sessions)
    if (therapyId === 'special-education') {
      router.push({
        pathname: '/(tabs)/SessionGames',
        params: {
          therapy: 'special-education',
        },
      });
      return;
    }

    setSelectedTherapy(therapyId);
    setSelectedLevel(null);
    setMode('levels');
  };

  const handleSelectLevel = (level: number, unlocked: boolean) => {
    if (!unlocked) return;
    setSelectedLevel(level);
    setMode('sessions');
  };

  const handleCompleteSession = async (therapyId: string, level: number, session: number) => {
    setSaving(true);
    try {
      const res = await advanceTherapyProgress({
        therapy: therapyId,
        levelNumber: level,
        sessionNumber: session,
        markCompleted: true,
      });
      setTherapies((prev) =>
        prev.map((t) => (t.therapy === therapyId ? res.therapy : t)),
      );
      // If we just completed the current session, refresh selection
      setSelectedLevel(level);
      setMode('sessions');
    } catch (e: any) {
      console.error('Advance failed', e);
      Alert.alert('Error', e?.message || 'Could not update progress');
    } finally {
      setSaving(false);
    }
  };

  const currentTherapy = selectedTherapy ? progressMap.get(selectedTherapy) : null;
  const currentLevelObj =
    currentTherapy?.levels.find((l) => l.levelNumber === selectedLevel) || null;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Header mode={mode} onBack={() => setMode(mode === 'sessions' ? 'levels' : 'therapies')} showBack={mode !== 'therapies'} />

        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator size="large" color="#2563EB" />
          </View>
        ) : (
          <>
            {!hasData && (
              <TouchableOpacity style={styles.initButton} onPress={() => fetchData(true)}>
                <Ionicons name="refresh" size={18} color="#fff" />
                <Text style={styles.initButtonText}>Initialize Progress</Text>
              </TouchableOpacity>
            )}

            {mode === 'therapies' && (
              <TherapyGrid
                therapies={THERAPIES}
                progressMap={progressMap}
                onSelect={handleSelectTherapy}
                saving={saving}
              />
            )}

            {mode === 'levels' && selectedTherapy && (
              <>
                {selectedTherapy === 'daily-activities' ? (
                  <DailyActivitiesRedirect />
                ) : (
                  <LevelsGrid
                    therapyMeta={THERAPIES.find((t) => t.id === selectedTherapy)!}
                    therapy={progressMap.get(selectedTherapy)}
                    onSelectLevel={handleSelectLevel}
                    onBack={() => setMode('therapies')}
                    subscriptionStatus={subscriptionStatus}
                  />
                )}
              </>
            )}

            {mode === 'sessions' && selectedTherapy && selectedLevel && currentLevelObj && (
              <>
                {selectedTherapy === 'daily-activities' ? (
                  <DailyActivitiesRedirect />
                ) : (
                  <SessionsGrid
                    therapyMeta={THERAPIES.find((t) => t.id === selectedTherapy)!}
                    therapy={progressMap.get(selectedTherapy)!}
                    level={currentLevelObj}
                    saving={saving}
                    onComplete={handleCompleteSession}
                    subscriptionStatus={subscriptionStatus}
                  />
                )}
              </>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Header({ mode, onBack, showBack }: { mode: ViewMode; onBack: () => void; showBack: boolean }) {
  const title =
    mode === 'therapies'
      ? 'Select a Therapy'
      : mode === 'levels'
      ? 'Choose a Level'
      : 'Select a Session';
  const subtitle =
    mode === 'therapies'
      ? 'Choose a therapy to start your learning journey'
      : mode === 'levels'
      ? 'Each therapy has 10 levels · 10 sessions per level · 5 games per session'
      : 'Select a session to start playing games';

  return (
    <View style={styles.headerContainer}>
      <View style={styles.headerTop}>
        {showBack && (
          <TouchableOpacity onPress={onBack} style={styles.backButton}>
            <Ionicons name="arrow-back" size={20} color="#2563EB" />
            <Text style={styles.backText}>Back</Text>
          </TouchableOpacity>
        )}
        <View style={styles.menuButton}>
          <Ionicons name="menu" size={24} color="#1E293B" />
        </View>
      </View>
      <Text style={styles.headerTitle}>{title}</Text>
      <Text style={styles.headerSubtitle}>{subtitle}</Text>
    </View>
  );
}

function TherapyGrid({
  therapies,
  progressMap,
  onSelect,
  saving,
}: {
  therapies: typeof THERAPIES;
  progressMap: Map<string, TherapyProgress>;
  onSelect: (therapyId: string) => void;
  saving: boolean;
}) {
  return (
    <View style={styles.grid}>
      {therapies.map((t) => {
        const progress = progressMap.get(t.id);
        const currentLevel = progress?.currentLevel ?? 1;
        const currentSession = progress?.currentSession ?? 1;
        const iconGradientColors = [hexToRgba(t.color, 0.2), hexToRgba(t.color, 0.08)];
        const borderColor = hexToRgba(t.color, 0.3);
        const badgeBgColor = hexToRgba(t.color, 0.15);
        
        return (
          <TouchableOpacity
            key={t.id}
            style={[styles.therapyCard, { borderColor }]}
            activeOpacity={0.85}
            onPress={() => onSelect(t.id)}
            disabled={saving}
          >
            <LinearGradient
              colors={iconGradientColors}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.therapyIconWrap}
            >
              <Ionicons name={t.icon as any} size={36} color={t.color} />
            </LinearGradient>
            <View style={styles.therapyContent}>
              <Text style={styles.therapyTitle}>{t.label}</Text>
              <Text style={styles.therapyDesc}>{t.desc}</Text>
              <View style={styles.therapyMetaContainer}>
                <View style={[styles.progressBadge, { backgroundColor: badgeBgColor }]}>
                  <Text style={[styles.therapyMeta, { color: t.color }]}>
                    Level {currentLevel} • Session {currentSession}
                  </Text>
                </View>
              </View>
            </View>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function LevelsGrid({
  therapyMeta,
  therapy,
  onSelectLevel,
  onBack,
  subscriptionStatus,
}: {
  therapyMeta: { id: string; label: string; color: string };
  therapy?: TherapyProgress;
  onSelectLevel: (level: number, unlocked: boolean) => void;
  onBack: () => void;
  subscriptionStatus: SubscriptionStatus | null;
}) {
  const levels = therapy?.levels || [];
  const currentLevel = therapy?.currentLevel ?? 1;
  // Check for free access: either isFreeAccess flag or status === 'free'
  // Default to false (locked) if subscriptionStatus is null
  // FORCE_PROGRESSIVE_UNLOCK overrides free access for testing
  const isFreeAccess = FORCE_PROGRESSIVE_UNLOCK 
    ? false 
    : (subscriptionStatus 
      ? (subscriptionStatus.isFreeAccess === true || subscriptionStatus.status === 'free')
      : false);
  
  console.log('=== LEVELS GRID DEBUG ===');
  console.log('[LevelsGrid] subscriptionStatus:', subscriptionStatus);
  console.log('[LevelsGrid] FORCE_PROGRESSIVE_UNLOCK:', FORCE_PROGRESSIVE_UNLOCK);
  console.log('[LevelsGrid] isFreeAccess:', isFreeAccess);
  console.log('[LevelsGrid] isFreeAccess check:', {
    hasStatus: !!subscriptionStatus,
    isFreeAccessFlag: subscriptionStatus?.isFreeAccess,
    statusValue: subscriptionStatus?.status,
    forceProgressive: FORCE_PROGRESSIVE_UNLOCK,
    calculated: isFreeAccess,
    willUseProgressiveUnlock: !isFreeAccess
  });
  console.log('[LevelsGrid] levels count:', levels.length);
  console.log('[LevelsGrid] levels data:', levels.map(l => ({
    levelNumber: l.levelNumber,
    session10: {
      completed: l.sessions.find(s => s.sessionNumber === 10)?.completed,
      completedGames: l.sessions.find(s => s.sessionNumber === 10)?.completedGames?.length ?? 0
    }
  })));

  // Helper function to check if a level is unlocked
  const isLevelUnlocked = (levelNumber: number): boolean => {
    // Free access users have everything unlocked
    if (isFreeAccess) {
      console.log(`[UNLOCK] Level ${levelNumber}: Free access - UNLOCKED`);
      return true;
    }
    
    // Level 1 is always unlocked (for non-free-access users too)
    if (levelNumber === 1) {
      console.log(`[UNLOCK] Level ${levelNumber}: Level 1 - UNLOCKED (always)`);
      return true;
    }
    
    // For non-free-access users, check progressive unlock
    // A level is unlocked ONLY if the previous level's last session (session 10) has at least one completed game
    const previousLevel = levels.find(l => l.levelNumber === levelNumber - 1);
    if (!previousLevel) {
      console.log(`[UNLOCK] Level ${levelNumber}: Previous level not found - LOCKED`);
      return false;
    }
    
    const lastSession = previousLevel.sessions.find(s => s.sessionNumber === 10);
    if (!lastSession) {
      console.log(`[UNLOCK] Level ${levelNumber}: Previous level session 10 not found - LOCKED`);
      return false;
    }
    
    const hasCompletedGames = (lastSession.completedGames?.length ?? 0) > 0;
    const isCompleted = lastSession.completed ?? false;
    const unlocked = isCompleted || hasCompletedGames;
    
    console.log(`[UNLOCK] Level ${levelNumber}: Previous level last session - completed: ${isCompleted}, games: ${lastSession.completedGames?.length ?? 0}, unlocked: ${unlocked}`);
    
    // Explicitly return false if not unlocked (default to locked)
    if (!unlocked) {
      console.log(`[UNLOCK] Level ${levelNumber}: LOCKED - need to complete Level ${levelNumber - 1} Session 10 first`);
      return false;
    }
    
    return true;
  };

  return (
    <View style={{ gap: 12 }}>
      <TouchableOpacity onPress={onBack}>
        <Text style={{ color: '#2563EB', fontWeight: '700' }}>← Back to Therapies</Text>
      </TouchableOpacity>
      <View style={[styles.banner, { borderColor: hexToRgba(therapyMeta.color, 0.3) }]}>
        <LinearGradient
          colors={[hexToRgba(therapyMeta.color, 0.2), hexToRgba(therapyMeta.color, 0.1)]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.iconBadge}
        >
          <Ionicons name="medkit-outline" size={22} color={therapyMeta.color} />
        </LinearGradient>
        <View style={{ flex: 1 }}>
          <Text style={styles.bannerTitle}>{therapyMeta.label}</Text>
          <Text style={styles.bannerSubtitle}>10 sessions available</Text>
        </View>
      </View>
      <Text style={styles.sectionTitle}>Levels</Text>
      {isFreeAccess && (
        <View style={{ padding: 8, backgroundColor: '#FEF3C7', borderRadius: 8, marginBottom: 12 }}>
          <Text style={{ color: '#92400E', fontSize: 12, fontWeight: '600' }}>
            ⚠️ Free Access Mode: All levels unlocked
          </Text>
        </View>
      )}
      <View style={styles.grid}>
        {levels.map((lvl) => {
          const unlocked = isLevelUnlocked(lvl.levelNumber);
          console.log(`[LevelsGrid] Rendering Level ${lvl.levelNumber}: unlocked=${unlocked}, isFreeAccess=${isFreeAccess}`);
          return (
            <TouchableOpacity
              key={lvl.levelNumber}
              style={[
                styles.levelCard,
                unlocked ? styles.cardUnlocked : styles.cardLocked,
                unlocked && lvl.levelNumber === currentLevel ? { borderColor: therapyMeta.color } : null,
              ]}
              activeOpacity={unlocked ? 0.9 : 1}
              onPress={() => {
                if (!unlocked) {
                  Alert.alert('Locked', 'Complete the previous level to unlock this level.');
                  return;
                }
                onSelectLevel(lvl.levelNumber, unlocked);
              }}
            >
              <Text style={[styles.levelTitle, !unlocked && styles.lockedText]}>Level {lvl.levelNumber}</Text>
              <Text style={[styles.levelSubtitle, !unlocked && styles.lockedText]}>10 sessions available</Text>
              {!unlocked && (
                <View style={styles.lockBadge}>
                  <Ionicons name="lock-closed" size={14} color="#9CA3AF" />
                  <Text style={{ color: '#9CA3AF', fontWeight: '700', marginLeft: 4 }}>Locked</Text>
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

function SessionsGrid({
  therapyMeta,
  therapy,
  level,
  saving,
  onComplete,
  subscriptionStatus,
}: {
  therapyMeta: { id: string; label: string; color: string };
  therapy: TherapyProgress;
  level: TherapyProgress['levels'][number];
  saving: boolean;
  onComplete: (therapyId: string, levelNumber: number, sessionNumber: number) => void;
  subscriptionStatus: SubscriptionStatus | null;
}) {
  const router = useRouter();
  // Check for free access: either isFreeAccess flag or status === 'free'
  // Default to false (locked) if subscriptionStatus is null
  // FORCE_PROGRESSIVE_UNLOCK overrides free access for testing
  const isFreeAccess = FORCE_PROGRESSIVE_UNLOCK 
    ? false 
    : (subscriptionStatus 
      ? (subscriptionStatus.isFreeAccess === true || subscriptionStatus.status === 'free')
      : false);
  
  console.log('=== SESSIONS GRID DEBUG ===');
  console.log('[SessionsGrid] subscriptionStatus:', subscriptionStatus);
  console.log('[SessionsGrid] FORCE_PROGRESSIVE_UNLOCK:', FORCE_PROGRESSIVE_UNLOCK);
  console.log('[SessionsGrid] isFreeAccess:', isFreeAccess);
  console.log('[SessionsGrid] isFreeAccess check:', {
    hasStatus: !!subscriptionStatus,
    isFreeAccessFlag: subscriptionStatus?.isFreeAccess,
    statusValue: subscriptionStatus?.status,
    forceProgressive: FORCE_PROGRESSIVE_UNLOCK,
    calculated: isFreeAccess,
    willUseProgressiveUnlock: !isFreeAccess
  });
  console.log('[SessionsGrid] level:', level.levelNumber);
  console.log('[SessionsGrid] sessions count:', level.sessions.length);
  console.log('[SessionsGrid] sessions data:', level.sessions.map(s => ({
    sessionNumber: s.sessionNumber,
    completed: s.completed,
    completedGames: s.completedGames?.length ?? 0,
    completedGamesList: s.completedGames
  })));

  // Helper function to check if a session is unlocked
  const isSessionUnlocked = (sessionNumber: number): boolean => {
    // Free access users have everything unlocked
    if (isFreeAccess) {
      console.log(`[UNLOCK] Session ${sessionNumber}: Free access - UNLOCKED`);
      return true;
    }
    
    // Session 1 is always unlocked (for non-free-access users too)
    if (sessionNumber === 1) {
      console.log(`[UNLOCK] Session ${sessionNumber}: Session 1 - UNLOCKED (always)`);
      return true;
    }
    
    // For non-free-access users, check progressive unlock
    // A session is unlocked ONLY if the previous session has at least one completed game
    const previousSession = level.sessions.find(s => s.sessionNumber === sessionNumber - 1);
    if (!previousSession) {
      console.log(`[UNLOCK] Session ${sessionNumber}: Previous session not found - LOCKED`);
      return false;
    }
    
    const hasCompletedGames = (previousSession.completedGames?.length ?? 0) > 0;
    const isCompleted = previousSession.completed ?? false;
    const unlocked = isCompleted || hasCompletedGames;
    
    console.log(`[UNLOCK] Session ${sessionNumber}: Previous session (${sessionNumber - 1}) - completed: ${isCompleted}, games: ${previousSession.completedGames?.length ?? 0}, unlocked: ${unlocked}`);
    
    // Explicitly return false if not unlocked (default to locked)
    if (!unlocked) {
      console.log(`[UNLOCK] Session ${sessionNumber}: LOCKED - need to complete Session ${sessionNumber - 1} first`);
      return false;
    }
    
    return true;
  };

  return (
    <View style={{ gap: 12 }}>
      <TouchableOpacity onPress={() => {}}>
        <Text style={{ color: '#2563EB', fontWeight: '700' }}>← Back to {therapyMeta.label}</Text>
      </TouchableOpacity>
      <View style={[styles.banner, { borderColor: hexToRgba(therapyMeta.color, 0.3) }]}>
        <LinearGradient
          colors={[hexToRgba(therapyMeta.color, 0.2), hexToRgba(therapyMeta.color, 0.1)]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.iconBadge}
        >
          <Ionicons name="calendar-outline" size={22} color={therapyMeta.color} />
        </LinearGradient>
        <View style={{ flex: 1 }}>
          <Text style={styles.bannerTitle}>{therapyMeta.label} - Level {level.levelNumber}</Text>
          <Text style={styles.bannerSubtitle}>Select a session to start playing games</Text>
        </View>
      </View>
      <Text style={styles.sectionTitle}>Sessions</Text>
      {isFreeAccess && (
        <View style={{ padding: 8, backgroundColor: '#FEF3C7', borderRadius: 8, marginBottom: 12 }}>
          <Text style={{ color: '#92400E', fontSize: 12, fontWeight: '600' }}>
            ⚠️ Free Access Mode: All sessions unlocked
          </Text>
        </View>
      )}
      <View style={styles.grid}>
        {level.sessions.map((sess) => {
          const unlocked = isSessionUnlocked(sess.sessionNumber);
          const completed = sess.completed;
          const labelColor = unlocked ? '#0F172A' : '#9CA3AF';
          console.log(`[SessionsGrid] Rendering Session ${sess.sessionNumber}: unlocked=${unlocked}, isFreeAccess=${isFreeAccess}, completed=${completed}, games=${sess.completedGames?.length ?? 0}`);
          return (
            <TouchableOpacity
              key={sess.sessionNumber}
              style={[
                styles.sessionCard,
                unlocked ? styles.cardUnlocked : styles.cardLocked,
                completed ? { borderColor: therapyMeta.color, borderWidth: 2 } : null,
              ]}
              activeOpacity={unlocked ? 0.9 : 1}
              onPress={() => {
                if (!unlocked) {
                  Alert.alert('Locked', 'Complete the previous session to unlock this session.');
                  return;
                }
                
                // Navigate to unlocked session
                router.push({
                  pathname: '/(tabs)/SessionGames',
                  params: {
                    therapy: therapyMeta.id,
                    level: level.levelNumber.toString(),
                    session: sess.sessionNumber.toString(),
                  },
                });
              }}
            >
              <Text style={[styles.levelTitle, { color: labelColor }]}>
                Session {sess.sessionNumber}
              </Text>
              <Text style={[styles.levelSubtitle, { color: labelColor }]}>5 games available</Text>
              {!unlocked && (
                <View style={styles.lockBadge}>
                  <Ionicons name="lock-closed" size={14} color="#9CA3AF" />
                  <Text style={{ color: '#9CA3AF', fontWeight: '700', marginLeft: 4 }}>Locked</Text>
                </View>
              )}
              {completed && (
                <View style={styles.completeBadge}>
                  <Ionicons name="checkmark-circle" size={16} color={therapyMeta.color} />
                  <Text style={{ color: therapyMeta.color, fontWeight: '700', marginLeft: 4 }}>Completed</Text>
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </View>
      {saving && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <ActivityIndicator size="small" color={therapyMeta.color} />
          <Text style={{ color: '#475569' }}>Updating progress…</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#6B7280',
  },
  content: { padding: 20, paddingBottom: 32 },
  initButton: {
    marginTop: 12,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#2563EB',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  initButtonText: { color: '#fff', fontWeight: '800' },
  loading: { alignItems: 'center', justifyContent: 'center', paddingVertical: 40 },
  headerContainer: {
    marginBottom: 24,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: '#F1F5F9',
  },
  backText: {
    color: '#2563EB',
    fontWeight: '700',
    fontSize: 15,
  },
  menuButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  headerTitle: {
    fontSize: 32,
    fontWeight: '900',
    color: '#0F172A',
    letterSpacing: -0.5,
    marginBottom: 8,
  },
  headerSubtitle: {
    fontSize: 16,
    color: '#64748B',
    lineHeight: 24,
    fontWeight: '500',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
  },
  therapyCard: {
    width: '47.5%',
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 20,
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  therapyIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  therapyContent: {
    flex: 1,
  },
  therapyTitle: {
    fontSize: 19,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 8,
    letterSpacing: -0.3,
  },
  therapyDesc: {
    color: '#64748B',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 12,
    fontWeight: '500',
  },
  therapyMetaContainer: {
    marginTop: 'auto',
  },
  progressBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    alignSelf: 'flex-start',
  },
  therapyMeta: {
    fontWeight: '700',
    fontSize: 13,
    letterSpacing: 0.2,
  },
  banner: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 20,
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  bannerTitle: {
    fontSize: 22,
    fontWeight: '900',
    color: '#0F172A',
    letterSpacing: -0.3,
  },
  bannerSubtitle: {
    color: '#64748B',
    marginTop: 4,
    fontSize: 14,
    fontWeight: '500',
  },
  iconBadge: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0F172A',
    marginTop: 12,
    marginBottom: 8,
    letterSpacing: -0.3,
  },
  levelCard: {
    width: '47.5%',
    borderRadius: 18,
    padding: 18,
    borderWidth: 1.5,
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  sessionCard: {
    width: '47.5%',
    borderRadius: 18,
    padding: 18,
    borderWidth: 1.5,
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  cardUnlocked: {
    borderColor: '#E2E8F0',
  },
  cardLocked: {
    borderColor: '#E5E7EB',
    backgroundColor: '#F8FAFC',
  },
  levelTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.2,
  },
  levelSubtitle: {
    color: '#64748B',
    marginTop: 6,
    fontSize: 13,
    fontWeight: '500',
  },
  lockedText: { color: '#9CA3AF' },
  lockBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: '#F1F5F9',
    borderRadius: 10,
    alignSelf: 'flex-start',
  },
  completeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: '#ECFEFF',
    borderRadius: 10,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: '#CFFAFE',
  },
});

// Component to redirect daily-activities directly to videos (bypassing levels/sessions)
function DailyActivitiesRedirect() {
  const router = useRouter();
  
  React.useEffect(() => {
    // Navigate to a special route for social stories videos
    // We'll handle this in SessionGames.tsx
    router.replace({
      pathname: '/(tabs)/SessionGames',
      params: {
        therapy: 'daily-activities',
      },
    });
  }, [router]);

  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 }}>
      <ActivityIndicator size="large" color="#EC4899" />
      <Text style={{ marginTop: 16, color: '#475569' }}>Loading Social Stories...</Text>
    </View>
  );
}






