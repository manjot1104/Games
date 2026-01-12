import { useAuth } from '@/app/providers/AuthProvider';
import { images } from '@/constants/images';
import { getMyProfile } from '@/utils/api';
import {
  clearProfileCache,
  getCachedProfileStatus,
  isProfileComplete,
  setCachedProfileStatus,
} from '@/utils/profileCache';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Redirect } from 'expo-router';
import Lottie from 'lottie-react';
import React, { useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Animated,
    Dimensions,
    Easing,
    Image,
    Platform,
    Pressable,
    SafeAreaView,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import LoginButton from '../comonents/login';

const progressLoaderAnimation = require('@/assets/animation/loading.json');

let NativeLottie: any = null;
if (Platform.OS !== 'web') {
  NativeLottie = require('lottie-react-native').default;
}

export default function RootIndex() {
  const { session } = useAuth();
  const [redirectPath, setRedirectPath] = useState<string | null>(null);

  // Animation values (declare before any conditional returns to keep hook order stable)
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;
  const scaleAnim = useRef(new Animated.Value(0.95)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 800,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 700,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        tension: 50,
        friction: 7,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  // Clear cache when user logs out
  useEffect(() => {
    if (!session) {
      clearProfileCache();
      setRedirectPath(null);
    }
  }, [session]);

  useEffect(() => {
    if (session?.profile) {
      (async () => {
        // Optimistic Navigation: Navigate immediately based on cache
        // Pattern used by GitHub, Vercel, Linear - don't block on API calls
        const cached = await getCachedProfileStatus();
        
        if (cached?.isComplete) {
          // Cache says complete - navigate immediately
          setRedirectPath('/(tabs)');
        } else if (cached && !cached.isComplete) {
          // Cache says incomplete - navigate to complete-profile immediately
          setRedirectPath('/(auth)/complete-profile');
        } else {
          // No cache - navigate optimistically to tabs (route guard will handle verification)
          setRedirectPath('/(tabs)');
        }

        // Background verification: Update cache silently (non-blocking)
        // This doesn't block navigation but keeps cache fresh for next time
        (async () => {
          try {
            const profile = await getMyProfile();
            const complete = isProfileComplete(profile);
            
            // Update cache for next time (silent background update)
            await setCachedProfileStatus(complete, {
              firstName: profile.firstName,
              dob: profile.dob || undefined,
              phoneNumber: profile.phoneNumber,
            });
            
            // Route guards will handle any discrepancies - don't update redirect here
            // This keeps navigation instant while cache stays fresh
          } catch (e) {
            // Silent failure - route guards will handle verification on protected routes
            console.error('Background profile verification failed:', e);
          }
        })();
      })();
    }
  }, [session]);

  // If authenticated, navigate optimistically (no blocking wait)
  if (session) {
    // Show brief loading only if we don't have a redirect path yet (cache check in progress)
    if (!redirectPath) {
      return (
        <SafeAreaView style={{ flex: 1, backgroundColor: '#F8FAFC' }}>
          <LinearGradient
            colors={['#E0F2FE', '#F0F9FF', '#FFFFFF']}
            style={StyleSheet.absoluteFillObject}
          />
          <AuthLoadingContent />
        </SafeAreaView>
      );
    }
    // Navigate immediately based on cache (optimistic)
    return <Redirect href={redirectPath as any} />;
  }

  // Show beautiful homepage for unauthenticated users
  return (
    <SafeAreaView style={styles.container}>
      <LinearGradient
        colors={['#E0F2FE', '#F0F9FF', '#FFFFFF']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />
      
      {/* Header with Login Button */}
      <Animated.View
        style={[
          styles.header,
          {
            opacity: fadeAnim,
            transform: [{ translateY: slideAnim }],
          },
        ]}
      >
        <View style={styles.headerContent}>
          <View style={styles.logoContainer}>
            <LinearGradient
              colors={['#3B82F6', '#6366F1']}
              style={styles.logoGradient}
            >
              <Image source={images.logo} style={styles.logo} />
            </LinearGradient>
            <Text style={styles.logoText}>Autism Play</Text>
          </View>
          <LoginButton />
        </View>
      </Animated.View>

      {/* Hero Section */}
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View
          style={[
            styles.heroSection,
            {
              opacity: fadeAnim,
              transform: [{ translateY: slideAnim }, { scale: scaleAnim }],
            },
          ]}
        >
          <View style={styles.heroContent}>
            <Text style={styles.heroTitle}>
              Your Child's Health{'\n'}and Development{'\n'}in One Place
            </Text>
            <Text style={styles.heroSubtitle}>
              Empowering children with AAC tools, games, and personalized learning experiences
            </Text>
          </View>

          {/* Features Grid */}
          <View style={styles.featuresContainer}>
            <FeatureCard
              index={0}
              icon="grid-outline"
              title="AAC Grid"
              description="Communicate with visual symbols and tiles"
              gradient={['#DBEAFE', '#EFF6FF']}
              iconColor="#2563EB"
              delay={100}
            />
            <FeatureCard
              index={1}
              icon="game-controller-outline"
              title="Interactive Games"
              description="Fun learning activities for skill development"
              gradient={['#F3E8FF', '#FAF5FF']}
              iconColor="#7C3AED"
              delay={200}
            />
            <FeatureCard
              index={2}
              icon="trending-up-outline"
              title="Progress Tracking"
              description="Monitor your child's growth and achievements"
              gradient={['#D1FAE5', '#ECFDF5']}
              iconColor="#10B981"
              delay={300}
            />
            <FeatureCard
              index={3}
              icon="flame"
              title="Daily Streaks"
              description="Build consistent learning habits"
              gradient={['#FED7AA', '#FFF7ED']}
              iconColor="#F97316"
              delay={400}
            />
          </View>

          {/* CTA Section */}
          <Animated.View
            style={[
              styles.ctaSection,
              {
                opacity: fadeAnim,
                transform: [{ translateY: slideAnim }],
              },
            ]}
          >
            <LinearGradient
              colors={['#3B82F6', '#6366F1', '#8B5CF6']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.ctaGradient}
            >
              <View style={styles.ctaContent}>
                <View style={styles.ctaIconContainer}>
                  <Ionicons name="sparkles" size={32} color="#FFFFFF" />
                </View>
                <Text style={styles.ctaTitle}>Ready to Get Started?</Text>
                <Text style={styles.ctaSubtitle}>
                  Join thousands of families empowering their children's communication and learning
                </Text>
                <View style={styles.ctaButtonWrapper}>
                  <LoginButton />
                </View>
              </View>
            </LinearGradient>
          </Animated.View>
        </Animated.View>
      </ScrollView>
    </SafeAreaView>
  );
}

const AuthLoadingContent = () => {
  const loaderSize = width > 500 ? 320 : 240;
  return (
    <View style={styles.authLoadingContainer}>
      <View style={styles.loaderBadge}>
        <Image source={images.logo} style={styles.loaderBadgeLogo} />
      </View>
      <View style={styles.loaderCard}>
        <LoadingAnimation size={loaderSize} />
      </View>
    </View>
  );
};

const LoadingAnimation = ({ size = 240 }: { size?: number }) => {
  if (Platform.OS === 'web') {
    return (
      <Lottie
        animationData={progressLoaderAnimation}
        loop
        autoplay
        style={{ width: size, height: size }}
      />
    );
  }

  if (NativeLottie) {
    return (
      <NativeLottie
        source={progressLoaderAnimation}
        autoPlay
        loop
        style={{ width: size, height: size }}
      />
    );
  }

  return <ActivityIndicator size="large" color="#3B82F6" />;
};

// Feature Card Component with animations
function FeatureCard({
  index,
  icon,
  title,
  description,
  gradient,
  iconColor,
  delay,
}: {
  index: number;
  icon: string;
  title: string;
  description: string;
  gradient: [string, string];
  iconColor: string;
  delay: number;
}) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 600,
        delay,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 600,
        delay,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  return (
    <Animated.View
      style={[
        styles.featureCard,
        {
          opacity: fadeAnim,
          transform: [{ translateY: slideAnim }],
        },
      ]}
    >
      <Pressable
        style={styles.featurePressable}
        android_ripple={{ color: 'rgba(0,0,0,0.05)' }}
      >
        <LinearGradient
          colors={gradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.featureGradient}
        >
          <View style={[styles.featureIconContainer, { backgroundColor: iconColor + '15' }]}>
            <Ionicons name={icon as any} size={32} color={iconColor} />
          </View>
          <Text style={styles.featureTitle}>{title}</Text>
          <Text style={styles.featureDescription}>{description}</Text>
        </LinearGradient>
      </Pressable>
    </Animated.View>
  );
}

const { width } = Dimensions.get('window');

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  authLoadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingHorizontal: 24,
    paddingTop: 120,
  },
  loaderBadge: {
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
  loaderBadgeLogo: {
    width: 48,
    height: 48,
  },
  loaderCard: {
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
  loaderCopy: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0F172A',
    marginBottom: 16,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'ios' ? 12 : 20,
    paddingBottom: 16,
  },
  headerContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  logoContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  logoGradient: {
    width: 56,
    height: 56,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    shadowColor: '#3B82F6',
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  logo: {
    width: 36,
    height: 36,
  },
  logoText: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.5,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  heroSection: {
    paddingHorizontal: 20,
    paddingTop: 24,
  },
  heroContent: {
    alignItems: 'center',
    marginBottom: 32,
  },
  heroTitle: {
    fontSize: 36,
    fontWeight: '900',
    color: '#0F172A',
    textAlign: 'center',
    marginBottom: 16,
    lineHeight: 44,
    letterSpacing: -1,
  },
  heroSubtitle: {
    fontSize: 17,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 24,
    paddingHorizontal: 8,
  },
  featuresContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: 32,
  },
  featureCard: {
    width: (width - 48) / 2,
    marginBottom: 16,
  },
  featurePressable: {
    borderRadius: 24,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  featureGradient: {
    padding: 20,
    borderRadius: 24,
    minHeight: 160,
  },
  featureIconContainer: {
    width: 56,
    height: 56,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  featureTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 6,
  },
  featureDescription: {
    fontSize: 13,
    color: '#64748B',
    lineHeight: 20,
  },
  ctaSection: {
    marginTop: 8,
    marginBottom: 24,
  },
  ctaGradient: {
    borderRadius: 32,
    padding: 32,
    alignItems: 'center',
    shadowColor: '#6366F1',
    shadowOpacity: 0.3,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 8,
  },
  ctaContent: {
    alignItems: 'center',
    width: '100%',
  },
  ctaIconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  ctaTitle: {
    fontSize: 28,
    fontWeight: '900',
    color: '#FFFFFF',
    textAlign: 'center',
    marginBottom: 12,
    letterSpacing: -0.5,
  },
  ctaSubtitle: {
    fontSize: 15,
    color: 'rgba(255, 255, 255, 0.9)',
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 22,
    paddingHorizontal: 8,
  },
  ctaButtonWrapper: {
    width: '100%',
    alignItems: 'center',
  },
});
