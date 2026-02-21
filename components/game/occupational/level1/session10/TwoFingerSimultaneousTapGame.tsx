import CongratulationsScreen from '@/components/game/CongratulationsScreen';
import { SparkleBurst } from '@/components/game/FX';
import { logGameAndAward, recordGame } from '@/utils/api';
import { cleanupSounds, stopAllSpeech } from '@/utils/soundPlayer';
import { Audio as ExpoAudio } from 'expo-av';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { speak as speakTTS, DEFAULT_TTS_RATE, stopTTS } from '@/utils/tts';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    Platform,
    Pressable,
    SafeAreaView,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import Animated, {
    Easing,
    runOnJS,
    useAnimatedStyle,
    useSharedValue,
    withSequence,
    withSpring,
    withTiming,
} from 'react-native-reanimated';

const SUCCESS_SOUND = 'https://actions.google.com/sounds/v1/cartoon/balloon_pop.ogg';
const ERROR_SOUND = 'https://actions.google.com/sounds/v1/cartoon/wood_plank_flicks.ogg';
const TOTAL_ROUNDS = 8;
const TARGET_SIZE = 120;
const MAX_TAP_DELAY = 400; // Maximum time between taps (ms) - increased for better detection

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

const TwoFingerSimultaneousTapGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const playSuccess = useSoundEffect(SUCCESS_SOUND);
  const playError = useSoundEffect(ERROR_SOUND);

  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);
  const [showCongratulations, setShowCongratulations] = useState(false);
  const [roundActive, setRoundActive] = useState(false);
  const [lastResult, setLastResult] = useState<'hit' | 'miss' | null>(null);
  const [showFeedback, setShowFeedback] = useState(false);
  const [sparkleKey, setSparkleKey] = useState(0);
  const [sparkleX, setSparkleX] = useState(0);
  const [sparkleY, setSparkleY] = useState(0);

  // Animation values
  const target1X = useSharedValue(30); // Left target (%)
  const target1Y = useSharedValue(50); // Center vertically (%)
  const target1Scale = useSharedValue(1);
  const target1Opacity = useSharedValue(1);
  const target2X = useSharedValue(70); // Right target (%)
  const target2Y = useSharedValue(50); // Center vertically (%)
  const target2Scale = useSharedValue(1);
  const target2Opacity = useSharedValue(1);
  const feedbackOpacity = useSharedValue(0);
  const target1Pulse = useSharedValue(1);
  const target2Pulse = useSharedValue(1);
  const connectionOpacity = useSharedValue(0.3);
  const progressWidth = useSharedValue(0);

  const roundActiveRef = useRef(false);
  const roundRef = useRef(1);
  const scoreRef = useRef(0);
  const firstTapTimeRef = useRef<number | null>(null);
  const firstTapTargetRef = useRef<'left' | 'right' | null>(null);
  const tapTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Keep refs in sync
  useEffect(() => {
    roundRef.current = round;
    scoreRef.current = score;
  }, [round, score]);

  // End game function
  const endGame = useCallback(async () => {
    if (done) return;
    setDone(true);
    setRoundActive(false);
    roundActiveRef.current = false;

    const finalScore = scoreRef.current;
    const totalRounds = TOTAL_ROUNDS;
    const xp = Math.floor((finalScore / totalRounds) * 50);

    try {
      const timestamp = await recordGame({
        type: 'twoFingerSimultaneousTap',
        score: finalScore,
        totalRounds,
        correct: finalScore,
        incorrect: totalRounds - finalScore,
      });

      await logGameAndAward({
        gameType: 'twoFingerSimultaneousTap',
        score: finalScore,
        totalRounds,
        correct: finalScore,
        incorrect: totalRounds - finalScore,
        xp,
      });

      setFinalStats({
        correct: finalScore,
        total: totalRounds,
        xp,
      });
      setLogTimestamp(timestamp);
      setShowCongratulations(true);
      speakTTS('Amazing work! You completed the game!', 0.78);
    } catch (error) {
      console.error('Failed to save game result:', error);
      // Still show congratulations even if logging fails
      setShowCongratulations(true);
      speakTTS('Amazing work! You completed the game!', 0.78);
    }
  }, [done]);

  // Handle wrong timing (taps too far apart)
  const handleWrongTiming = useCallback(async () => {
    if (!roundActiveRef.current || done) return;

    setLastResult('miss');
    setShowFeedback(true);
    feedbackOpacity.value = withTiming(1, { duration: 200 });

    // Shake both targets
    target1Scale.value = withSequence(
      withTiming(0.9, { duration: 100, easing: Easing.out(Easing.ease) }),
      withTiming(1.1, { duration: 100, easing: Easing.inOut(Easing.ease) }),
      withTiming(1, { duration: 100, easing: Easing.in(Easing.ease) })
    );
    target2Scale.value = withSequence(
      withTiming(0.9, { duration: 100, easing: Easing.out(Easing.ease) }),
      withTiming(1.1, { duration: 100, easing: Easing.inOut(Easing.ease) }),
      withTiming(1, { duration: 100, easing: Easing.in(Easing.ease) })
    );

    try {
      await playError();
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      speakTTS('Try together!', 0.78 );
    } catch {}

    setTimeout(() => {
      setShowFeedback(false);
      feedbackOpacity.value = 0;
      // Reset tap tracking
      firstTapTimeRef.current = null;
      firstTapTargetRef.current = null;
      if (tapTimeoutRef.current) {
        clearTimeout(tapTimeoutRef.current);
        tapTimeoutRef.current = null;
      }
    }, 2000);
  }, [done, target1Scale, target2Scale, feedbackOpacity, playError]);

  // Handle successful simultaneous tap
  const handleSuccess = useCallback(async () => {
    if (!roundActiveRef.current || done) return;

    setLastResult('hit');
    setShowFeedback(true);
    setRoundActive(false);
    roundActiveRef.current = false;
    setScore((s) => s + 1);

    // Pop animation for both targets
    target1Scale.value = withSequence(
      withSpring(1.3, { damping: 10, stiffness: 200 }),
      withTiming(0, { duration: 200, easing: Easing.in(Easing.ease) })
    );
    target1Opacity.value = withTiming(0, { duration: 200 });
    target2Scale.value = withSequence(
      withSpring(1.3, { damping: 10, stiffness: 200 }),
      withTiming(0, { duration: 200, easing: Easing.in(Easing.ease) })
    );
    target2Opacity.value = withTiming(0, { duration: 200 });

    feedbackOpacity.value = withTiming(1, { duration: 200 });

    setSparkleX(50);
    setSparkleY(50);
    setSparkleKey((k) => k + 1);

    // Reset tap tracking
    firstTapTimeRef.current = null;
    firstTapTargetRef.current = null;
    if (tapTimeoutRef.current) {
      clearTimeout(tapTimeoutRef.current);
      tapTimeoutRef.current = null;
    }

    try {
      await playSuccess();
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      speakTTS('Perfect!', 0.78 );
    } catch {}

    if (roundRef.current >= TOTAL_ROUNDS) {
      setTimeout(() => {
        endGame();
      }, 1500);
    } else {
      setTimeout(() => {
        setShowFeedback(false);
        feedbackOpacity.value = 0;
        setRound((r) => r + 1);
        setTimeout(() => {
          startRound();
        }, 500);
      }, 1500);
    }
  }, [done, target1Scale, target1Opacity, target2Scale, target2Opacity, feedbackOpacity, playSuccess, endGame]);

  // Handle tap on target
  const handleTargetTap = useCallback((target: 'left' | 'right') => {
    if (!roundActiveRef.current || done) return;

    const now = Date.now();
    const firstTapTime = firstTapTimeRef.current;
    const firstTapTarget = firstTapTargetRef.current;

    // Check if this is truly simultaneous (within 50ms) - handle race condition
    if (firstTapTime !== null && now - firstTapTime < 50) {
      // Very close taps - check if they're on different targets
      if (firstTapTarget !== target) {
        // Success! Both taps happened almost simultaneously on different targets
        if (tapTimeoutRef.current) {
          clearTimeout(tapTimeoutRef.current);
          tapTimeoutRef.current = null;
        }
        runOnJS(handleSuccess)();
        return;
      }
    }

    if (firstTapTime === null) {
      // First tap
      firstTapTimeRef.current = now;
      firstTapTargetRef.current = target;

      // Set timeout - if second tap doesn't come in time, it's wrong
      tapTimeoutRef.current = setTimeout(() => {
        runOnJS(handleWrongTiming)();
      }, MAX_TAP_DELAY);
    } else {
      // Second tap
      const timeDiff = now - firstTapTime;

      if (tapTimeoutRef.current) {
        clearTimeout(tapTimeoutRef.current);
        tapTimeoutRef.current = null;
      }

      // Check if taps are on different targets and within time limit
      if (
        firstTapTarget !== target &&
        timeDiff <= MAX_TAP_DELAY
      ) {
        // Success!
        runOnJS(handleSuccess)();
      } else {
        // Wrong timing or same target
        runOnJS(handleWrongTiming)();
      }
    }
  }, [done, handleSuccess, handleWrongTiming]);

  // Start a new round
  const startRound = useCallback(() => {
    if (done) return;

    setRoundActive(true);
    roundActiveRef.current = true;
    setLastResult(null);
    setShowFeedback(false);
    feedbackOpacity.value = 0;

    // Reset targets
    target1Scale.value = 1;
    target1Opacity.value = 1;
    target2Scale.value = 1;
    target2Opacity.value = 1;

    // Reset tap tracking
    firstTapTimeRef.current = null;
    firstTapTargetRef.current = null;
    if (tapTimeoutRef.current) {
      clearTimeout(tapTimeoutRef.current);
      tapTimeoutRef.current = null;
    }
  }, [done, target1Scale, target1Opacity, target2Scale, target2Opacity, feedbackOpacity]);

  // Start first round
  useEffect(() => {
    startRound();
    return () => {
      if (tapTimeoutRef.current) {
        clearTimeout(tapTimeoutRef.current);
      }
    };
  }, []);

  // Pulsing animation for targets
  useEffect(() => {
    if (roundActive) {
      target1Pulse.value = withSequence(
        withTiming(1.1, { duration: 800, easing: Easing.inOut(Easing.ease) }),
        withTiming(1, { duration: 800, easing: Easing.inOut(Easing.ease) })
      );
      target2Pulse.value = withSequence(
        withTiming(1.1, { duration: 800, easing: Easing.inOut(Easing.ease) }),
        withTiming(1, { duration: 800, easing: Easing.inOut(Easing.ease) })
      );
      const interval = setInterval(() => {
        if (roundActiveRef.current) {
          target1Pulse.value = withSequence(
            withTiming(1.1, { duration: 800, easing: Easing.inOut(Easing.ease) }),
            withTiming(1, { duration: 800, easing: Easing.inOut(Easing.ease) })
          );
          target2Pulse.value = withSequence(
            withTiming(1.1, { duration: 800, easing: Easing.inOut(Easing.ease) }),
            withTiming(1, { duration: 800, easing: Easing.inOut(Easing.ease) })
          );
        }
      }, 1600);
      return () => clearInterval(interval);
    }
  }, [roundActive, target1Pulse, target2Pulse]);

  // Progress animation
  useEffect(() => {
    progressWidth.value = withTiming((score / TOTAL_ROUNDS) * 100, { duration: 300 });
  }, [score, progressWidth]);

  // Animated styles
  const target1AnimatedStyle = useAnimatedStyle(() => {
    return {
      width: TARGET_SIZE,
      height: TARGET_SIZE,
      left: `${target1X.value}%`,
      top: `${target1Y.value}%`,
      transform: [
        { translateX: -TARGET_SIZE / 2 },
        { translateY: -TARGET_SIZE / 2 },
        { scale: target1Scale.value * target1Pulse.value },
      ],
      opacity: target1Opacity.value,
    };
  });

  const target2AnimatedStyle = useAnimatedStyle(() => {
    return {
      width: TARGET_SIZE,
      height: TARGET_SIZE,
      left: `${target2X.value}%`,
      top: `${target2Y.value}%`,
      transform: [
        { translateX: -TARGET_SIZE / 2 },
        { translateY: -TARGET_SIZE / 2 },
        { scale: target2Scale.value * target2Pulse.value },
      ],
      opacity: target2Opacity.value,
    };
  });

  const connectionStyle = useAnimatedStyle(() => {
    const distance = Math.abs(target2X.value - target1X.value);
    const angle = Math.atan2(
      target2Y.value - target1Y.value,
      target2X.value - target1X.value
    ) * (180 / Math.PI);
    return {
      opacity: connectionOpacity.value,
      width: distance,
      left: `${target1X.value}%`,
      top: `${target1Y.value}%`,
      transform: [
        { translateX: -TARGET_SIZE / 2 },
        { translateY: -TARGET_SIZE / 2 },
        { rotate: `${angle}deg` },
      ],
    };
  });

  const progressStyle = useAnimatedStyle(() => {
    return {
      width: `${progressWidth.value}%`,
    };
  });

  const feedbackStyle = useAnimatedStyle(() => {
    return {
      opacity: feedbackOpacity.value,
    };
  });

  useEffect(() => {
    if (!done) {
      try {
        speakTTS('Tap both targets at the same time with two fingers!', 0.78 );
      } catch {}
    }
    return () => {
      stopAllSpeech();
      cleanupSounds();
    };
  }, []);

  const handleBack = useCallback(() => {
    stopAllSpeech();
    cleanupSounds();
    if (onBack) {
      onBack();
    } else {
      // Safe fallback: try to go back, but catch errors
      try {
        if (router.canGoBack()) {
          router.back();
        } else {
          router.replace('/(tabs)/Games');
        }
      } catch (error) {
        try {
          router.replace('/(tabs)/Games');
        } catch (e) {
          console.warn('Navigation error:', e);
        }
      }
    }
  }, [onBack, router]);

  // ---------- Congratulations screen FIRST (like CatchTheBouncingStar) ----------
  // This is the ONLY completion screen - no ResultCard needed for OT games
  if (showCongratulations && done && finalStats) {
    return (
      <CongratulationsScreen
        message="Coordination Master!"
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

  return (
    <SafeAreaView style={styles.container}>
      <LinearGradient
        colors={['#FEF9C3', '#FEF08A', '#FDE047', '#FACC15']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />
      <TouchableOpacity onPress={handleBack} style={styles.backChip}>
        <LinearGradient
          colors={['#1E293B', '#0F172A']}
          style={styles.backChipGradient}
        >
          <Text style={styles.backChipText}>← Back</Text>
        </LinearGradient>
      </TouchableOpacity>

      <View style={styles.headerBlock}>
        <Text style={styles.title}>⭐ Two-Finger Tap ⭐</Text>
        <View style={styles.progressContainer}>
          <View style={styles.progressBar}>
            <Animated.View style={[styles.progressFill, progressStyle]} />
          </View>
          <Text style={styles.progressText}>{score}/{TOTAL_ROUNDS}</Text>
        </View>
        <Text style={styles.helper}>
          Tap both targets at the same time!
        </Text>
      </View>

      {/* Play area */}
      <View style={styles.playArea}>
        <LinearGradient
          colors={['#FFFBEB', '#FEF3C7', '#FDE68A', '#FCD34D']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFillObject}
        />
        
        {/* Connection line */}
        <Animated.View style={[styles.connectionLine, connectionStyle]} />
        {/* Left target */}
        <Pressable
          onPress={() => handleTargetTap('left')}
          disabled={!roundActive || done}
          style={styles.targetPressable}
        >
          <Animated.View style={[styles.target, target1AnimatedStyle]}>
            <LinearGradient
              colors={['#FCD34D', '#F59E0B', '#D97706']}
              style={styles.targetGradient}
            >
              <Text style={styles.targetEmoji}>⭐</Text>
            </LinearGradient>
          </Animated.View>
        </Pressable>

        {/* Right target */}
        <Pressable
          onPress={() => handleTargetTap('right')}
          disabled={!roundActive || done}
          style={styles.targetPressable}
        >
          <Animated.View style={[styles.target, target2AnimatedStyle]}>
            <LinearGradient
              colors={['#FCD34D', '#F59E0B', '#D97706']}
              style={styles.targetGradient}
            >
              <Text style={styles.targetEmoji}>⭐</Text>
            </LinearGradient>
          </Animated.View>
        </Pressable>

          {/* Feedback */}
          {showFeedback && lastResult && (
            <Animated.View style={[styles.feedbackContainer, feedbackStyle]}>
              <LinearGradient
                colors={lastResult === 'hit' 
                  ? ['#22C55E', '#16A34A'] 
                  : ['#EF4444', '#DC2626']}
                style={styles.feedbackGradient}
              >
                <Text style={styles.feedbackText}>
                  {lastResult === 'hit' ? '✨ Perfect! ✨' : '👆 Try together!'}
                </Text>
              </LinearGradient>
            </Animated.View>
          )}

        {/* Sparkle effect */}
        {sparkleKey > 0 && (
          <SparkleBurst
            key={sparkleKey}
            x={sparkleX}
            y={sparkleY}
          />
        )}
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  backChip: {
    alignSelf: 'flex-start',
    margin: 16,
    borderRadius: 20,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  backChipGradient: {
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  backChipText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1E293B',
  },
  headerBlock: {
    padding: 20,
    alignItems: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: '900',
    color: '#78350F',
    marginBottom: 16,
    textShadowColor: 'rgba(255, 255, 255, 0.8)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  progressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  progressBar: {
    width: 200,
    height: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.5)',
    borderRadius: 6,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#22C55E',
    borderRadius: 6,
  },
  progressText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#78350F',
  },
  helper: {
    fontSize: 15,
    color: '#92400E',
    textAlign: 'center',
    fontWeight: '600',
  },
  playArea: {
    flex: 1,
    position: 'relative',
    margin: 20,
    borderRadius: 24,
    overflow: 'hidden',
    borderWidth: 3,
    borderColor: '#FCD34D',
  },
  connectionLine: {
    position: 'absolute',
    height: 3,
    backgroundColor: '#F59E0B',
    borderRadius: 2,
    zIndex: 1,
  },
  targetPressable: {
    position: 'absolute',
    width: '100%',
    height: '100%',
  },
  target: {
    position: 'absolute',
    borderRadius: 1000,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#FCD34D',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  targetGradient: {
    width: '100%',
    height: '100%',
    borderRadius: 1000,
    borderWidth: 4,
    borderColor: '#F59E0B',
    justifyContent: 'center',
    alignItems: 'center',
  },
  targetEmoji: {
    fontSize: 50,
  },
  feedbackContainer: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: [{ translateX: -100 }, { translateY: -20 }],
    borderRadius: 20,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
    zIndex: 20,
  },
  feedbackGradient: {
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  feedbackText: {
    fontSize: 20,
    fontWeight: '900',
    textAlign: 'center',
    color: '#FFFFFF',
  },
  feedbackSuccess: {
    color: '#22C55E',
  },
  feedbackError: {
    color: '#EF4444',
  },
  scrollContent: {
    padding: 20,
  },
});

export default TwoFingerSimultaneousTapGame;

