import AnimatedAccuracyRing from '@/components/AnimatedAccuracyRing';
import { images } from '@/constants/images';
import {
  fetchMyStats,
  fetchSkillProfile,
  type SkillProfileEntry,
  type StatsResponse
} from '@/utils/api';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import Lottie from 'lottie-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Easing,
  Image,
  Platform,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View
} from 'react-native';

// --- Types ---
type IoniconName = keyof typeof Ionicons.glyphMap;
type StatBlock = {
  key: string;
  title: string;
  value: string;
  caption: string;
  icon: IoniconName;
  accent: string;
  gradient: [string, string];
  glowColor: string;
};
type QuickAction = {
  key: string;
  label: string;
  caption: string;
  icon: IoniconName;
  accent: string;
  gradient: [string, string];
  onPress: () => void;
};
type MoodOption = 'energetic' | 'focused' | 'relaxed' | 'celebrating';

// --- Helpers ---
const { width } = Dimensions.get('window');
const isSmall = width < 380;
const homeProgressLoaderAnimation = require('@/assets/animation/loading.json');

let NativeLottie: any = null;
if (Platform.OS !== 'web') {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  NativeLottie = require('lottie-react-native').default;
}
const compactNumber = (n: number) =>
  Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n);

// --- Components ---

// Enhanced Glass Card Component with better styling
const GlassCard = ({ children, style, intensity = 0.92, animated = false, glow = false }: any) => {
  const ViewComponent = animated ? Animated.View : View;
  return (
    <ViewComponent
      style={[
        {
          backgroundColor: `rgba(255, 255, 255, ${intensity})`,
          borderRadius: 28,
          borderWidth: 1.5,
          borderColor: 'rgba(255, 255, 255, 0.8)',
          shadowColor: glow ? '#6366F1' : '#000',
          shadowOffset: { width: 0, height: 8 },
          shadowOpacity: glow ? 0.2 : 0.08,
          shadowRadius: glow ? 24 : 16,
          elevation: 8,
          overflow: 'hidden',
        },
        style,
      ]}
    >
      {children}
    </ViewComponent>
  );
};

function HomeLoadingContent() {
  const loaderSize = width > 500 ? 320 : 240;
  return (
    <View style={styles.homeLoadingContainer}>
      <View style={styles.homeLoaderBadge}>
        <Image source={images.logo} style={styles.homeLoaderBadgeLogo} />
      </View>
      <View style={styles.homeLoaderCard}>
        <HomeLoadingAnimation size={loaderSize} />
      </View>
    </View>
  );
}

function HomeLoadingAnimation({ size = 240 }: { size?: number }) {
  if (Platform.OS === 'web') {
    return (
      <Lottie
        animationData={homeProgressLoaderAnimation}
        loop
        autoplay
        style={{ width: size, height: size }}
      />
    );
  }

  if (NativeLottie) {
    return (
      <NativeLottie
        source={homeProgressLoaderAnimation}
        autoPlay
        loop
        style={{ width: size, height: size }}
      />
    );
  }

  return <ActivityIndicator size="large" color="#8B5CF6" />;
}

