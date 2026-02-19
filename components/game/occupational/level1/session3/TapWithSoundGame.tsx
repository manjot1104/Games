import { SparkleBurst } from '@/components/game/FX';
import ResultCard from '@/components/game/ResultCard';
import { logGameAndAward, recordGame } from '@/utils/api';
import { cleanupSounds, stopAllSpeech } from '@/utils/soundPlayer';
import { Audio as ExpoAudio } from 'expo-av';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { speak as speakTTS, DEFAULT_TTS_RATE, stopTTS } from '@/utils/tts';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    Animated,
    Easing,
    Platform,
    Pressable,
    SafeAreaView,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';

// Using drum-like sounds (we'll use available sounds or generate tones)
const SLOW_DRUM_SOUND = 'https://actions.google.com/sounds/v1/cartoon/balloon_pop.ogg';
const FAST_DRUM_SOUND = 'https://actions.google.com/sounds/v1/cartoon/pop.ogg';
const SLOW_BEAT_INTERVAL = 1200; // 1.2 seconds - slow drum beat
const FAST_BEAT_INTERVAL = 400; // 0.4 seconds - fast drum beat
const TOTAL_BEATS = 16; // Total beats to complete
const BEATS_PER_MODE = 8; // 8 slow, then 8 fast

type BeatMode = 'slow' | 'fast';

const useSoundEffect = (uri: string) => {
  const soundRef = useRef<ExpoAudio.Sound | null>(null);

  const ensureSound = useCallback(async () => {
    if (soundRef.current) return;
    try {
      const { sound } = await ExpoAudio.Sound.createAsync(
        { uri },
        { volume: 0.7, shouldPlay: false },
      );
      soundRef.current = sound;
    } catch {
      console.warn('Failed to load sound:', uri);
    }
  }, [uri]);

  useEffect(() => {
    return () => {
      soundRef.current?.unloadAsync().catch(() => {});
    };
  }, []);

  const play = useCallback(async () => {
    try {
      if (Platform.OS === 'web') return;
      await ensureSound();
      if (soundRef.current) await soundRef.current.replayAsync();
    } catch {}
  }, [ensureSound]);

  return play;
};

const TapWithSoundGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const playSlowDrum = useSoundEffect(SLOW_DRUM_SOUND);
  const playFastDrum = useSoundEffect(FAST_DRUM_SOUND);

  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);
  const [beatMode, setBeatMode] = useState<BeatMode>('slow');
  const [isLit, setIsLit] = useState(false);
  const [beatCount, setBeatCount] = useState(0);
  const [lastTapTime, setLastTapTime] = useState<number | null>(null);
  const [syncScore, setSyncScore] = useState(0); // Track how well synced

  // Animation values
  const glowAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Get current beat interval based on mode
  const currentBeatInterval = beatMode === 'slow' ? SLOW_BEAT_INTERVAL : FAST_BEAT_INTERVAL;

  // Beat loop - plays sound and lights up circle
  // Initial instruction - only once
  useEffect(() => {
    try {
      speakTTS('Listen to the drum beat and tap with it! Start slow, then tap fast.', { rate: 0.78 });
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount

  useEffect(() => {
    if (done) return;

    const playBeat = () => {
      const now = Date.now();
      setLastTapTime(now);
      setBeatCount((prev) => {
        const newCount = prev + 1;

        // Switch to fast mode after BEATS_PER_MODE slow beats
        if (newCount >= BEATS_PER_MODE && beatMode === 'slow') {
          setBeatMode('fast');
          speakTTS('Now tap fast with the beat!', 0.78 );
        }

        return newCount;
      });

      // Play drum sound
      if (beatMode === 'slow') {
        playSlowDrum();
      } else {
        playFastDrum();
      }

      // Light up circle
      setIsLit(true);
      Animated.sequence([
        Animated.parallel([
          Animated.timing(glowAnim, {
            toValue: 1,
            duration: 100,
            easing: Easing.out(Easing.ease),
            useNativeDriver: false,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1.15,
            duration: 100,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.timing(glowAnim, {
            toValue: 0.6,
            duration: currentBeatInterval - 300,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: false,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: currentBeatInterval - 300,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.timing(glowAnim, {
            toValue: 0,
            duration: 100,
            easing: Easing.in(Easing.ease),
            useNativeDriver: false,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 100,
            easing: Easing.in(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
      ]).start(() => {
        setIsLit(false);
      });

      // Haptic feedback on beat
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    };

    // Start beat loop
    playBeat();
    const interval = setInterval(playBeat, currentBeatInterval);

    return () => clearInterval(interval);
  }, [currentBeatInterval, beatMode, done, glowAnim, pulseAnim, playSlowDrum, playFastDrum]);

  // Handle circle tap
  const handleTap = useCallback(async () => {
    if (done) return;

    const now = Date.now();
    const timeSinceBeat = lastTapTime ? now - lastTapTime : 0;
    const wasJustLit = isLit || timeSinceBeat < currentBeatInterval * 0.6; // 60% of beat interval window

    if (wasJustLit) {
      // Good sync - tapped with the beat
      const syncQuality = Math.abs(timeSinceBeat) < currentBeatInterval * 0.3 ? 1 : 0.5;
      setSyncScore((prev) => prev + syncQuality);

      setScore((s) => {
        const newScore = s + 1;

        // Success animation
        Animated.sequence([
          Animated.timing(scaleAnim, {
            toValue: 1.2,
            duration: 100,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(scaleAnim, {
            toValue: 1,
            duration: 100,
            easing: Easing.in(Easing.ease),
            useNativeDriver: true,
          }),
        ]).start();

        if (newScore >= TOTAL_BEATS) {
          setTimeout(() => {
            endGame(newScore);
          }, 500);
        }

        return newScore;
      });

      try {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      } catch {}
    }
  }, [done, isLit, lastTapTime, currentBeatInterval, scaleAnim]);

  // End game
  const endGame = useCallback(
    async (finalScore: number) => {
      const total = TOTAL_BEATS;
      const xp = finalScore * 12; // 12 XP per beat
      const accuracy = (finalScore / total) * 100;
      const syncAccuracy = (syncScore / total) * 100;

      setFinalStats({ correct: finalScore, total, xp });
      setDone(true);

      try {
        await recordGame(xp);
        const result = await logGameAndAward({
          type: 'tapWithSound',
          correct: finalScore,
          total,
          accuracy,
          xpAwarded: xp,
          skillTags: ['rhythm-entrainment', 'motor-synchronization', 'music-motor-integration'],
          meta: { syncAccuracy },
        });
        setLogTimestamp(result?.last?.at ?? null);
        router.setParams({ refreshStats: Date.now().toString() });
      } catch (e) {
        console.error('Failed to log tap with sound game:', e);
      }

      speakTTS('Great rhythm!', 0.78 );
    },
    [router, syncScore],
  );

  const handleBack = useCallback(() => {
    stopAllSpeech();
    cleanupSounds();
    onBack?.();
  }, [onBack]);

  // Glow animation style
  const glowStyle = {
    opacity: glowAnim.interpolate({
      inputRange: [0, 1],
      outputRange: [0, 0.8],
    }),
  };

  const circleColor = beatMode === 'slow' ? '#3B82F6' : '#F59E0B';
  const glowColor = beatMode === 'slow' ? '#3B82F6' : '#F59E0B';

  // Result screen
  if (done && finalStats) {
    const accuracyPct = Math.round((finalStats.correct / finalStats.total) * 100);
    return (
      <SafeAreaView style={styles.container}>
        <TouchableOpacity onPress={handleBack} style={styles.backChip}>
          <Text style={styles.backChipText}>← Back</Text>
        </TouchableOpacity>
        <ScrollView
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: 'center',
            alignItems: 'center',
            padding: 24,
          }}
        >
          <View style={styles.resultCard}>
            <Text style={{ fontSize: 64, marginBottom: 16 }}>🥁</Text>
            <Text style={styles.resultTitle}>Perfect rhythm!</Text>
            <Text style={styles.resultSubtitle}>
              You tapped {finalStats.correct} out of {finalStats.total} beats in sync.
            </Text>
            <ResultCard
              correct={finalStats.correct}
              total={finalStats.total}
              xpAwarded={finalStats.xp}
              accuracy={accuracyPct}
              logTimestamp={logTimestamp}
              onPlayAgain={() => {
                setScore(0);
                setBeatMode('slow');
                setBeatCount(0);
                setSyncScore(0);
                setDone(false);
                setFinalStats(null);
                setLogTimestamp(null);
                setIsLit(false);
                glowAnim.setValue(0);
              }}
            />
            <Text style={styles.savedText}>Saved! XP updated ✅</Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <TouchableOpacity onPress={handleBack} style={styles.backChip}>
        <Text style={styles.backChipText}>← Back</Text>
      </TouchableOpacity>

      <View style={styles.headerBlock}>
        <Text style={styles.title}>Tap With Sound</Text>
        <Text style={styles.subtitle}>
          Beats: {score}/{TOTAL_BEATS} • Mode: {beatMode} 🥁
        </Text>
        <Text style={styles.helper}>
          Listen to the drum beat and tap with it! Start slow, then tap fast.
        </Text>
      </View>

      <View style={styles.playArea}>
        <Pressable onPress={handleTap} style={styles.tapArea}>
          <Animated.View
            style={[
              styles.circleContainer,
              {
                transform: [
                  { scale: scaleAnim },
                  { scale: pulseAnim },
                ],
              },
            ]}
          >
            {/* Glow effect */}
            <Animated.View
              style={[
                styles.glowEffect,
                {
                  width: 200,
                  height: 200,
                  borderRadius: 100,
                  backgroundColor: glowColor,
                },
                glowStyle,
              ]}
            />

            {/* Main circle */}
            <View
              style={[
                styles.circle,
                {
                  width: 180,
                  height: 180,
                  borderRadius: 90,
                  backgroundColor: circleColor,
                },
              ]}
            >
              <View style={styles.circleInner} />
              {isLit && (
                <Text style={styles.tapText}>TAP!</Text>
              )}
            </View>
          </Animated.View>

          {/* Sparkle burst on tap */}
          {score > 0 && isLit && (
            <View style={styles.sparkleContainer} pointerEvents="none">
              <SparkleBurst />
            </View>
          )}
        </Pressable>
      </View>

      <View style={styles.footerBox}>
        <Text style={styles.footerMain}>
          Skills: rhythm entrainment • motor synchronization • music-motor integration
        </Text>
        <Text style={styles.footerSub}>
          Tap with the drum beat! This builds rhythm and motor coordination.
        </Text>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F0F9FF',
    paddingHorizontal: 16,
    paddingTop: 48,
  },
  backChip: {
    position: 'absolute',
    top: 50,
    left: 16,
    zIndex: 10,
    backgroundColor: '#0F172A',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  backChipText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
  headerBlock: {
    marginTop: 72,
    marginBottom: 16,
    alignItems: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 16,
    color: '#0F172A',
    marginBottom: 6,
  },
  helper: {
    fontSize: 14,
    color: '#475569',
    textAlign: 'center',
    paddingHorizontal: 18,
  },
  playArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  tapArea: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  circleContainer: {
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
  },
  glowEffect: {
    position: 'absolute',
    shadowColor: '#000',
    shadowOpacity: 0.6,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 0 },
    elevation: 10,
  },
  circle: {
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 15,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  circleInner: {
    width: '50%',
    height: '50%',
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
  },
  tapText: {
    position: 'absolute',
    fontSize: 24,
    fontWeight: '900',
    color: '#fff',
    textShadowColor: 'rgba(0, 0, 0, 0.3)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  sparkleContainer: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: [{ translateX: -20 }, { translateY: -20 }],
  },
  footerBox: {
    paddingVertical: 14,
    marginBottom: 20,
  },
  footerMain: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
    textAlign: 'center',
    marginBottom: 4,
  },
  footerSub: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
  },
  resultCard: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 24,
    backgroundColor: '#fff',
    padding: 24,
    alignItems: 'center',
    marginTop: 16,
  },
  resultTitle: {
    fontSize: 26,
    fontWeight: '900',
    color: '#0F172A',
    marginBottom: 8,
  },
  resultSubtitle: {
    fontSize: 16,
    color: '#475569',
    marginBottom: 8,
    textAlign: 'center',
  },
  savedText: {
    color: '#22C55E',
    fontWeight: '600',
    marginTop: 16,
    textAlign: 'center',
  },
});

export default TapWithSoundGame;


