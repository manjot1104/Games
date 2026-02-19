import { SparkleBurst } from '@/components/game/FX';
import ResultCard from '@/components/game/ResultCard';
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
    withSequence,
    withSpring,
    withTiming,
} from 'react-native-reanimated';

const SUCCESS_SOUND = 'https://actions.google.com/sounds/v1/cartoon/balloon_pop.ogg';
const ERROR_SOUND = 'https://actions.google.com/sounds/v1/cartoon/wood_plank_flicks.ogg';
const TOTAL_ROUNDS = 8;
const OBJECT_SIZE = 80;
const GOAL_SIZE = 120;
const GOAL_TOLERANCE = 50; // Distance from goal center to consider success
const PINCH_THRESHOLD = 0.2; // Minimum pinch scale to activate drag

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

const PinchAndDragGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const playSuccess = useSoundEffect(SUCCESS_SOUND);
  const playError = useSoundEffect(ERROR_SOUND);

  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);
  const [roundActive, setRoundActive] = useState(false);
  const [lastResult, setLastResult] = useState<'hit' | 'miss' | null>(null);
  const [showFeedback, setShowFeedback] = useState(false);
  const [sparkleKey, setSparkleKey] = useState(0);
  const [sparkleX, setSparkleX] = useState(0);
  const [sparkleY, setSparkleY] = useState(0);
  const [isPinching, setIsPinching] = useState(false);

  // Animation values
  const objectX = useSharedValue(50); // Center horizontally (%)
  const objectY = useSharedValue(50); // Center vertically (%)
  const objectScale = useSharedValue(1);
  const objectOpacity = useSharedValue(1);
  const goalX = useSharedValue(80); // Goal position (%)
  const goalY = useSharedValue(30); // Goal position (%)
  const feedbackOpacity = useSharedValue(0);
  const startX = useSharedValue(50);
  const startY = useSharedValue(50);
  const goalPulse = useSharedValue(1);
  const trailOpacity = useSharedValue(0);
  const progressWidth = useSharedValue(0);

  const roundActiveRef = useRef(false);
  const roundRef = useRef(1);
  const scoreRef = useRef(0);
  const isPinchingRef = useRef(false);
  const isDroppedRef = useRef(false);

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
        type: 'pinchAndDrag',
        score: finalScore,
        totalRounds,
        correct: finalScore,
        incorrect: totalRounds - finalScore,
      });

      await logGameAndAward({
        gameType: 'pinchAndDrag',
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
    } catch (error) {
      console.error('Failed to save game result:', error);
    }
  }, [done]);

  // Handle early release (drop before goal)
  const handleEarlyRelease = useCallback(async () => {
    if (!roundActiveRef.current || done || isDroppedRef.current) return;

    isDroppedRef.current = true;
    setLastResult('miss');
    setShowFeedback(true);
    setRoundActive(false);
    roundActiveRef.current = false;
    setIsPinching(false);
    isPinchingRef.current = false;

    // Return object to start
    objectX.value = withSpring(startX.value, { damping: 10, stiffness: 200 });
    objectY.value = withSpring(startY.value, { damping: 10, stiffness: 200 });
    objectScale.value = withSpring(1, { damping: 10, stiffness: 200 });

    feedbackOpacity.value = withTiming(1, { duration: 200 });

    try {
      await playError();
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      speakTTS('Keep pinching!', 0.78 );
    } catch {}

    setTimeout(() => {
      setShowFeedback(false);
      feedbackOpacity.value = 0;
      setTimeout(() => {
        startRound();
      }, 500);
    }, 2000);
  }, [done, objectX, objectY, objectScale, startX, startY, feedbackOpacity, playError]);

  // Handle successful drop in goal
  const handleSuccess = useCallback(async () => {
    if (!roundActiveRef.current || done || isDroppedRef.current) return;

    isDroppedRef.current = true;
    setLastResult('hit');
    setShowFeedback(true);
    setRoundActive(false);
    roundActiveRef.current = false;
    setIsPinching(false);
    isPinchingRef.current = false;
    setScore((s) => s + 1);

    // Success animation
    objectScale.value = withSpring(1.3, { damping: 10, stiffness: 200 });
    feedbackOpacity.value = withTiming(1, { duration: 200 });

    setSparkleX(goalX.value);
    setSparkleY(goalY.value);
    setSparkleKey((k) => k + 1);

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
  }, [done, objectScale, goalX, goalY, feedbackOpacity, playSuccess, endGame]);

  // Start a new round
  const startRound = useCallback(() => {
    if (done) return;

    setRoundActive(true);
    roundActiveRef.current = true;
    setLastResult(null);
    setShowFeedback(false);
    setIsPinching(false);
    isPinchingRef.current = false;
    isDroppedRef.current = false;
    feedbackOpacity.value = 0;

    // Random start position
    const margin = 15;
    startX.value = margin + Math.random() * (100 - margin * 2);
    startY.value = 60 + Math.random() * 30; // Lower half of screen

    // Random goal position (different from start)
    let goalXVal = margin + Math.random() * (100 - margin * 2);
    let goalYVal = 10 + Math.random() * 40; // Upper half of screen
    
    // Ensure goal is far enough from start
    let attempts = 0;
    while (attempts < 20 && Math.abs(goalXVal - startX.value) < 30) {
      goalXVal = margin + Math.random() * (100 - margin * 2);
      attempts++;
    }

    goalX.value = goalXVal;
    goalY.value = goalYVal;

    // Reset object
    objectX.value = startX.value;
    objectY.value = startY.value;
    objectScale.value = 1;
    objectOpacity.value = 1;
  }, [done, startX, startY, objectX, objectY, objectScale, objectOpacity, goalX, goalY, feedbackOpacity]);

  // Pinch gesture (for activating drag)
  const pinchGesture = Gesture.Pinch()
    .onStart(() => {
      if (!roundActiveRef.current || done || isDroppedRef.current) return;
      runOnJS(setIsPinching)(true);
      isPinchingRef.current = true;
      objectScale.value = withSpring(0.9, { damping: 10, stiffness: 200 });
    })
    .onUpdate((e) => {
      if (!roundActiveRef.current || done || isDroppedRef.current) return;
      
      // Only allow drag if pinched enough
      if (e.scale < (1 - PINCH_THRESHOLD)) {
        // Update object position based on focal point (center of pinch)
        if (e.focalX && e.focalY) {
          const newX = (e.focalX / e.width) * 100;
          const newY = (e.focalY / e.height) * 100;
          objectX.value = Math.max(5, Math.min(95, newX));
          objectY.value = Math.max(5, Math.min(95, newY));
          trailOpacity.value = 0.6;
        }
      } else {
        trailOpacity.value = 0;
      }
    })
    .onEnd(() => {
      if (!roundActiveRef.current || done || isDroppedRef.current) return;
      
      runOnJS(setIsPinching)(false);
      isPinchingRef.current = false;
      objectScale.value = withSpring(1, { damping: 10, stiffness: 200 });

      // Check if dropped in goal
      const distance = Math.sqrt(
        Math.pow(objectX.value - goalX.value, 2) + Math.pow(objectY.value - goalY.value, 2)
      );

      if (distance <= GOAL_TOLERANCE) {
        runOnJS(handleSuccess)();
      } else {
        runOnJS(handleEarlyRelease)();
      }
    });

  // Set ref after startRound is defined
  useEffect(() => {
    // startRound will be set via ref if needed
  }, [startRound]);

  // Start first round
  useEffect(() => {
    startRound();
  }, []);

  // Goal pulsing animation
  useEffect(() => {
    if (roundActive) {
      goalPulse.value = withSequence(
        withTiming(1.1, { duration: 1000, easing: Easing.inOut(Easing.ease) }),
        withTiming(1, { duration: 1000, easing: Easing.inOut(Easing.ease) })
      );
      const interval = setInterval(() => {
        if (roundActiveRef.current) {
          goalPulse.value = withSequence(
            withTiming(1.1, { duration: 1000, easing: Easing.inOut(Easing.ease) }),
            withTiming(1, { duration: 1000, easing: Easing.inOut(Easing.ease) })
          );
        }
      }, 2000);
      return () => clearInterval(interval);
    }
  }, [roundActive, goalPulse]);

  // Progress animation
  useEffect(() => {
    progressWidth.value = withTiming((score / TOTAL_ROUNDS) * 100, { duration: 300 });
  }, [score, progressWidth]);

  // Animated styles
  const objectAnimatedStyle = useAnimatedStyle(() => {
    return {
      width: OBJECT_SIZE,
      height: OBJECT_SIZE,
      left: `${objectX.value}%`,
      top: `${objectY.value}%`,
      transform: [
        { translateX: -OBJECT_SIZE / 2 },
        { translateY: -OBJECT_SIZE / 2 },
        { scale: objectScale.value },
      ],
      opacity: objectOpacity.value,
    };
  });

  const goalAnimatedStyle = useAnimatedStyle(() => {
    return {
      width: GOAL_SIZE,
      height: GOAL_SIZE,
      left: `${goalX.value}%`,
      top: `${goalY.value}%`,
      transform: [
        { translateX: -GOAL_SIZE / 2 },
        { translateY: -GOAL_SIZE / 2 },
        { scale: goalPulse.value },
      ],
    };
  });

  const trailStyle = useAnimatedStyle(() => {
    const distance = Math.sqrt(
      Math.pow(objectX.value - startX.value, 2) + Math.pow(objectY.value - startY.value, 2)
    );
    const angle = Math.atan2(
      objectY.value - startY.value,
      objectX.value - startX.value
    ) * (180 / Math.PI);
    return {
      opacity: trailOpacity.value,
      width: distance,
      left: `${startX.value}%`,
      top: `${startY.value}%`,
      transform: [
        { translateX: -OBJECT_SIZE / 2 },
        { translateY: -OBJECT_SIZE / 2 },
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
        speakTTS('Pinch and drag the object!', 0.78 );
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
      router.back();
    }
  }, [onBack, router]);

  if (done && finalStats) {
    return (
      <SafeAreaView style={styles.container}>
        <TouchableOpacity onPress={handleBack} style={styles.backChip}>
          <Text style={styles.backChipText}>← Back</Text>
        </TouchableOpacity>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <ResultCard
            correct={finalStats.correct}
            total={finalStats.total}
            xp={finalStats.xp}
            onPlayAgain={() => {
              setDone(false);
              setRound(1);
              setScore(0);
              setFinalStats(null);
              setLogTimestamp(null);
              startRound();
            }}
            onBack={handleBack}
            timestamp={logTimestamp || undefined}
          />
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <LinearGradient
        colors={['#CFFAFE', '#A5F3FC', '#67E8F9', '#22D3EE']}
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
        <Text style={styles.title}>🎯 Pinch and Drag 🎯</Text>
        <View style={styles.progressContainer}>
          <View style={styles.progressBar}>
            <Animated.View style={[styles.progressFill, progressStyle]} />
          </View>
          <Text style={styles.progressText}>{score}/{TOTAL_ROUNDS}</Text>
        </View>
        <Text style={styles.helper}>
          Pinch the object and drag it to the goal!
        </Text>
      </View>

      {/* Play area */}
      <GestureDetector gesture={pinchGesture}>
        <View style={styles.playArea}>
          <LinearGradient
            colors={['#ECFEFF', '#CFFAFE', '#A5F3FC']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFillObject}
          />
          
          {/* Trail line */}
          <Animated.View style={[styles.trail, trailStyle]} />

          {/* Goal zone */}
          <Animated.View style={[styles.goal, goalAnimatedStyle]}>
            <LinearGradient
              colors={['#22C55E', '#16A34A', '#15803D']}
              style={styles.goalGradient}
            >
              <Text style={styles.goalEmoji}>🎯</Text>
            </LinearGradient>
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
                colors={lastResult === 'hit' 
                  ? ['#22C55E', '#16A34A'] 
                  : ['#EF4444', '#DC2626']}
                style={styles.feedbackGradient}
              >
                <Text style={styles.feedbackText}>
                  {lastResult === 'hit' ? '✨ Perfect! ✨' : '👆 Keep pinching!'}
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
  trail: {
    position: 'absolute',
    height: 4,
    backgroundColor: '#3B82F6',
    borderRadius: 2,
    zIndex: 1,
    opacity: 0.6,
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
    shadowRadius: 8,
    elevation: 8,
  },
  objectGradient: {
    width: '100%',
    height: '100%',
    borderRadius: 1000,
    borderWidth: 3,
    borderColor: '#2563EB',
    justifyContent: 'center',
    alignItems: 'center',
  },
  objectEmoji: {
    fontSize: 40,
  },
  goal: {
    position: 'absolute',
    borderRadius: 1000,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 5,
    shadowColor: '#22C55E',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  goalGradient: {
    width: '100%',
    height: '100%',
    borderRadius: 1000,
    borderWidth: 4,
    borderColor: '#16A34A',
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
  },
  goalEmoji: {
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

export default PinchAndDragGame;

