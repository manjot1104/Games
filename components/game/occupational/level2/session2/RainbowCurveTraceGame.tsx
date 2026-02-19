import { SparkleBurst } from '@/components/game/FX';
import GameInfoScreen from '@/components/game/GameInfoScreen';
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
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

const SUCCESS_SOUND = 'https://actions.google.com/sounds/v1/cartoon/balloon_pop.ogg';
const WARNING_SOUND = 'https://actions.google.com/sounds/v1/cartoon/wood_plank_flicks.ogg';
const TOTAL_ROUNDS = 6;
const OBJECT_SIZE = 50;
const LINE_TOLERANCE = 25; // Reduced tolerance for stricter path following

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

// Distance to rainbow arc (similar to smile curve)
const distanceToRainbowArc = (
  px: number,
  py: number,
  centerX: number,
  centerY: number,
  radius: number,
  startAngle: number,
  endAngle: number,
) => {
  const angle = Math.atan2(py - centerY, px - centerX);
  const normalizedAngle = (angle + 2 * Math.PI) % (2 * Math.PI);
  const normalizedStart = (startAngle + 2 * Math.PI) % (2 * Math.PI);
  const normalizedEnd = (endAngle + 2 * Math.PI) % (2 * Math.PI);

  let isWithinArc = false;
  if (normalizedStart < normalizedEnd) {
    isWithinArc = normalizedAngle >= normalizedStart && normalizedAngle <= normalizedEnd;
  } else {
    isWithinArc = normalizedAngle >= normalizedStart || normalizedAngle <= normalizedEnd;
  }

  const distFromCenter = Math.sqrt(Math.pow(px - centerX, 2) + Math.pow(py - centerY, 2));
  const distFromArc = Math.abs(distFromCenter - radius);

  if (isWithinArc) {
    return distFromArc;
  }

  const startX = centerX + radius * Math.cos(startAngle);
  const startY = centerY + radius * Math.sin(startAngle);
  const endX = centerX + radius * Math.cos(endAngle);
  const endY = centerY + radius * Math.sin(endAngle);

  const distToStart = Math.sqrt(Math.pow(px - startX, 2) + Math.pow(py - startY, 2));
  const distToEnd = Math.sqrt(Math.pow(px - endX, 2) + Math.pow(py - endY, 2));

  return Math.min(distFromArc, distToStart, distToEnd);
};

const RainbowCurveTraceGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const playSuccess = useSoundEffect(SUCCESS_SOUND);
  const playWarning = useSoundEffect(WARNING_SOUND);

  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);
  const [roundActive, setRoundActive] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const [isOffTrack, setIsOffTrack] = useState(false);
  const [hasGoneOffTrack, setHasGoneOffTrack] = useState(false);
  const [offTrackCounter, setOffTrackCounter] = useState(0);
  const progress = useSharedValue(0);
  const [rainbowPathStr, setRainbowPathStr] = useState('');
  const [progressPathStr, setProgressPathStr] = useState('');

  const updatePaths = useCallback(() => {
    const startX = centerX.value + radius.value * Math.cos(startAngle.value);
    const startY = centerY.value + radius.value * Math.sin(startAngle.value);
    const endX = centerX.value + radius.value * Math.cos(endAngle.value);
    const endY = centerY.value + radius.value * Math.sin(endAngle.value);
    setRainbowPathStr(`M ${startX} ${startY} A ${radius.value} ${radius.value} 0 0 1 ${endX} ${endY}`);

    if (progress.value > 0) {
      const currentAngle = startAngle.value + (endAngle.value - startAngle.value) * progress.value;
      const currentX = centerX.value + radius.value * Math.cos(currentAngle);
      const currentY = centerY.value + radius.value * Math.sin(currentAngle);
      setProgressPathStr(`M ${startX} ${startY} A ${radius.value} ${radius.value} 0 0 1 ${currentX} ${currentY}`);
    } else {
      setProgressPathStr('');
    }
  }, []);

  // Rainbow arc parameters
  const centerX = useSharedValue(50);
  const centerY = useSharedValue(55);
  const radius = useSharedValue(30);
  const startAngle = useSharedValue(Math.PI * 0.2);
  const endAngle = useSharedValue(Math.PI * 0.8);

  const objectX = useSharedValue(50);
  const objectY = useSharedValue(55);
  const objectScale = useSharedValue(1);
  const sparkleX = useSharedValue(0);
  const sparkleY = useSharedValue(0);

  const screenWidth = useRef(400);
  const screenHeight = useRef(600);
  const lastWarningTime = useRef(0);
  const hasGoneOffTrackRef = useRef(false);
  const isOffTrackRef = useRef(false);
  const currentPointerX = useSharedValue(50);
  const currentPointerY = useSharedValue(55);

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
          type: 'rainbowTrace',
          correct: finalScore,
          total,
          accuracy,
          xpAwarded: xp,
          skillTags: ['smooth-wrist-movement', 'curved-tracking', 'rainbow-arc-tracing'],
        });
        setLogTimestamp(result?.last?.at ?? null);
        router.setParams({ refreshStats: Date.now().toString() });
      } catch (e) {
        console.error('Failed to log rainbow trace game:', e);
      }

      speakTTS('Perfect rainbow tracing!', 0.78 );
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

      // Always update pointer position for continuous checking
      currentPointerX.value = newX;
      currentPointerY.value = newY;

      // First check if pointer is on track
      const dist = distanceToRainbowArc(
        newX,
        newY,
        centerX.value,
        centerY.value,
        radius.value,
        startAngle.value,
        endAngle.value,
      );

      if (dist > LINE_TOLERANCE) {
        // Pointer is off track - ALWAYS show error and mark as off track
        setIsOffTrack(true);
        isOffTrackRef.current = true;
        setHasGoneOffTrack(true);
        hasGoneOffTrackRef.current = true;
        setOffTrackCounter((prev) => (prev >= 1000 ? 1 : prev + 1));
        
        // Play warning sound/vibration periodically
        const now = Date.now();
        if (now - lastWarningTime.current > 500) {
          lastWarningTime.current = now;
          try {
            playWarning();
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          } catch {}
        }
        
        // Don't move object when off track - return early
        return;
      } else {
        // Pointer is on track - allow object movement
        if (isOffTrack) {
          setIsOffTrack(false);
          setOffTrackCounter(0);
        }
        isOffTrackRef.current = false;
        
        // Update object position only when on track
        objectX.value = Math.max(5, Math.min(95, newX));
        objectY.value = Math.max(10, Math.min(90, newY));

        // Calculate progress only when on track
        const angle = Math.atan2(objectY.value - centerY.value, objectX.value - centerX.value);
        let normalizedAngle = (angle + 2 * Math.PI) % (2 * Math.PI);
        let normalizedStart = (startAngle.value + 2 * Math.PI) % (2 * Math.PI);
        let normalizedEnd = (endAngle.value + 2 * Math.PI) % (2 * Math.PI);

        let angleProgress = 0;
        if (normalizedStart < normalizedEnd) {
          angleProgress = (normalizedAngle - normalizedStart) / (normalizedEnd - normalizedStart);
        } else {
          const wrappedProgress = ((normalizedAngle - normalizedStart + 2 * Math.PI) % (2 * Math.PI)) /
            ((normalizedEnd - normalizedStart + 2 * Math.PI) % (2 * Math.PI));
          angleProgress = wrappedProgress;
        }

        progress.value = Math.min(1, Math.max(0, angleProgress));
        updatePaths();
      }
    })
    .onEnd(() => {
      if (!roundActive || done) return;
      setIsDragging(false);
      objectScale.value = withSpring(1, { damping: 10, stiffness: 200 });

      const endX = centerX.value + radius.value * Math.cos(endAngle.value);
      const endY = centerY.value + radius.value * Math.sin(endAngle.value);
      const distToEnd = Math.sqrt(
        Math.pow(objectX.value - endX, 2) + Math.pow(objectY.value - endY, 2),
      );

      // Only allow completion if user reached the end AND never went off track AND progress is complete
      if (distToEnd <= LINE_TOLERANCE && progress.value >= 0.99 && !hasGoneOffTrack && !hasGoneOffTrackRef.current) {
        sparkleX.value = endX;
        sparkleY.value = endY;

        setScore((s) => {
          const newScore = s + 1;
          if (newScore >= TOTAL_ROUNDS) {
            setTimeout(() => {
              endGame(newScore);
            }, 1000);
          } else {
            setTimeout(() => {
              setRound((r) => r + 1);
              progress.value = 0;
              updatePaths();
              setIsOffTrack(false);
              setHasGoneOffTrack(false);
              hasGoneOffTrackRef.current = false;
              isOffTrackRef.current = false;
              setOffTrackCounter(0);
              const startX = centerX.value + radius.value * Math.cos(startAngle.value);
              const startY = centerY.value + radius.value * Math.sin(startAngle.value);
              objectX.value = withSpring(startX, { damping: 10, stiffness: 100 });
              objectY.value = withSpring(startY, { damping: 10, stiffness: 100 });
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
        const startX = centerX.value + radius.value * Math.cos(startAngle.value);
        const startY = centerY.value + radius.value * Math.sin(startAngle.value);
        objectX.value = withSpring(startX, { damping: 10, stiffness: 100 });
        objectY.value = withSpring(startY, { damping: 10, stiffness: 100 });
        progress.value = 0;
        updatePaths();
        setIsOffTrack(false);
        setHasGoneOffTrack(false);
        hasGoneOffTrackRef.current = false;
        isOffTrackRef.current = false;
        setOffTrackCounter(0);

        try {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          if (hasGoneOffTrack) {
            speakTTS('Stay on the path! Try again.', 0.78 );
          } else {
            speakTTS('Trace the rainbow arc!', 0.78 );
          }
        } catch {}
      }
    });

  useEffect(() => {
    if (showInfo) return;
    try {
      speakTTS('Trace the rainbow arc!', 0.78 );
    } catch {}
    centerX.value = 50;
    centerY.value = 55;
    radius.value = 25 + Math.random() * 15;
    startAngle.value = Math.PI * 0.2;
    endAngle.value = Math.PI * 0.8;

    const startX = centerX.value + radius.value * Math.cos(startAngle.value);
    const startY = centerY.value + radius.value * Math.sin(startAngle.value);
    objectX.value = startX;
    objectY.value = startY;
    progress.value = 0;
    setIsOffTrack(false);
    setHasGoneOffTrack(false);
    hasGoneOffTrackRef.current = false;
    isOffTrackRef.current = false;
    setOffTrackCounter(0);
    updatePaths();
    
    return () => {
      stopAllSpeech();
      cleanupSounds();
    };
  }, [round, updatePaths, showInfo]);

  useEffect(() => {
    const interval = setInterval(updatePaths, 100);
    return () => clearInterval(interval);
  }, [updatePaths]);

  // Continuous check for off-track status
  useEffect(() => {
    if (!roundActive || done || !isDragging || showInfo) return;
    
    const checkInterval = setInterval(() => {
      const dist = distanceToRainbowArc(
        currentPointerX.value,
        currentPointerY.value,
        centerX.value,
        centerY.value,
        radius.value,
        startAngle.value,
        endAngle.value,
      );

      if (dist > LINE_TOLERANCE) {
        setIsOffTrack(true);
        isOffTrackRef.current = true;
        setHasGoneOffTrack(true);
        hasGoneOffTrackRef.current = true;
        setOffTrackCounter((prev) => (prev >= 1000 ? 1 : prev + 1));
      } else {
        if (isOffTrack) {
          setIsOffTrack(false);
          setOffTrackCounter(0);
        }
        isOffTrackRef.current = false;
      }
    }, 50);

    return () => clearInterval(checkInterval);
  }, [roundActive, done, isDragging, showInfo]);

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

  if (showInfo) {
    return (
      <GameInfoScreen
        title="Rainbow Trace"
        emoji="🌈"
        description="Follow arc to complete rainbow"
        skills={['Smooth wrist movement', 'Curved tracking']}
        suitableFor="Children learning smooth wrist movement and curved tracking skills"
        onStart={() => {
          setShowInfo(false);
        }}
        onBack={handleBack}
      />
    );
  }

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
            <Text style={{ fontSize: 64, marginBottom: 16 }}>🌈</Text>
            <Text style={styles.resultTitle}>Rainbow Complete!</Text>
            <Text style={styles.resultSubtitle}>
              You traced {finalStats.correct} rainbows out of {finalStats.total}!
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
                updatePaths();
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
        <Text style={styles.title}>Rainbow Trace</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • 🌈 Score: {score}
        </Text>
        <Text style={styles.helper}>
          Trace the rainbow arc from left to right!
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
              <Path
                d={rainbowPathStr}
                stroke="rgba(148, 163, 184, 0.5)"
                strokeWidth="3"
                fill="none"
                strokeLinecap="round"
              />
              {progressPathStr ? (
                <Path
                  d={progressPathStr}
                  stroke="#FF6B6B"
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
                    backgroundColor: isOffTrack ? '#EF4444' : '#FF6B6B',
                  },
                ]}
              >
                <Text style={styles.objectEmoji}>🌈</Text>
              </View>
            </Animated.View>

            {score > 0 && !isDragging && (
              <Animated.View style={[styles.sparkleContainer, sparkleStyle]} pointerEvents="none">
                <SparkleBurst />
              </Animated.View>
            )}

            {(isOffTrack || offTrackCounter > 0) && (
              <View style={styles.warningBox}>
                <Text style={styles.warningText}>❌ Stay on the path! Game won't complete if you go off track! ⚠️</Text>
              </View>
            )}
          </Animated.View>
        </GestureDetector>
      </View>

      <View style={styles.footerBox}>
        <Text style={styles.footerMain}>
          Skills: smooth wrist movement • curved tracking • rainbow arc tracing
        </Text>
        <Text style={styles.footerSub}>
          Trace the rainbow's arc with smooth curved motion!
        </Text>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFBEB',
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
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 8,
  },
  objectEmoji: {
    fontSize: 32,
  },
  sparkleContainer: {
    position: 'absolute',
    transform: [{ translateX: -20 }, { translateY: -20 }],
    zIndex: 4,
  },
  warningBox: {
    position: 'absolute',
    top: '15%',
    left: '50%',
    transform: [{ translateX: -120 }],
    backgroundColor: '#EF4444',
    paddingHorizontal: 24,
    paddingVertical: 16,
    borderRadius: 24,
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 12,
    borderWidth: 3,
    borderColor: '#DC2626',
    zIndex: 100,
  },
  warningText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '900',
    textAlign: 'center',
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

export default RainbowCurveTraceGame;
