import { logGameAndAward, recordGame } from '@/utils/api';
import { cleanupSounds, stopAllSpeech } from '@/utils/soundPlayer';
import { speak as speakTTS } from '@/utils/tts';
import { Audio as ExpoAudio } from 'expo-av';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
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
    useAnimatedStyle,
    useSharedValue,
    withTiming
} from 'react-native-reanimated';
import { SparkleBurst } from './FX';
import ResultCard from './ResultCard';

const SUCCESS_SOUND = 'https://actions.google.com/sounds/v1/cartoon/balloon_pop.ogg';
const RESET_SOUND = 'https://actions.google.com/sounds/v1/cartoon/wood_plank_flicks.ogg';
const TOTAL_ROUNDS = 8;
const LASER_WIDTH = 8;
const TOLERANCE = 30;
const FINGER_SIZE = 30; // Size of finger pointer (matches style width/height)

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

const LightTheLaserGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const playSuccess = useSoundEffect(SUCCESS_SOUND);
  const playReset = useSoundEffect(RESET_SOUND);

  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);
  const [roundActive, setRoundActive] = useState(true);
  const [isTracing, setIsTracing] = useState(false);
  const [isHorizontal, setIsHorizontal] = useState(true);
  const [progress, setProgress] = useState(0);

  const fingerX = useSharedValue(15);
  const fingerY = useSharedValue(50);
  const laserOpacity = useSharedValue(0);
  const laserLength = useSharedValue(0);
  const sparkleX = useSharedValue(0);
  const sparkleY = useSharedValue(0);
  const startX = useSharedValue(15);
  const startY = useSharedValue(50);
  const endX = useSharedValue(85);
  const endY = useSharedValue(50);

  const screenWidth = useRef(400);
  const screenHeight = useRef(600);
  const pathPoints = useRef<Array<{ x: number; y: number }>>([]);

  const endGame = useCallback(
    async (finalScore: number) => {
      const total = TOTAL_ROUNDS;
      const xp = finalScore * 18;
      const accuracy = (finalScore / total) * 100;

      setFinalStats({ correct: finalScore, total, xp });
      setDone(true);
      setRoundActive(false);

      // Stop all speech when game ends
      stopAllSpeech();

      try {
        await recordGame(xp);
        const result = await logGameAndAward({
          type: 'lightTheLaser',
          correct: finalScore,
          total,
          accuracy,
          xpAwarded: xp,
          skillTags: ['directionality', 'start-end-awareness', 'hand-stability', 'straight-line-tracing'],
        });
        setLogTimestamp(result?.last?.at ?? null);
        router.setParams({ refreshStats: Date.now().toString() });
      } catch (e) {
        console.error('Failed to log light the laser game:', e);
      }

      speakTTS('Laser master!', 0.78);
    },
    [router],
  );

  const panGesture = Gesture.Pan()
    .onStart((e) => {
      if (!roundActive || done) return;
      
      // Check if touch started on the finger - only allow dragging if started on finger
      const touchX = (e.x / screenWidth.current) * 100;
      const touchY = (e.y / screenHeight.current) * 100;
      
      // Calculate distance from touch point to finger center
      const fingerCenterX = fingerX.value;
      const fingerCenterY = fingerY.value;
      
      // Convert FINGER_SIZE from pixels to percentage for comparison
      const fingerSizePercentX = (FINGER_SIZE / screenWidth.current) * 100;
      const fingerSizePercentY = (FINGER_SIZE / screenHeight.current) * 100;
      const fingerRadiusX = fingerSizePercentX / 2;
      const fingerRadiusY = fingerSizePercentY / 2;
      
      // Check if touch is within finger bounds
      const distX = Math.abs(touchX - fingerCenterX);
      const distY = Math.abs(touchY - fingerCenterY);
      const isOnFinger = distX <= fingerRadiusX && distY <= fingerRadiusY;
      
      if (!isOnFinger) {
        return; // Don't start tracing if not on finger
      }
      
      setIsTracing(true);
      pathPoints.current = [];
      laserOpacity.value = withTiming(1, { duration: 200 });
    })
    .onUpdate((e) => {
      if (!roundActive || done || !isTracing) return; // Only update if tracing started on finger
      const newX = (e.x / screenWidth.current) * 100;
      const newY = (e.y / screenHeight.current) * 100;
      
      pathPoints.current.push({ x: newX, y: newY });
      
      if (isHorizontal) {
        // Clamp finger position between start and end
        const minX = Math.min(startX.value, endX.value);
        const maxX = Math.max(startX.value, endX.value);
        const clampedX = Math.max(minX, Math.min(maxX, newX));
        fingerX.value = clampedX;
        fingerY.value = startY.value;
        
        // Calculate laser length as actual distance from start to finger
        const dist = Math.abs(clampedX - startX.value);
        const totalDist = Math.abs(endX.value - startX.value);
        // Laser length should be percentage of total distance, but clamped to finger position
        laserLength.value = totalDist > 0 ? (dist / totalDist) * 100 : 0;
        setProgress(Math.min(100, (dist / totalDist) * 100));
      } else {
        // Clamp finger position between start and end
        const minY = Math.min(startY.value, endY.value);
        const maxY = Math.max(startY.value, endY.value);
        const clampedY = Math.max(minY, Math.min(maxY, newY));
        fingerX.value = startX.value;
        fingerY.value = clampedY;
        
        // Calculate laser length as actual distance from start to finger
        const dist = Math.abs(clampedY - startY.value);
        const totalDist = Math.abs(endY.value - startY.value);
        // Laser length should be percentage of total distance, but clamped to finger position
        laserLength.value = totalDist > 0 ? (dist / totalDist) * 100 : 0;
        setProgress(Math.min(100, (dist / totalDist) * 100));
      }
    })
    .onEnd(() => {
      if (!roundActive || done) return;
      setIsTracing(false);
      
      const distance = Math.sqrt(
        Math.pow(fingerX.value - endX.value, 2) + Math.pow(fingerY.value - endY.value, 2)
      );

      if (distance <= TOLERANCE && progress > 80) {
        sparkleX.value = endX.value;
        sparkleY.value = endY.value;

        setScore((s) => {
          const newScore = s + 1;
          if (newScore >= TOTAL_ROUNDS) {
            setTimeout(() => {
              endGame(newScore);
            }, 1000);
          } else {
            setTimeout(() => {
              setRound((r) => r + 1);
              setProgress(0);
              laserOpacity.value = 0;
              laserLength.value = 0;
              fingerX.value = startX.value;
              fingerY.value = startY.value;
              setRoundActive(true);
            }, 1500);
          }
          return newScore;
        });

        try {
          playSuccess();
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } catch {}
      } else {
        laserOpacity.value = withTiming(0, { duration: 200 });
        laserLength.value = 0;
        setProgress(0);
        fingerX.value = startX.value;
        fingerY.value = startY.value;

        try {
          playReset();
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          speakTTS('Trace the full line!', 0.78);
        } catch {}
      }
    });

  useEffect(() => {
    const horizontal = Math.random() > 0.5;
    setIsHorizontal(horizontal);
    
    if (horizontal) {
      const startXPos = 10 + Math.random() * 10;
      const yPos = 40 + Math.random() * 20;
      startX.value = startXPos;
      startY.value = yPos;
      fingerX.value = startXPos;
      fingerY.value = yPos;
      endX.value = 80 + Math.random() * 15;
      endY.value = yPos;
    } else {
      const xPos = 40 + Math.random() * 20;
      const startYPos = 10 + Math.random() * 10;
      startX.value = xPos;
      startY.value = startYPos;
      fingerX.value = xPos;
      fingerY.value = startYPos;
      endX.value = xPos;
      endY.value = 75 + Math.random() * 15;
    }

    laserOpacity.value = 0;
    laserLength.value = 0;
    setProgress(0);

    try {
      speakTTS('Trace your finger along the line to light the laser!', 0.78);
    } catch {}

    return () => {
      stopAllSpeech();
      cleanupSounds();
    };
  }, [round]);

  const handleBack = useCallback(() => {
    stopAllSpeech();
    cleanupSounds();
    onBack?.();
  }, [onBack]);

  const fingerStyle = useAnimatedStyle(() => ({
    left: `${fingerX.value}%`,
    top: `${fingerY.value}%`,
    transform: [
      { translateX: -15 },
      { translateY: -15 },
    ],
  }));

  const laserStyle = useAnimatedStyle(() => {
    if (isHorizontal) {
      const lineStartX = Math.min(startX.value, endX.value);
      const lineEndX = Math.max(startX.value, endX.value);
      const totalDist = lineEndX - lineStartX;
      
      // Calculate actual distance from start to current finger position
      // Clamp finger position between start and end
      const clampedFingerX = Math.max(lineStartX, Math.min(lineEndX, fingerX.value));
      const actualDist = clampedFingerX - lineStartX;
      
      // Use actual distance (already clamped, so it won't exceed total distance)
      const laserWidthPercent = Math.max(0, Math.min(actualDist, totalDist));
      
      return {
        position: 'absolute',
        left: `${lineStartX}%`,
        top: `${startY.value}%`,
        width: `${laserWidthPercent}%`,
        height: LASER_WIDTH,
        transform: [{ translateY: -LASER_WIDTH / 2 }],
        backgroundColor: '#EF4444',
        opacity: laserOpacity.value,
        shadowColor: '#EF4444',
        shadowOpacity: 0.8,
        shadowRadius: 10,
        elevation: 5,
      };
    } else {
      const lineStartY = Math.min(startY.value, endY.value);
      const lineEndY = Math.max(startY.value, endY.value);
      const totalDist = lineEndY - lineStartY;
      
      // Calculate actual distance from start to current finger position
      // Clamp finger position between start and end
      const clampedFingerY = Math.max(lineStartY, Math.min(lineEndY, fingerY.value));
      const actualDist = clampedFingerY - lineStartY;
      
      // Use actual distance (already clamped, so it won't exceed total distance)
      const laserHeightPercent = Math.max(0, Math.min(actualDist, totalDist));
      
      return {
        position: 'absolute',
        left: `${startX.value}%`,
        top: `${lineStartY}%`,
        width: LASER_WIDTH,
        height: `${laserHeightPercent}%`,
        transform: [{ translateX: -LASER_WIDTH / 2 }],
        backgroundColor: '#EF4444',
        opacity: laserOpacity.value,
        shadowColor: '#EF4444',
        shadowOpacity: 0.8,
        shadowRadius: 10,
        elevation: 5,
      };
    }
  });

  const targetStyle = useAnimatedStyle(() => ({
    left: `${endX.value}%`,
    top: `${endY.value}%`,
    transform: [
      { translateX: -20 },
      { translateY: -20 },
    ],
  }));

  const sparkleStyle = useAnimatedStyle(() => ({
    left: `${sparkleX.value}%`,
    top: `${sparkleY.value}%`,
  }));

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
            <Text style={{ fontSize: 64, marginBottom: 16 }}>🔴</Text>
            <Text style={styles.resultTitle}>Laser master!</Text>
            <Text style={styles.resultSubtitle}>
              You lit {finalStats.correct} lasers out of {finalStats.total}!
            </Text>
            <ResultCard
              correct={finalStats.correct}
              total={finalStats.total}
              xpAwarded={finalStats.xp}
              accuracy={accuracyPct}
              logTimestamp={logTimestamp}
              onPlayAgain={() => {
                setRound(1);
                setScore(0);
                setDone(false);
                setFinalStats(null);
                setLogTimestamp(null);
                setRoundActive(true);
                setProgress(0);
                laserOpacity.value = 0;
                laserLength.value = 0;
                fingerX.value = startX.value;
                fingerY.value = startY.value;
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
        <Text style={styles.title}>Light the Laser</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • 🔴 Score: {score}
        </Text>
        <Text style={styles.helper}>
          Trace your finger along the line to light the laser beam!
        </Text>
      </View>

      <View
        style={styles.playArea}
        onLayout={(e) => {
          screenWidth.current = e.nativeEvent.layout.width;
          screenHeight.current = e.nativeEvent.layout.height;
        }}
      >
        <GestureDetector gesture={panGesture}>
          <Animated.View style={styles.gestureArea}>
            <Animated.View style={[styles.target, targetStyle]}>
              <View style={styles.targetCircle}>
                <Text style={styles.targetEmoji}>🎯</Text>
              </View>
            </Animated.View>

            <Animated.View style={laserStyle} />

            <Animated.View style={[styles.fingerContainer, fingerStyle]}>
              <View style={styles.finger}>
                <Text style={styles.fingerEmoji}>👆</Text>
              </View>
            </Animated.View>

            {score > 0 && !isTracing && (
              <Animated.View style={[styles.sparkleContainer, sparkleStyle]} pointerEvents="none">
                <SparkleBurst />
              </Animated.View>
            )}
          </Animated.View>
        </GestureDetector>
      </View>

      <View style={styles.footerBox}>
        <Text style={styles.footerMain}>
          Skills: directionality • start-end awareness • hand stability
        </Text>
        <Text style={styles.footerSub}>
          Trace your finger along the straight line to light the laser beam!
        </Text>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
    paddingHorizontal: 16,
    paddingTop: 48,
  },
  backChip: {
    position: 'absolute',
    top: 50,
    left: 16,
    zIndex: 10,
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  backChipText: {
    color: '#0F172A',
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
    color: '#fff',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 16,
    color: '#94A3B8',
    marginBottom: 6,
  },
  helper: {
    fontSize: 14,
    color: '#94A3B8',
    textAlign: 'center',
    paddingHorizontal: 18,
  },
  playArea: {
    flex: 1,
    position: 'relative',
    marginBottom: 16,
  },
  gestureArea: {
    flex: 1,
    position: 'relative',
  },
  fingerContainer: {
    position: 'absolute',
    zIndex: 3,
  },
  finger: {
    width: 30,
    height: 30,
    justifyContent: 'center',
    alignItems: 'center',
  },
  fingerEmoji: {
    fontSize: 30,
  },
  target: {
    position: 'absolute',
    zIndex: 2,
  },
  targetCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#22C55E',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: '#16A34A',
  },
  targetEmoji: {
    fontSize: 24,
  },
  sparkleContainer: {
    position: 'absolute',
    transform: [{ translateX: -20 }, { translateY: -20 }],
    zIndex: 4,
  },
  footerBox: {
    paddingVertical: 14,
    marginBottom: 20,
  },
  footerMain: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
    textAlign: 'center',
    marginBottom: 4,
  },
  footerSub: {
    fontSize: 13,
    color: '#94A3B8',
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

export default LightTheLaserGame;


