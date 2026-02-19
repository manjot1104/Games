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
    withSpring
} from 'react-native-reanimated';

const SUCCESS_SOUND = 'https://actions.google.com/sounds/v1/cartoon/balloon_pop.ogg';
const WARNING_SOUND = 'https://actions.google.com/sounds/v1/cartoon/wood_plank_flicks.ogg';
const TOTAL_ROUNDS = 8;
const OBJECT_SIZE = 60;
const LINE_WIDTH = 20;
const LINE_TOLERANCE = 30; // Distance from line center to consider on track

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

const FollowTheLineGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
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
  const [progress, setProgress] = useState(0);

  // Line path (start to end)
  const lineStartX = useSharedValue(15);
  const lineStartY = useSharedValue(50);
  const lineEndX = useSharedValue(85);
  const lineEndY = useSharedValue(50);
  
  // Animation values
  const objectX = useSharedValue(15);
  const objectY = useSharedValue(50);
  const objectScale = useSharedValue(1);
  const sparkleX = useSharedValue(0);
  const sparkleY = useSharedValue(0);

  const screenWidth = useRef(400);
  const screenHeight = useRef(600);
  const lastWarningTime = useRef(0);

  // End game function (defined before use)
  const endGame = useCallback(
    async (finalScore: number) => {
      const total = TOTAL_ROUNDS;
      const xp = finalScore * 18; // 18 XP per successful follow
      const accuracy = (finalScore / total) * 100;

      setFinalStats({ correct: finalScore, total, xp });
      setDone(true);
      setRoundActive(false);

      try {
        await recordGame(xp);
        const result = await logGameAndAward({
          type: 'followTheLine',
          correct: finalScore,
          total,
          accuracy,
          xpAwarded: xp,
          skillTags: ['early-tracing-precursor', 'spatial-accuracy', 'hand-eye-integration'],
        });
        setLogTimestamp(result?.last?.at ?? null);
        router.setParams({ refreshStats: Date.now().toString() });
      } catch (e) {
        console.error('Failed to log follow the line game:', e);
      }

      speakTTS('Great line following!', 0.78 );
    },
    [router],
  );

  // Calculate distance from point to line
  const distanceToLine = (px: number, py: number, x1: number, y1: number, x2: number, y2: number) => {
    const A = px - x1;
    const B = py - y1;
    const C = x2 - x1;
    const D = y2 - y1;
    const dot = A * C + B * D;
    const lenSq = C * C + D * D;
    let param = -1;
    if (lenSq !== 0) param = dot / lenSq;
    let xx, yy;
    if (param < 0) {
      xx = x1;
      yy = y1;
    } else if (param > 1) {
      xx = x2;
      yy = y2;
    } else {
      xx = x1 + param * C;
      yy = y1 + param * D;
    }
    const dx = px - xx;
    const dy = py - yy;
    return Math.sqrt(dx * dx + dy * dy);
  };

  // Pan gesture for dragging
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

      // Check if on track
      const dist = distanceToLine(
        objectX.value,
        objectY.value,
        lineStartX.value,
        lineStartY.value,
        lineEndX.value,
        lineEndY.value
      );

      if (dist > LINE_TOLERANCE) {
        // Off track - warning
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
        // Calculate progress along line
        const totalDist = Math.sqrt(
          Math.pow(lineEndX.value - lineStartX.value, 2) + Math.pow(lineEndY.value - lineStartY.value, 2)
        );
        const currentDist = Math.sqrt(
          Math.pow(objectX.value - lineStartX.value, 2) + Math.pow(objectY.value - lineStartY.value, 2)
        );
        const newProgress = Math.min(1, Math.max(0, currentDist / totalDist));
        setProgress(newProgress);
      }
    })
    .onEnd(() => {
      if (!roundActive || done) return;
      setIsDragging(false);
      objectScale.value = withSpring(1, { damping: 10, stiffness: 200 });

      // Check if reached end
      const distToEnd = Math.sqrt(
        Math.pow(objectX.value - lineEndX.value, 2) + Math.pow(objectY.value - lineEndY.value, 2)
      );

      if (distToEnd <= LINE_TOLERANCE && progress >= 0.8) {
        // Success!
        sparkleX.value = lineEndX.value;
        sparkleY.value = lineEndY.value;

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
              setIsOffTrack(false);
              objectX.value = withSpring(lineStartX.value, { damping: 10, stiffness: 100 });
              objectY.value = withSpring(lineStartY.value, { damping: 10, stiffness: 100 });
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
        // Reset to start
        objectX.value = withSpring(lineStartX.value, { damping: 10, stiffness: 100 });
        objectY.value = withSpring(lineStartY.value, { damping: 10, stiffness: 100 });
        setProgress(0);
        setIsOffTrack(false);

        try {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          speakTTS('Follow the line to the end!', 0.78 );
        } catch {}
      }
    });

  // Initial instruction - only once
  useEffect(() => {
    try {
      speakTTS('Drag the object along the thick line from start to end. Stay on the line!', 0.78 );
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount

  // Initialize line path
  useEffect(() => {
    // Random line direction (horizontal, vertical, or diagonal)
    // Ensure positions are well within bounds to prevent overflow
    const direction = Math.floor(Math.random() * 3);
    if (direction === 0) {
      // Horizontal - ensure markers are visible
      lineStartX.value = 20; // Moved in from edge
      lineStartY.value = 40 + Math.random() * 20;
      lineEndX.value = 80; // Moved in from edge
      lineEndY.value = lineStartY.value;
    } else if (direction === 1) {
      // Vertical - ensure markers are visible
      lineStartX.value = 40 + Math.random() * 20;
      lineStartY.value = 25; // Moved down from top
      lineEndX.value = lineStartX.value;
      lineEndY.value = 75; // Moved up from bottom
    } else {
      // Diagonal - ensure markers are visible
      lineStartX.value = 20; // Moved in from edge
      lineStartY.value = 30;
      lineEndX.value = 80; // Moved in from edge
      lineEndY.value = 70;
    }

    objectX.value = lineStartX.value;
    objectY.value = lineStartY.value;
    setProgress(0);
  }, [round]);

  const handleBack = useCallback(() => {
    stopAllSpeech();
    cleanupSounds();
    onBack?.();
  }, [onBack]);

  // Animated styles
  const objectStyle = useAnimatedStyle(() => ({
    left: `${objectX.value}%`,
    top: `${objectY.value}%`,
    transform: [
      { translateX: -OBJECT_SIZE / 2 },
      { translateY: -OBJECT_SIZE / 2 },
      { scale: objectScale.value },
    ],
  }));

  const lineStyle = useAnimatedStyle(() => {
    const dx = lineEndX.value - lineStartX.value;
    const dy = lineEndY.value - lineStartY.value;
    const angle = Math.atan2(dy, dx) * (180 / Math.PI);
    // Calculate exact distance from START center to END center
    const length = Math.sqrt(dx * dx + dy * dy);
    // Line should be exactly from START marker center to END marker center
    // Ensure it doesn't extend beyond markers
    return {
      left: `${lineStartX.value}%`,
      top: `${lineStartY.value}%`,
      width: `${Math.max(0, length)}%`,
      height: LINE_WIDTH,
      transform: [{ rotate: `${angle}deg` }],
      transformOrigin: 'left center',
    };
  });

  const progressLineStyle = useAnimatedStyle(() => {
    const angle = Math.atan2(
      lineEndY.value - lineStartY.value,
      lineEndX.value - lineStartX.value
    ) * (180 / Math.PI);
    const dx = lineEndX.value - lineStartX.value;
    const dy = lineEndY.value - lineStartY.value;
    const totalLength = Math.sqrt(dx * dx + dy * dy);
    const length = totalLength * progress;
    // Progress line should also be exactly from START to current progress point
    return {
      left: `${lineStartX.value}%`,
      top: `${lineStartY.value}%`,
      width: `${length}%`,
      height: LINE_WIDTH,
      transform: [{ rotate: `${angle}deg` }],
      transformOrigin: 'left center',
    };
  });

  const sparkleStyle = useAnimatedStyle(() => ({
    left: `${sparkleX.value}%`,
    top: `${sparkleY.value}%`,
  }));

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
            <Text style={{ fontSize: 64, marginBottom: 16 }}>📏</Text>
            <Text style={styles.resultTitle}>Line master!</Text>
            <Text style={styles.resultSubtitle}>
              You followed {finalStats.correct} lines perfectly out of {finalStats.total}!
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
                setProgress(0);
                setRoundActive(true);
                objectX.value = lineStartX.value;
                objectY.value = lineStartY.value;
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
        <Text style={styles.title}>Follow The Line</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • 📏 Score: {score}
        </Text>
        <Text style={styles.helper}>
          Drag the object along the thick line from start to end. Stay on the line!
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
            {/* Line path */}
            <Animated.View style={[styles.lineBackground, lineStyle]} />
            <Animated.View style={[styles.lineProgress, progressLineStyle]} />

            {/* Start marker */}
            <View
              style={[
                styles.marker,
                {
                  left: `${lineStartX.value}%`,
                  top: `${lineStartY.value}%`,
                  transform: [{ translateX: -30 }, { translateY: -15 }],
                  zIndex: 5,
                },
              ]}
            >
              <Text style={styles.markerText}>START</Text>
            </View>

            {/* End marker */}
            <View
              style={[
                styles.marker,
                {
                  left: `${lineEndX.value}%`,
                  top: `${lineEndY.value}%`,
                  transform: [{ translateX: -30 }, { translateY: -15 }],
                  backgroundColor: '#22C55E',
                  zIndex: 5,
                },
              ]}
            >
              <Text style={styles.markerText}>END</Text>
            </View>

            {/* Draggable object */}
            <Animated.View style={[styles.objectContainer, objectStyle]}>
              <View
                style={[
                  styles.object,
                  {
                    backgroundColor: isOffTrack ? '#EF4444' : '#3B82F6',
                  },
                ]}
              >
                <Text style={styles.objectEmoji}>🔵</Text>
              </View>
            </Animated.View>

            {/* Sparkle burst on success */}
            {score > 0 && !isDragging && (
              <Animated.View style={[styles.sparkleContainer, sparkleStyle]} pointerEvents="none">
                <SparkleBurst />
              </Animated.View>
            )}

            {/* Warning indicator */}
            {isOffTrack && (
              <View style={styles.warningBox}>
                <Text style={styles.warningText}>Stay on the line! ⚠️</Text>
              </View>
            )}
          </Animated.View>
        </GestureDetector>
      </View>

      <View style={styles.footerBox}>
        <Text style={styles.footerMain}>
          Skills: early tracing precursor • spatial accuracy • hand-eye integration
        </Text>
        <Text style={styles.footerSub}>
          Follow the line carefully! This is the first step toward writing strokes.
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
    position: 'relative',
    marginBottom: 16,
    overflow: 'hidden',
    paddingHorizontal: 20,
    paddingVertical: 30,
  },
  gestureArea: {
    flex: 1,
    position: 'relative',
    width: '100%',
    height: '100%',
  },
  lineBackground: {
    position: 'absolute',
    height: LINE_WIDTH,
    backgroundColor: 'rgba(148, 163, 184, 0.4)',
    borderRadius: LINE_WIDTH / 2,
    transformOrigin: 'left center',
  },
  lineProgress: {
    position: 'absolute',
    height: LINE_WIDTH,
    backgroundColor: '#22C55E',
    borderRadius: LINE_WIDTH / 2,
    transformOrigin: 'left center',
  },
  marker: {
    position: 'absolute',
    width: 60,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#3B82F6',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
    elevation: 5,
  },
  markerText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '800',
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
    fontSize: 40,
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

export default FollowTheLineGame;

