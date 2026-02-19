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
    withSpring,
    withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Path } from 'react-native-svg';

const SUCCESS_SOUND = 'https://actions.google.com/sounds/v1/cartoon/balloon_pop.ogg';
const WARNING_SOUND = 'https://actions.google.com/sounds/v1/cartoon/wood_plank_flicks.ogg';
const TOTAL_ROUNDS = 6;
const OBJECT_SIZE = 30;
const LINE_TOLERANCE = 12;
const INITIAL_CIRCLE_RADIUS = 25;
const MIN_CIRCLE_RADIUS = 12;

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

const distanceToArc = (
  px: number,
  py: number,
  centerX: number,
  centerY: number,
  radius: number,
  startAngle: number,
  endAngle: number,
) => {
  const dx = px - centerX;
  const dy = py - centerY;
  const distFromCenter = Math.sqrt(dx * dx + dy * dy);
  const angle = Math.atan2(dy, dx);
  
  const distFromArc = Math.abs(distFromCenter - radius);
  
  const normalizedAngle = angle < 0 ? angle + 2 * Math.PI : angle;
  const normalizedStart = startAngle < 0 ? startAngle + 2 * Math.PI : startAngle;
  const normalizedEnd = endAngle < 0 ? endAngle + 2 * Math.PI : endAngle;
  
  let inArc = false;
  if (normalizedStart < normalizedEnd) {
    inArc = normalizedAngle >= normalizedStart && normalizedAngle <= normalizedEnd;
  } else {
    inArc = normalizedAngle >= normalizedStart || normalizedAngle <= normalizedEnd;
  }
  
  if (!inArc) {
    const distToStart = Math.sqrt(
      Math.pow(px - (centerX + radius * Math.cos(startAngle)), 2) +
      Math.pow(py - (centerY + radius * Math.sin(startAngle)), 2)
    );
    const distToEnd = Math.sqrt(
      Math.pow(px - (centerX + radius * Math.cos(endAngle)), 2) +
      Math.pow(py - (centerY + radius * Math.sin(endAngle)), 2)
    );
    return Math.min(distFromArc, distToStart, distToEnd);
  }
  
  return distFromArc;
};

const ShrinkModeTraceGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const playSuccess = useSoundEffect(SUCCESS_SOUND);
  const playWarning = useSoundEffect(WARNING_SOUND);

  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);
  const [roundActive, setRoundActive] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const [isOffTrack, setIsOffTrack] = useState(false);
  const progress = useSharedValue(0);
  const [circlePathStr, setCirclePathStr] = useState('');
  const [progressPathStr, setProgressPathStr] = useState('');

  const centerX = useSharedValue(50);
  const centerY = useSharedValue(50);
  const radius = useSharedValue(INITIAL_CIRCLE_RADIUS);
  const startAngle = useSharedValue(0);

  const objectX = useSharedValue(50 + INITIAL_CIRCLE_RADIUS);
  const objectY = useSharedValue(50);
  const objectScale = useSharedValue(1);
  const sparkleX = useSharedValue(0);
  const sparkleY = useSharedValue(0);

  const screenWidth = useRef(400);
  const screenHeight = useRef(600);
  const lastWarningTime = useRef(0);
  const lastProgress = useRef(0);

  const getRadiusForRound = (roundNum: number) => {
    const progress = (roundNum - 1) / (TOTAL_ROUNDS - 1);
    return INITIAL_CIRCLE_RADIUS - (INITIAL_CIRCLE_RADIUS - MIN_CIRCLE_RADIUS) * progress;
  };

  const updatePaths = useCallback(() => {
    const currentRadius = radius.value;
    const startX = centerX.value + currentRadius * Math.cos(startAngle.value);
    const startY = centerY.value + currentRadius * Math.sin(startAngle.value);
    const endX = centerX.value + currentRadius * Math.cos(startAngle.value + 2 * Math.PI);
    const endY = centerY.value + currentRadius * Math.sin(startAngle.value + 2 * Math.PI);
    
    setCirclePathStr(`M ${startX} ${startY} A ${currentRadius} ${currentRadius} 0 1 1 ${endX} ${endY} A ${currentRadius} ${currentRadius} 0 1 1 ${startX} ${startY}`);

    if (progress.value > 0) {
      const currentAngle = startAngle.value + 2 * Math.PI * progress.value;
      const currentX = centerX.value + currentRadius * Math.cos(currentAngle);
      const currentY = centerY.value + currentRadius * Math.sin(currentAngle);
      setProgressPathStr(`M ${startX} ${startY} A ${currentRadius} ${currentRadius} 0 ${progress.value > 0.5 ? 1 : 0} 1 ${currentX} ${currentY}`);
    } else {
      setProgressPathStr('');
    }
  }, []);

  const endGame = useCallback(
    async (finalScore: number) => {
      const total = TOTAL_ROUNDS;
      const xp = finalScore * 20;
      const accuracy = (finalScore / total) * 100;

      setFinalStats({ correct: finalScore, total, xp });
      setDone(true);
      setRoundActive(false);

      try {
        await recordGame(xp);
        const result = await logGameAndAward({
          type: 'shrinkModeTrace',
          correct: finalScore,
          total,
          accuracy,
          xpAwarded: xp,
          skillTags: ['finger-control', 'precision', 'shrinking-shape-tracing'],
        });
        setLogTimestamp(result?.last?.at ?? null);
        router.setParams({ refreshStats: Date.now().toString() });
      } catch (e) {
        console.error('Failed to log shrink mode trace game:', e);
      }

      speakTTS('Shrink trace complete!', 0.78 );
    },
    [router],
  );

  const panGesture = Gesture.Pan()
    .onStart(() => {
      if (!roundActive || done) return;
      setIsDragging(true);
      objectScale.value = withSpring(1.2, { damping: 10, stiffness: 200 });
    })
    .onUpdate((e) => {
      if (!roundActive || done) return;
      const newX = (e.x / screenWidth.current) * 100;
      const newY = (e.y / screenHeight.current) * 100;

      objectX.value = Math.max(5, Math.min(95, newX));
      objectY.value = Math.max(10, Math.min(90, newY));

      const endAngle = startAngle.value + 2 * Math.PI;
      const dist = distanceToArc(
        objectX.value,
        objectY.value,
        centerX.value,
        centerY.value,
        radius.value,
        startAngle.value,
        endAngle,
      );

      if (dist > LINE_TOLERANCE) {
        if (!isOffTrack) {
          setIsOffTrack(true);
          const now = Date.now();
          if (now - lastWarningTime.current > 500) {
            lastWarningTime.current = now;
            try {
              playWarning();
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            } catch {}
          }
        }
      } else {
        setIsOffTrack(false);
        const dx = objectX.value - centerX.value;
        const dy = objectY.value - centerY.value;
        let angle = Math.atan2(dy, dx);
        if (angle < 0) angle += 2 * Math.PI;
        let normalizedAngle = angle - startAngle.value;
        if (normalizedAngle < 0) normalizedAngle += 2 * Math.PI;
        const currentProgress = normalizedAngle / (2 * Math.PI);
        
        // Only allow clockwise progress - check if actually moving forward
        const progressDiff = currentProgress - lastProgress.current;
        
        // Handle wrap-around: if we're near 0 and last was near 1, we might have wrapped
        if (currentProgress < 0.1 && lastProgress.current > 0.9) {
          progress.value = Math.min(1, currentProgress + 1);
          lastProgress.current = currentProgress;
        } else if (progressDiff > -0.05) {
          progress.value = Math.min(1, Math.max(progress.value, currentProgress));
          lastProgress.current = currentProgress;
        }
        
        updatePaths();
      }
    })
    .onEnd(() => {
      if (!roundActive || done) return;
      setIsDragging(false);
      objectScale.value = withSpring(1, { damping: 10, stiffness: 200 });

      if (progress.value >= 0.85) {
        sparkleX.value = centerX.value + radius.value;
        sparkleY.value = centerY.value;

        setScore(s => {
          const newScore = s + 1;
          if (newScore >= TOTAL_ROUNDS) {
            setTimeout(() => {
              endGame(newScore);
            }, 1000);
          } else {
            setTimeout(() => {
              setRound(r => {
                const newRound = r + 1;
                const newRadius = getRadiusForRound(newRound);
                radius.value = withTiming(newRadius, { duration: 500 });
                progress.value = 0;
                lastProgress.current = 0;
                updatePaths();
                setIsOffTrack(false);
                objectX.value = centerX.value + newRadius;
                objectY.value = centerY.value;
                setRoundActive(true);
                return newRound;
              });
            }, 1500);
          }
          return newScore;
        });

        try {
          playSuccess();
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } catch {}
      } else {
        progress.value = 0;
        lastProgress.current = 0;
        updatePaths();
        setIsOffTrack(false);
        objectX.value = centerX.value + radius.value;
        objectY.value = centerY.value;

        try {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          speakTTS('Trace the whole circle!', 0.78 );
        } catch {}
      }
    });

  useEffect(() => {
    const newRadius = getRadiusForRound(round);
    radius.value = withTiming(newRadius, { duration: 500 });
    progress.value = 0;
    lastProgress.current = 0;
    objectX.value = centerX.value + newRadius;
    objectY.value = centerY.value;
    updatePaths();
    try {
      speakTTS('Trace the circle as it shrinks smaller each round!', 0.78 );
    } catch {}
    
    return () => {
      stopAllSpeech();
      cleanupSounds();
    };
  }, [round, updatePaths]);

  useEffect(() => {
    const interval = setInterval(updatePaths, 100);
    return () => clearInterval(interval);
  }, [updatePaths]);

  const handleBack = useCallback(() => {
    stopAllSpeech();
    cleanupSounds();
    onBack?.();
  }, [onBack]);

  const objectStyle = useAnimatedStyle(() => ({
    left: `${objectX.value}%`,
    top: `${objectY.value}%`,
    transform: [
      { translateX: -OBJECT_SIZE / 2 },
      { translateY: -OBJECT_SIZE / 2 },
      { scale: objectScale.value },
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
            <Text style={{ fontSize: 64, marginBottom: 16 }}>🔽</Text>
            <Text style={styles.resultTitle}>Shrink Trace Complete!</Text>
            <Text style={styles.resultSubtitle}>
              You traced {finalStats.correct} shrinking shapes out of {finalStats.total}!
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
                progress.value = 0;
                lastProgress.current = 0;
                radius.value = INITIAL_CIRCLE_RADIUS;
                setRoundActive(true);
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
        <Text style={styles.title}>Shrink Mode Trace</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • 🔽 Score: {score}
        </Text>
        <Text style={styles.helper}>
          Trace the circle as it shrinks smaller each round!
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
            <Svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" style={styles.svg}>
              <Circle
                cx={centerX.value}
                cy={centerY.value}
                r={radius.value}
                fill="none"
                stroke="rgba(148, 163, 184, 0.4)"
                strokeWidth="3"
                strokeDasharray="3 3"
              />
              <Path
                d={circlePathStr}
                stroke="rgba(148, 163, 184, 0.5)"
                strokeWidth="3"
                fill="none"
                strokeLinecap="round"
              />
              {progressPathStr ? (
                <Path
                  d={progressPathStr}
                  stroke="#EF4444"
                  strokeWidth="3"
                  fill="none"
                  strokeLinecap="round"
                />
              ) : null}
            </Svg>

            <Animated.View style={[styles.objectContainer, objectStyle]}>
              <View
                style={[
                  styles.object,
                  {
                    backgroundColor: isOffTrack ? '#EF4444' : '#EF4444',
                  },
                ]}
              >
                <Text style={styles.objectEmoji}>👆</Text>
              </View>
            </Animated.View>

            {score > 0 && !isDragging && (
              <Animated.View style={[styles.sparkleContainer, sparkleStyle]} pointerEvents="none">
                <SparkleBurst />
              </Animated.View>
            )}

            {isOffTrack && (
              <View style={styles.warningBox}>
                <Text style={styles.warningText}>Stay on the circle! ⚠️</Text>
              </View>
            )}
          </Animated.View>
        </GestureDetector>
      </View>

      <View style={styles.footerBox}>
        <Text style={styles.footerMain}>
          Skills: finger control • precision • shrinking shape tracing
        </Text>
        <Text style={styles.footerSub}>
          Circle gets smaller each round - trace carefully!
        </Text>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FEF2F2',
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
    position: 'relative',
    marginBottom: 16,
  },
  gestureArea: {
    flex: 1,
    position: 'relative',
  },
  svg: {
    position: 'absolute',
    width: '100%',
    height: '100%',
  },
  objectContainer: {
    position: 'absolute',
    zIndex: 3,
  },
  object: {
    width: OBJECT_SIZE,
    height: OBJECT_SIZE,
    borderRadius: OBJECT_SIZE / 2,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  objectEmoji: {
    fontSize: 18,
  },
  sparkleContainer: {
    position: 'absolute',
    transform: [{ translateX: -20 }, { translateY: -20 }],
    zIndex: 4,
  },
  warningBox: {
    position: 'absolute',
    top: '20%',
    left: '50%',
    transform: [{ translateX: -80 }],
    backgroundColor: 'rgba(239, 68, 68, 0.9)',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  warningText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
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

export default ShrinkModeTraceGame;

