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
    SafeAreaView,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
    Easing,
    runOnJS,
    useAnimatedStyle,
    useSharedValue,
    withSpring,
    withTiming,
} from 'react-native-reanimated';

const SUCCESS_SOUND = 'https://actions.google.com/sounds/v1/cartoon/balloon_pop.ogg';
const TOTAL_ROUNDS = 8;
const INITIAL_SIZE = 150;
const MIN_SIZE = 60;
const MAX_SIZE = 250;
const TARGET_SIZE = 120; // Target size to reach
const SIZE_TOLERANCE = 20; // Acceptable range around target

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

const PinchToResizeGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const playSuccess = useSoundEffect(SUCCESS_SOUND);

  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);
  const [showCongratulations, setShowCongratulations] = useState(false);
  const [roundActive, setRoundActive] = useState(false);
  const [lastResult, setLastResult] = useState<'hit' | null>(null);
  const [showFeedback, setShowFeedback] = useState(false);
  const [sparkleKey, setSparkleKey] = useState(0);
  const [sparkleX, setSparkleX] = useState(0);
  const [sparkleY, setSparkleY] = useState(0);
  const [currentTargetSize, setCurrentTargetSize] = useState(TARGET_SIZE);

  // Animation values
  const objectSize = useSharedValue(INITIAL_SIZE);
  const objectX = useSharedValue(50); // Center horizontally (%)
  const objectY = useSharedValue(50); // Center vertically (%)
  const objectScale = useSharedValue(1);
  const feedbackOpacity = useSharedValue(0);
  const baseScale = useSharedValue(1); // Base scale from pinch gesture
  const progressWidth = useSharedValue(0);
  const sizeIndicatorColor = useSharedValue(0); // 0 = red, 0.5 = yellow, 1 = green
  const ringScale = useSharedValue(1);

  const roundActiveRef = useRef(false);
  const roundRef = useRef(1);
  const scoreRef = useRef(0);
  const isTargetReachedRef = useRef(false);
  const checkIntervalRef = useRef<NodeJS.Timeout | null>(null);

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

    if (checkIntervalRef.current) {
      clearInterval(checkIntervalRef.current);
      checkIntervalRef.current = null;
    }

    const finalScore = scoreRef.current;
    const totalRounds = TOTAL_ROUNDS;
    const xp = Math.floor((finalScore / totalRounds) * 50);

    try {
      const timestamp = await recordGame({
        type: 'pinchToResize',
        score: finalScore,
        totalRounds,
        correct: finalScore,
        incorrect: totalRounds - finalScore,
      });

      await logGameAndAward({
        gameType: 'pinchToResize',
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

  // Check if target size is reached
  const checkTargetSize = useCallback(() => {
    if (!roundActiveRef.current || done || isTargetReachedRef.current) return;

    const currentSize = objectSize.value;
    const targetSize = currentTargetSize;
    const diff = Math.abs(currentSize - targetSize);

    if (diff <= SIZE_TOLERANCE) {
      isTargetReachedRef.current = true;
      runOnJS(handleSuccess)();
    }
  }, [done, currentTargetSize, objectSize]);

  // Handle successful target size
  const handleSuccess = useCallback(async () => {
    if (!roundActiveRef.current || done) return;

    setLastResult('hit');
    setShowFeedback(true);
    setRoundActive(false);
    roundActiveRef.current = false;
    setScore((s) => s + 1);

    if (checkIntervalRef.current) {
      clearInterval(checkIntervalRef.current);
      checkIntervalRef.current = null;
    }

    // Success animation
    objectScale.value = withSpring(1.2, { damping: 10, stiffness: 200 });
    feedbackOpacity.value = withTiming(1, { duration: 200 });

    setSparkleX(objectX.value);
    setSparkleY(objectY.value);
    setSparkleKey((k) => k + 1);

    try {
      await playSuccess();
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      speakTTS('Perfect size!', 0.78 );
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
  }, [done, objectScale, objectX, objectY, feedbackOpacity, playSuccess, endGame]);

  // Start a new round
  const startRound = useCallback(() => {
    if (done) return;

    setRoundActive(true);
    roundActiveRef.current = true;
    setLastResult(null);
    setShowFeedback(false);
    isTargetReachedRef.current = false;
    feedbackOpacity.value = 0;

    // Random target size (between min and max)
    const newTargetSize = MIN_SIZE + Math.random() * (MAX_SIZE - MIN_SIZE);
    setCurrentTargetSize(newTargetSize);

    // Reset object to random starting size
    const startSize = MIN_SIZE + Math.random() * (MAX_SIZE - MIN_SIZE);
    objectSize.value = startSize;
    objectScale.value = 1;
    baseScale.value = 1;

    // Start checking if target is reached
    if (checkIntervalRef.current) {
      clearInterval(checkIntervalRef.current);
    }
    checkIntervalRef.current = setInterval(() => {
      checkTargetSize();
    }, 100); // Check every 100ms
  }, [done, objectSize, objectScale, baseScale, feedbackOpacity, checkTargetSize]);

  // Pinch gesture (for resizing)
  const pinchGesture = Gesture.Pinch()
    .onUpdate((e) => {
      if (!roundActiveRef.current || done || isTargetReachedRef.current) return;
      
      // Update base scale
      baseScale.value = e.scale;

      // Calculate new size based on pinch scale
      // scale < 1 means pinching (shrinking), scale > 1 means spreading (growing)
      const newSize = INITIAL_SIZE * e.scale;
      const clampedSize = Math.max(MIN_SIZE, Math.min(MAX_SIZE, newSize));
      
      objectSize.value = clampedSize;
    })
    .onEnd(() => {
      if (!roundActiveRef.current || done || isTargetReachedRef.current) return;
      // Check if target is reached when gesture ends
      checkTargetSize();
    });

  // Start first round
  useEffect(() => {
    startRound();
    return () => {
      if (checkIntervalRef.current) {
        clearInterval(checkIntervalRef.current);
      }
    };
  }, []);

  // Progress animation
  useEffect(() => {
    progressWidth.value = withTiming((score / TOTAL_ROUNDS) * 100, { duration: 300 });
  }, [score, progressWidth]);

  // Update color based on size difference
  useEffect(() => {
    const checkColor = () => {
      if (!roundActiveRef.current || isTargetReachedRef.current) return;
      const currentSize = objectSize.value;
      const targetSize = currentTargetSize;
      const diff = Math.abs(currentSize - targetSize);
      const maxDiff = MAX_SIZE - MIN_SIZE;
      const progress = 1 - (diff / maxDiff);
      sizeIndicatorColor.value = withTiming(progress, { duration: 200 });
      
      // Pulse ring when close
      if (diff <= SIZE_TOLERANCE * 2) {
        ringScale.value = withSequence(
          withTiming(1.1, { duration: 300, easing: Easing.inOut(Easing.ease) }),
          withTiming(1, { duration: 300, easing: Easing.inOut(Easing.ease) })
        );
      }
    };
    
    if (roundActive) {
      const interval = setInterval(checkColor, 100);
      return () => clearInterval(interval);
    }
  }, [roundActive, currentTargetSize, sizeIndicatorColor, ringScale, objectSize]);

  // Animated styles
  const objectAnimatedStyle = useAnimatedStyle(() => {
    return {
      width: objectSize.value,
      height: objectSize.value,
      left: `${objectX.value}%`,
      top: `${objectY.value}%`,
      transform: [
        { translateX: -objectSize.value / 2 },
        { translateY: -objectSize.value / 2 },
        { scale: objectScale.value },
      ],
    };
  });

  const feedbackStyle = useAnimatedStyle(() => {
    return {
      opacity: feedbackOpacity.value,
    };
  });

  const progressStyle = useAnimatedStyle(() => {
    return {
      width: `${progressWidth.value}%`,
    };
  });

  const sizeIndicatorStyle = useAnimatedStyle(() => {
    const r = sizeIndicatorColor.value < 0.5 
      ? 255 
      : 255 - (sizeIndicatorColor.value - 0.5) * 255 * 2;
    const g = sizeIndicatorColor.value < 0.5
      ? sizeIndicatorColor.value * 255 * 2
      : 255;
    const b = 0;
    return {
      backgroundColor: `rgb(${r}, ${g}, ${b})`,
      transform: [{ scale: ringScale.value }],
    };
  });

  useEffect(() => {
    if (!done) {
      try {
        speakTTS('Pinch to resize the shape!', 0.78 );
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
        message="Resize Master!"
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
        colors={['#EDE9FE', '#DDD6FE', '#C4B5FD', '#A78BFA']}
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
        <Text style={styles.title}>🎈 Pinch to Resize 🎈</Text>
        <View style={styles.progressContainer}>
          <View style={styles.progressBar}>
            <Animated.View style={[styles.progressFill, progressStyle]} />
          </View>
          <Text style={styles.progressText}>{score}/{TOTAL_ROUNDS}</Text>
        </View>
        <Text style={styles.helper}>
          Pinch to shrink, spread to grow! Target: {Math.round(currentTargetSize)}px
        </Text>
      </View>

      {/* Play area */}
      <GestureDetector gesture={pinchGesture}>
        <View style={styles.playArea}>
          <LinearGradient
            colors={['#F5F3FF', '#EDE9FE', '#DDD6FE', '#C4B5FD']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFillObject}
          />
          
          {/* Target size indicator with color feedback */}
          <Animated.View style={[styles.targetIndicator, {
            width: currentTargetSize,
            height: currentTargetSize,
            left: '50%',
            top: '50%',
            marginLeft: -currentTargetSize / 2,
            marginTop: -currentTargetSize / 2,
          }, sizeIndicatorStyle]}>
            <Text style={styles.targetText}>Target</Text>
          </Animated.View>

          {/* Object */}
          <Animated.View
            style={[
              styles.object,
              objectAnimatedStyle,
            ]}
          >
            <LinearGradient
              colors={['#3B82F6', '#2563EB', '#1D4ED8']}
              style={styles.objectGradient}
            >
              <Text style={styles.objectEmoji}>🎈</Text>
            </LinearGradient>
          </Animated.View>

          {/* Feedback */}
          {showFeedback && lastResult && (
            <Animated.View style={[styles.feedbackContainer, feedbackStyle]}>
              <LinearGradient
                colors={['#22C55E', '#16A34A']}
                style={styles.feedbackGradient}
              >
                <Text style={styles.feedbackText}>
                  ✨ Perfect size! ✨
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
      </GestureDetector>
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
    color: '#1E40AF',
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
    color: '#1E40AF',
  },
  helper: {
    fontSize: 15,
    color: '#1E40AF',
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
    borderColor: '#A7F3D0',
  },
  targetIndicator: {
    position: 'absolute',
    borderWidth: 4,
    borderStyle: 'dashed',
    borderRadius: 1000,
    justifyContent: 'center',
    alignItems: 'center',
    opacity: 0.6,
    zIndex: 5,
  },
  targetText: {
    fontSize: 14,
    fontWeight: '900',
    color: '#FFFFFF',
    textShadowColor: 'rgba(0, 0, 0, 0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  object: {
    position: 'absolute',
    borderRadius: 1000,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
    shadowColor: '#3B82F6',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  objectGradient: {
    width: '100%',
    height: '100%',
    borderRadius: 1000,
    borderWidth: 4,
    borderColor: '#2563EB',
    justifyContent: 'center',
    alignItems: 'center',
  },
  objectEmoji: {
    fontSize: 60,
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
  scrollContent: {
    padding: 20,
  },
});

export default PinchToResizeGame;