export default function Index() {
  const router = useRouter();
  // Initialize with default values so UI can render immediately
  const [stats, setStats] = useState<StatsResponse | null>({
    xp: 0,
    coins: 0,
    hearts: 5,
    streakDays: 0,
    bestStreak: 0,
    lastPlayedDate: null,
    accuracy: 0,
    levelLabel: 'Explorer',
  });
  const [refreshing, setRefreshing] = useState(false);
  const [skillProfile, setSkillProfile] = useState<SkillProfileEntry[] | null>([]);
  const [selectedMood, setSelectedMood] = useState<MoodOption>('focused');
  const [canScroll, setCanScroll] = useState(true);
  const [layoutHeight, setLayoutHeight] = useState(0);
  const enablePullToRefresh = Platform.OS !== 'android' || canScroll;
  const hasLoadedOnceRef = useRef(false);

  // Animations
  const scrollY = useRef(new Animated.Value(0)).current;
  const heroAnim = useRef(new Animated.Value(0)).current;
  const statAnimations = useRef<Record<string, Animated.Value>>({});
  const quickAnimations = useRef<Record<string, Animated.Value>>({});
  const moodAnimations = useRef<Record<string, Animated.Value>>({});

  const isLoadingRef = useRef(false);
  const prevAccRef = useRef<number>(0);

  const loadStats = useCallback(async () => {
    if (isLoadingRef.current) return;
    isLoadingRef.current = true;
    
    // Load both API calls in parallel for faster loading
    try {
      const [s, profile] = await Promise.all([
        fetchMyStats().catch((error) => {
          console.warn('Failed to load stats', error);
          return null;
        }),
        fetchSkillProfile().catch((error) => {
          console.warn('Failed to load skill profile', error);
          return null;
        })
      ]);
      
      // Update stats immediately when available
      if (s) {
        prevAccRef.current = stats?.accuracy ?? s?.accuracy ?? 0;
        setStats(s);
      }
      
      // Update skill profile immediately when available
      if (profile) {
        setSkillProfile(profile.skills || []);
      }
      
      // Mark that we've loaded at least once
      hasLoadedOnceRef.current = true;
    } finally {
      isLoadingRef.current = false;
    }
  }, [stats?.accuracy]);

  useFocusEffect(
    useCallback(() => {
      loadStats();
    }, [loadStats])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadStats();
    setRefreshing(false);
  }, [loadStats]);

  // Data
  const xp = stats?.xp ?? 0;
  const coins = stats?.coins ?? 0;
  const hearts = stats?.hearts ?? 5;
  const streak = stats?.streakDays ?? 0;
  const bestStreak = stats?.bestStreak ?? 0;
  const accuracy = stats?.accuracy ?? 0;

  const statBlocks = useMemo<StatBlock[]>(() => [
    {
      key: 'xp',
      title: 'XP',
      value: compactNumber(xp),
      caption: 'Total collected',
      icon: 'flash',
      accent: '#8B5CF6',
      gradient: ['#F3E8FF', '#E9D5FF'],
      glowColor: '#8B5CF6',
    },
    {
      key: 'coins',
      title: 'Coins',
      value: compactNumber(coins),
      caption: 'Rewards',
      icon: 'star',
      accent: '#F59E0B',
      gradient: ['#FFFBEB', '#FEF3C7'],
      glowColor: '#F59E0B',
    },
    {
      key: 'streak',
      title: 'Streak',
      value: `${streak}`,
      caption: 'Days active',
      icon: 'flame',
      accent: '#F97316',
      gradient: ['#FFF7ED', '#FFEDD5'],
      glowColor: '#F97316',
    },
    {
      key: 'hearts',
      title: 'Lives',
      value: `${hearts}`,
      caption: 'Remaining',
      icon: 'heart',
      accent: '#EF4444',
      gradient: ['#FEF2F2', '#FEE2E2'],
      glowColor: '#EF4444',
    },
  ], [xp, coins, hearts, streak]);

  const quickActions = useMemo<QuickAction[]>(() => {
    const defaults: QuickAction[] = [
      {
        key: 'play',
        label: 'Play Game',
        caption: 'Earn XP',
        icon: 'game-controller',
        accent: '#8B5CF6',
        gradient: ['#8B5CF6', '#7C3AED'],
        onPress: () => router.push('/(tabs)/Games'),
      },
      {
        key: 'aac',
        label: 'AAC Grid',
        caption: 'Practice',
        icon: 'grid',
        accent: '#0EA5E9',
        gradient: ['#0EA5E9', '#0284C7'],
        onPress: () => router.push('/(tabs)/AACgrid'),
      },
      {
        key: 'smart',
        label: 'Explorer',
        caption: 'Discover',
        icon: 'map',
        accent: '#10B981',
        gradient: ['#10B981', '#059669'],
        onPress: () => router.push('/(tabs)/SmartExplorer'),
      },
      {
        key: 'profile',
        label: 'Profile',
        caption: 'Update',
        icon: 'person',
        accent: '#EC4899',
        gradient: ['#EC4899', '#DB2777'],
        onPress: () => router.push('/(tabs)/Profile'),
      },
    ];
    return defaults;
  }, [router]);

  // Initialize animations
  statBlocks.forEach(b => {
    if (!statAnimations.current[b.key]) statAnimations.current[b.key] = new Animated.Value(0);
  });
  quickActions.forEach(a => {
    if (!quickAnimations.current[a.key]) quickAnimations.current[a.key] = new Animated.Value(0);
  });
  (['energetic', 'focused', 'relaxed', 'celebrating'] as MoodOption[]).forEach(m => {
    if (!moodAnimations.current[m]) moodAnimations.current[m] = new Animated.Value(0);
  });

  useEffect(() => {
    if (!stats) return;

    Animated.timing(heroAnim, {
      toValue: 1,
      duration: 1000,
      easing: Easing.out(Easing.back(1.2)),
      useNativeDriver: true,
    }).start();

    const statStagger = Animated.stagger(120, statBlocks.map(b =>
      Animated.spring(statAnimations.current[b.key], {
        toValue: 1,
        friction: 7,
        tension: 50,
        useNativeDriver: true,
      })
    ));

    const quickStagger = Animated.stagger(100, quickActions.map(a =>
      Animated.spring(quickAnimations.current[a.key], {
        toValue: 1,
        friction: 6,
        tension: 60,
        useNativeDriver: true,
      })
    ));

    const moodStagger = Animated.stagger(80, (['energetic', 'focused', 'relaxed', 'celebrating'] as MoodOption[]).map(m =>
      Animated.spring(moodAnimations.current[m], {
        toValue: 1,
        friction: 8,
        tension: 50,
        useNativeDriver: true,
      })
    ));

    Animated.sequence([
      Animated.delay(300),
      statStagger,
      Animated.delay(150),
      quickStagger,
      Animated.delay(100),
      moodStagger
    ]).start();

  }, [stats]);

  const headerTranslateY = scrollY.interpolate({
    inputRange: [0, 120],
    outputRange: [0, -60],
    extrapolate: 'clamp',
  });

  const headerOpacity = scrollY.interpolate({
    inputRange: [0, 120],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });

  // Always show UI immediately with default values
  // Data will populate as it loads - no blocking loading screen

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" />
      <LinearGradient
        colors={['#FDF4FF', '#FAE8FF', '#F0F9FF', '#E0F2FE']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      {/* Enhanced Background Decorative Elements */}
      <View style={[styles.blob, styles.blob1]} />
      <View style={[styles.blob, styles.blob2]} />
      <View style={[styles.blob, styles.blob3]} />

      <Animated.ScrollView
        style={{ flex: 1, backgroundColor: 'transparent' }}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        overScrollMode="never"
        bounces={false}
        directionalLockEnabled
        alwaysBounceHorizontal={false}
        contentInsetAdjustmentBehavior="never"
        refreshControl={enablePullToRefresh
          ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#8B5CF6" />
          : undefined
        }
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { y: scrollY } } }],
          { useNativeDriver: true }
        )}
        scrollEventThrottle={16}
        scrollEnabled={Platform.OS === 'android' ? canScroll : true}
        onLayout={(e) => {
          setLayoutHeight(e.nativeEvent.layout.height);
        }}
        onContentSizeChange={(_, contentHeight) => {
          if (Platform.OS === 'android') {
            setCanScroll(contentHeight > layoutHeight + 24);
          }
        }}
      >
        {/* Enhanced Header Section */}
        <Animated.View style={[styles.header, { opacity: headerOpacity, transform: [{ translateY: headerTranslateY }] }]}>
          <View style={styles.headerContent}>
            <View style={styles.greetingContainer}>
              <Text style={styles.greeting}>Hello there! 👋</Text>
              <Text style={styles.subGreeting}>Ready for an amazing day?</Text>
            </View>
            {stats?.levelLabel && (
              <GlassCard style={styles.headerBadge} intensity={0.95}>
                <LinearGradient
                  colors={['#FEF3C7', '#FDE68A']}
                  style={StyleSheet.absoluteFill}
                />
                <View style={styles.headerBadgeContent}>
                  <Ionicons name="trophy" size={18} color="#F59E0B" />
                  <Text style={styles.headerBadgeText}>{stats.levelLabel}</Text>
                </View>
              </GlassCard>
            )}
          </View>
        </Animated.View>

        {/* Enhanced Hero Card */}
        <Animated.View style={{ 
          opacity: heroAnim, 
          transform: [{ scale: heroAnim.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) }] 
        }}>
          <GlassCard style={styles.heroCard} glow={true}>
            <LinearGradient
              colors={['rgba(139, 92, 246, 0.15)', 'rgba(124, 58, 237, 0.1)', 'rgba(99, 102, 241, 0.08)']}
              style={StyleSheet.absoluteFill}
            />
            <View style={styles.heroContent}>
              <View style={styles.heroLeft}>
                <GlassCard style={styles.levelBadge} intensity={0.9}>
                  <LinearGradient
                    colors={['rgba(139, 92, 246, 0.2)', 'rgba(124, 58, 237, 0.15)']}
                    style={StyleSheet.absoluteFill}
                  />
                  <View style={styles.levelBadgeContent}>
                    <Ionicons name="sparkles" size={18} color="#8B5CF6" />
                    <Text style={styles.levelText}>{stats.levelLabel || 'Explorer'}</Text>
                  </View>
                </GlassCard>
                <Text style={styles.heroTitle}>Keep it up! 🎉</Text>
                <Text style={styles.heroSubtitle}>You're making amazing progress today.</Text>

                <View style={styles.heroStatsRow}>
                  <GlassCard style={styles.heroStat} intensity={0.95}>
                    <LinearGradient
                      colors={['#FFF7ED', '#FFEDD5']}
                      style={StyleSheet.absoluteFill}
                    />
                    <View style={styles.heroStatContent}>
                      <Ionicons name="flame" size={20} color="#F97316" />
                      <Text style={styles.heroStatText}>{streak} Day{streak !== 1 ? 's' : ''}</Text>
                    </View>
                  </GlassCard>
                  {bestStreak > streak && (
                    <GlassCard style={[styles.heroStat, { marginLeft: 10 }]} intensity={0.95}>
                      <LinearGradient
                        colors={['#FFFBEB', '#FEF3C7']}
                        style={StyleSheet.absoluteFill}
                      />
                      <View style={styles.heroStatContent}>
                        <Ionicons name="trophy" size={18} color="#F59E0B" />
                        <Text style={[styles.heroStatText, { color: '#92400E' }]}>Best: {bestStreak}</Text>
                      </View>
                    </GlassCard>
                  )}
                </View>
              </View>

              <View style={styles.heroRight}>
                <AnimatedAccuracyRing
                  value={accuracy}
                  size={130}
                  stroke={14}
                  progressColor="#8B5CF6"
                  trackColor="rgba(139, 92, 246, 0.2)"
                  label="Accuracy"
                  durationMs={1500}
                />
              </View>
            </View>
          </GlassCard>
        </Animated.View>

        {/* Enhanced Stats Grid */}
        <Text style={styles.sectionTitle}>Your Progress</Text>
        <View style={styles.statsGrid}>
          {statBlocks.map((block) => (
            <Animated.View
              key={block.key}
              style={[
                styles.statBlockContainer,
                {
                  opacity: statAnimations.current[block.key],
                  transform: [
                    {
                      translateY: statAnimations.current[block.key].interpolate({
                        inputRange: [0, 1],
                        outputRange: [60, 0]
                      })
                    },
                    {
                      scale: statAnimations.current[block.key].interpolate({
                        inputRange: [0, 1],
                        outputRange: [0.8, 1]
                      })
                    }
                  ]
                }
              ]}
            >
              <GlassCard style={styles.statCard} intensity={0.95}>
                <LinearGradient
                  colors={block.gradient}
                  style={[StyleSheet.absoluteFill, { opacity: 0.6 }]}
                />
                <View style={[styles.iconCircle, { backgroundColor: block.accent }]}>
                  <Ionicons name={block.icon} size={24} color="#FFF" />
                </View>
                <Text style={styles.statValue}>{block.value}</Text>
                <Text style={styles.statLabel}>{block.title}</Text>
                <Text style={styles.statCaption}>{block.caption}</Text>
              </GlassCard>
            </Animated.View>
          ))}
        </View>

        {/* Enhanced Quick Actions */}
        <Text style={styles.sectionTitle}>Quick Actions</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.quickActionsContainer}
          style={{ flexGrow: 0 }}
        >
          {quickActions.map((action, index) => (
            <Animated.View
              key={action.key}
              style={{
                opacity: quickAnimations.current[action.key],
                transform: [
                  { 
                    scale: quickAnimations.current[action.key].interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.7, 1]
                    })
                  },
                  {
                    translateX: quickAnimations.current[action.key].interpolate({
                      inputRange: [0, 1],
                      outputRange: [50, 0]
                    })
                  }
                ],
                marginRight: 16,
              }}
            >
              <Pressable
                onPress={action.onPress}
                style={({ pressed }) => [
                  styles.actionCard,
                  pressed && { transform: [{ scale: 0.96 }] }
                ]}
              >
                <LinearGradient
                  colors={action.gradient}
                  style={styles.actionGradient}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                >
                  <View style={[styles.actionIcon, { backgroundColor: 'rgba(255, 255, 255, 0.3)' }]}>
                    <Ionicons name={action.icon} size={28} color="#FFF" />
                  </View>
                  <View style={styles.actionTextContainer}>
                    <Text style={styles.actionLabel}>{action.label}</Text>
                    <Text style={styles.actionCaption}>{action.caption}</Text>
                  </View>
                </LinearGradient>
              </Pressable>
            </Animated.View>
          ))}
        </ScrollView>

        {/* Enhanced Mood Selector */}
        <Text style={styles.sectionTitle}>How are you feeling?</Text>
        <GlassCard style={styles.moodContainer} intensity={0.95}>
          <LinearGradient
            colors={['rgba(255, 255, 255, 0.9)', 'rgba(255, 255, 255, 0.7)']}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.moodRow}>
            {(['energetic', 'focused', 'relaxed', 'celebrating'] as MoodOption[]).map((mood) => {
              const isSelected = selectedMood === mood;
              const config: { emoji: string; color: string; gradient: [string, string] } = {
                energetic: { emoji: '⚡', color: '#F59E0B', gradient: ['#FEF3C7', '#FDE68A'] as [string, string] },
                focused: { emoji: '🎯', color: '#8B5CF6', gradient: ['#E9D5FF', '#DDD6FE'] as [string, string] },
                relaxed: { emoji: '🍃', color: '#10B981', gradient: ['#D1FAE5', '#A7F3D0'] as [string, string] },
                celebrating: { emoji: '🏆', color: '#EC4899', gradient: ['#FCE7F3', '#FBCFE8'] as [string, string] },
              }[mood];

              return (
                <Animated.View
                  key={mood}
                  style={{
                    flex: 1,
                    opacity: moodAnimations.current[mood],
                    transform: [
                      {
                        scale: moodAnimations.current[mood].interpolate({
                          inputRange: [0, 1],
                          outputRange: [0.5, 1]
                        })
                      }
                    ]
                  }}
                >
                  <Pressable
                    onPress={() => setSelectedMood(mood)}
                    style={({ pressed }) => [
                      styles.moodButton,
                      isSelected && styles.moodButtonSelected,
                      pressed && { transform: [{ scale: 0.95 }] }
                    ]}
                  >
                    {isSelected && (
                      <LinearGradient
                        colors={config.gradient}
                        style={StyleSheet.absoluteFill}
                      />
                    )}
                    <Text style={styles.moodEmoji}>{config.emoji}</Text>
                    <Text style={[
                      styles.moodLabel,
                      isSelected && { color: config.color, fontWeight: '800' }
                    ]}>
                      {mood.charAt(0).toUpperCase() + mood.slice(1)}
                    </Text>
                  </Pressable>
                </Animated.View>
              );
            })}
          </View>
        </GlassCard>

        <View style={{ height: 40 }} />
      </Animated.ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FDF4FF',
    overflow: 'hidden',
  },
  homeLoadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingHorizontal: 24,
    paddingTop: 120,
  },
  homeLoaderBadge: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: '#3B82F6',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    shadowColor: '#3B82F6',
    shadowOpacity: 0.25,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10,
  },
  homeLoaderBadgeLogo: {
    width: 48,
    height: 48,
  },
  homeLoaderCard: {
    width: width > 500 ? 340 : 270,
    height: width > 500 ? 340 : 270,
    borderRadius: 40,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    shadowColor: '#0F172A',
    shadowOpacity: 0.12,
    shadowRadius: 32,
    shadowOffset: { width: 0, height: 20 },
    elevation: 14,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: 20,
    fontSize: 18,
    color: '#8B5CF6',
    fontWeight: '700',
  },
  blob: {
    position: 'absolute',
    width: 350,
    height: 350,
    borderRadius: 175,
    opacity: 0.3,
  },
  blob1: {
    backgroundColor: '#E9D5FF',
    top: -150,
    right: -150,
  },
  blob2: {
    backgroundColor: '#FBCFE8',
    bottom: -100,
    left: -150,
  },
  blob3: {
    backgroundColor: '#BFDBFE',
    top: '40%',
    right: -100,
    width: 250,
    height: 250,
    borderRadius: 125,
  },
  scrollContent: {
    padding: 24,
    paddingTop: Platform.OS === 'ios' ? 70 : 50,
    paddingBottom: 40,
  },
  header: {
    marginBottom: 32,
  },
  headerContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  greetingContainer: {
    flex: 1,
  },
  greeting: {
    fontSize: 36,
    fontWeight: '900',
    color: '#1E1B4B',
    letterSpacing: -1,
    marginBottom: 8,
  },
  subGreeting: {
    fontSize: 18,
    color: '#64748B',
    fontWeight: '600',
  },
  headerBadge: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 24,
  },
  headerBadgeContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerBadgeText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#92400E',
    marginLeft: 8,
  },
  heroCard: {
    padding: 32,
    minHeight: 200,
  },
  heroContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  heroLeft: {
    flex: 1,
    paddingRight: 16,
  },
  heroRight: {
    marginLeft: 8,
  },
  levelBadge: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    alignSelf: 'flex-start',
    marginBottom: 16,
  },
  levelBadgeContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  levelText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#6D28D9',
    marginLeft: 8,
  },
  heroTitle: {
    fontSize: 28,
    fontWeight: '900',
    color: '#1E1B4B',
    marginBottom: 8,
    letterSpacing: -0.8,
  },
  heroSubtitle: {
    fontSize: 16,
    color: '#64748B',
    marginBottom: 20,
    fontWeight: '600',
  },
  heroStatsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  heroStat: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
  },
  heroStatContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  heroStatText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#C2410C',
    marginLeft: 8,
  },
  sectionTitle: {
    fontSize: 24,
    fontWeight: '900',
    color: '#1E1B4B',
    marginTop: 40,
    marginBottom: 20,
    letterSpacing: -0.5,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 12,
  },
  statBlockContainer: {
    width: (width - 60) / 2,
  },
  statCard: {
    padding: 24,
    alignItems: 'center',
    minHeight: 170,
    justifyContent: 'center',
  },
  iconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 6,
  },
  statValue: {
    fontSize: 32,
    fontWeight: '900',
    color: '#1E1B4B',
    letterSpacing: -1,
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 16,
    color: '#475569',
    fontWeight: '700',
    marginBottom: 2,
  },
  statCaption: {
    fontSize: 12,
    color: '#94A3B8',
    fontWeight: '500',
  },
  quickActionsContainer: {
    paddingRight: 20,
  },
  actionCard: {
    width: 160,
    height: 180,
    borderRadius: 32,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 8,
  },
  actionGradient: {
    flex: 1,
    padding: 20,
    justifyContent: 'space-between',
  },
  actionIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  actionTextContainer: {
    marginTop: 'auto',
  },
  actionLabel: {
    fontSize: 18,
    fontWeight: '900',
    color: '#FFF',
    marginBottom: 4,
  },
  actionCaption: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.9)',
    fontWeight: '600',
  },
  moodContainer: {
    padding: 20,
  },
  moodRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
  },
  moodButton: {
    alignItems: 'center',
    padding: 16,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: 'rgba(148, 163, 184, 0.3)',
    flex: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.7)',
    overflow: 'hidden',
  },
  moodButtonSelected: {
    borderColor: 'transparent',
    shadowColor: '#8B5CF6',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 6,
  },
  moodEmoji: {
    fontSize: 32,
    marginBottom: 12,
  },
  moodLabel: {
    fontSize: 13,
    color: '#64748B',
    fontWeight: '700',
  },
});
