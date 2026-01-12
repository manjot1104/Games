import CongratulationsScreen from '@/components/game/CongratulationsScreen';
import { logGameAndAward, recordGame } from '@/utils/api';
import { cleanupSounds, stopAllSpeech } from '@/utils/soundPlayer';
import { Audio as ExpoAudio } from 'expo-av';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import * as Speech from 'expo-speech';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    Animated,
    Dimensions,
    Easing,
    Platform,
    Pressable,
    SafeAreaView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View
} from 'react-native';

const SUCCESS_SOUND = 'https://actions.google.com/sounds/v1/cartoon/balloon_pop.ogg';
const MISS_SOUND = 'https://actions.google.com/sounds/v1/cartoon/wood_plank_flicks.ogg';

const TOTAL_ROUNDS = 8;
const BALLOON_SIZE = 120;
const ROUND_DURATION_MS = 5000; // slow movement (5s)

const useSoundEffect = (uri: string) => {
  const soundRef = useRef<ExpoAudio.Sound | null>(null);

  const ensureSound = useCallback(async () => {
    if (soundRef.current) return;
    try {
      const { sound } = await ExpoAudio.Sound.createAsync(
        { uri },
        { volume: 0.6, shouldPlay: false },
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

const MovingTargetTapGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();

  const [round, setRound] = useState(1);
  const [hits, setHits] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);
  const [showCongratulations, setShowCongratulations] = useState(false);
  const [roundActive, setRoundActive] = useState(false);
  const [balloonPopped, setBalloonPopped] = useState(false);

  const xAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const currentAnimRef = useRef<Animated.CompositeAnimation | null>(null);
  const hitThisRoundRef = useRef(false);

  const playPop = useSoundEffect(SUCCESS_SOUND);
  const playMiss = useSoundEffect(MISS_SOUND);

  const startRound = useCallback(() => {
    const { width } = Dimensions.get('window');
    const startX = -BALLOON_SIZE;
    const endX = width - BALLOON_SIZE / 2;

    hitThisRoundRef.current = false;
    setRoundActive(true);
    setBalloonPopped(false);
    scaleAnim.setValue(1);

    xAnim.setValue(startX);

    const anim = Animated.timing(xAnim, {
      toValue: endX,
      duration: ROUND_DURATION_MS,
      easing: Easing.linear,
      useNativeDriver: true,
    });

    currentAnimRef.current = anim;

    anim.start(({ finished }) => {
      if (finished && !hitThisRoundRef.current) {
        // child didn’t tap in time – miss
        handleMiss();
      }
    });
  }, [xAnim, scaleAnim]);

  useEffect(() => {
    try {
      Speech.speak('Watch the slow balloon and tap it before it reaches the other side!', { rate: 0.78 });
    } catch {}
    startRound();
    return () => {
      currentAnimRef.current?.stop();
      // Cleanup: Stop speech when component unmounts
      try {
        Speech.stop();
      } catch (e) {
        // Ignore errors
      }
    };
  }, [startRound]);

  const endGame = useCallback(
    async (finalHits: number) => {
      const xp = finalHits * 15;
      const total = TOTAL_ROUNDS;
      const accuracy = (finalHits / total) * 100;

      const stats = { correct: finalHits, total, xp };
      
      // Set all states together (like CatchTheBouncingStar)
      setFinalStats(stats);
      setDone(true);
      setShowCongratulations(true);
      
      Speech.speak('Amazing work! You completed the game!', { rate: 0.78 });

      // Log game in background (don't wait for it)
      try {
        await recordGame(xp);
        const result = await logGameAndAward({
          type: 'movingTarget' as any,
          correct: finalHits,
          total,
          accuracy,
          xpAwarded: xp,
          skillTags: ['hand-eye', 'tracking-tap', 'timing-control'],
        });
        setLogTimestamp(result?.last?.at ?? null);
        router.setParams({ refreshStats: Date.now().toString() });
      } catch (e) {
        console.error('Failed to log moving target game:', e);
      }
    },
    [router],
  );

  const nextOrFinish = useCallback(
    (justHit: boolean) => {
      const nextRound = round + 1;
      if (nextRound > TOTAL_ROUNDS) {
        const finalHits = hits + (justHit ? 1 : 0);
        endGame(finalHits);
      } else {
        if (justHit) setHits((h) => h + 1);
        setRound(nextRound);
        setTimeout(() => {
          startRound();
        }, 600);
      }
    },
    [round, hits, startRound, endGame],
  );

  const handleHit = async () => {
    if (!roundActive || hitThisRoundRef.current || done) return;

    hitThisRoundRef.current = true;
    setRoundActive(false);
    setBalloonPopped(true);

    currentAnimRef.current?.stop();

    // pop animation
    Animated.sequence([
      Animated.timing(scaleAnim, {
        toValue: 1.2,
        duration: 120,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
      Animated.timing(scaleAnim, {
        toValue: 0,
        duration: 160,
        easing: Easing.in(Easing.ease),
        useNativeDriver: true,
      }),
    ]).start();

    try {
      await playPop();
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {}

    nextOrFinish(true);
  };

  const handleMiss = async () => {
    if (hitThisRoundRef.current || done) return;
    setRoundActive(false);

    Animated.sequence([
      Animated.timing(scaleAnim, {
        toValue: 0.9,
        duration: 120,
        useNativeDriver: true,
      }),
      Animated.timing(scaleAnim, {
        toValue: 1,
        duration: 160,
        useNativeDriver: true,
      }),
    ]).start();

    try {
      await playMiss();
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    } catch {}

    nextOrFinish(false);
  };

  const handleBack = useCallback(() => {
    stopAllSpeech();
    cleanupSounds();
    onBack?.();
  }, [onBack]);

  // ---------- Congratulations screen FIRST (like CatchTheBouncingStar) ----------
  // This is the ONLY completion screen - no ResultCard needed for OT games
  if (showCongratulations && done && finalStats) {
    return (
      <CongratulationsScreen
        message="Great Tracking!"
        showButtons={true}
        onContinue={() => {
          // Continue - go back to games (no ResultCard screen needed)
          stopAllSpeech();
          cleanupSounds();
          onBack?.();
        }}
        onHome={() => {
          stopAllSpeech();
          cleanupSounds();
          onBack?.();
        }}
      />
    );
  }

  // Prevent any rendering when game is done but congratulations hasn't shown yet
  if (done && finalStats && !showCongratulations) {
    return null; // Wait for showCongratulations to be set
  }

  const balloonStyle = {
    transform: [
      { translateX: xAnim },
      { scale: scaleAnim },
    ],
  };

  return (
    <SafeAreaView style={styles.container}>
      <LinearGradient
        colors={['#FEF3C7', '#FDE68A', '#FCD34D']}
        style={StyleSheet.absoluteFillObject}
      />
      <TouchableOpacity
        onPress={handleBack}
        style={styles.backChip}
      >
        <LinearGradient
          colors={['#1E293B', '#0F172A']}
          style={styles.backChipGradient}
        >
          <Text style={styles.backChipText}>← Back</Text>
        </LinearGradient>
      </TouchableOpacity>

      <View style={styles.headerBlock}>
        <Text style={styles.title}>🎈 Moving Balloon Tap 🎈</Text>
        <View style={styles.statsRow}>
          <View style={styles.statBadge}>
            <Text style={styles.statLabel}>Round</Text>
            <Text style={styles.statValue}>{round}/{TOTAL_ROUNDS}</Text>
          </View>
          <View style={[styles.statBadge, styles.hitBadge]}>
            <Text style={styles.statLabel}>🎯 Hits</Text>
            <Text style={styles.statValue}>{hits}</Text>
          </View>
        </View>
        <Text style={styles.helper}>
          Watch the slow balloon and tap it before it reaches the other side! ✨
        </Text>
      </View>

      <View style={styles.playArea}>
        <LinearGradient
          colors={['#F0FDF4', '#DCFCE7', '#BBF7D0']}
          style={StyleSheet.absoluteFillObject}
        />
        <Animated.View style={[styles.balloonWrapper, balloonStyle]}>
          <Pressable
            onPress={handleHit}
            style={styles.balloonHitArea}
          >
            <LinearGradient
              colors={['#F97316', '#EA580C', '#DC2626']}
              style={styles.balloon}
            >
              <Text style={{ fontSize: 52 }}>🎈</Text>
              <View style={styles.balloonGlow} />
            </LinearGradient>
          </Pressable>
        </Animated.View>
      </View>

      <View style={styles.footerBox}>
        <LinearGradient
          colors={['#FFFFFF', '#FEF3C7']}
          style={styles.footerGradient}
        >
          <Text style={styles.footerMain}>
            Skills: hand–eye coordination • tracking + tapping • timing control
          </Text>
          <Text style={styles.footerSub}>
            Let the child visually follow the moving balloon and tap when ready.
          </Text>
        </LinearGradient>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ECFEFF',
    paddingHorizontal: 16,
    paddingTop: 48,
  },
  backChip: {
    position: 'absolute',
    top: 50,
    left: 16,
    zIndex: 10,
    borderRadius: 20,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },
  backChipGradient: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  backChipText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
  backButton: {
    position: 'absolute',
    top: 50,
    left: 16,
    zIndex: 100,
    borderRadius: 20,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  backButtonGradient: {
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  backButtonText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 16,
    letterSpacing: 0.5,
  },
  headerBlock: {
    marginTop: 72,
    marginBottom: 16,
    alignItems: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: '900',
    color: '#78350F',
    marginBottom: 12,
    textShadowColor: 'rgba(255, 255, 255, 0.8)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  statBadge: {
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  hitBadge: {
    backgroundColor: '#FEF3C7',
  },
  statLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748B',
    marginBottom: 4,
  },
  statValue: {
    fontSize: 20,
    fontWeight: '900',
    color: '#0F172A',
  },
  subtitle: {
    fontSize: 16,
    color: '#0F172A',
    marginBottom: 6,
  },
  helper: {
    fontSize: 15,
    color: '#92400E',
    textAlign: 'center',
    paddingHorizontal: 18,
    fontWeight: '600',
  },
  playArea: {
    flex: 1,
    justifyContent: 'center',
    borderRadius: 24,
    overflow: 'hidden',
    marginHorizontal: 8,
    borderWidth: 3,
    borderColor: '#A7F3D0',
  },
  balloonWrapper: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    justifyContent: 'center',
  },
  balloonHitArea: {
    padding: 12,
  },
  balloon: {
    width: BALLOON_SIZE,
    height: BALLOON_SIZE,
    borderRadius: BALLOON_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#F97316',
    shadowOpacity: 0.5,
    shadowRadius: 25,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },
  balloonGlow: {
    position: 'absolute',
    width: '40%',
    height: '40%',
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.5)',
    top: '20%',
    left: '30%',
  },
  footerBox: {
    marginBottom: 20,
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },
  footerGradient: {
    paddingVertical: 16,
    paddingHorizontal: 20,
  },
  footerMain: {
    fontSize: 15,
    fontWeight: '800',
    color: '#78350F',
    textAlign: 'center',
    marginBottom: 6,
  },
  footerSub: {
    fontSize: 13,
    color: '#92400E',
    textAlign: 'center',
    fontWeight: '500',
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
    marginBottom: 16,
    textAlign: 'center',
  },
  savedText: {
    color: '#22C55E',
    fontWeight: '600',
    marginTop: 16,
    textAlign: 'center',
  },
});

export default MovingTargetTapGame;
