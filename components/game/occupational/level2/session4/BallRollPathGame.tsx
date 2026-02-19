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
import Svg, { Path } from 'react-native-svg';

const SUCCESS_SOUND = 'https://actions.google.com/sounds/v1/cartoon/balloon_pop.ogg';
const WARNING_SOUND = 'https://actions.google.com/sounds/v1/cartoon/wood_plank_flicks.ogg';
const TOTAL_ROUNDS = 6;
const OBJECT_SIZE = 40;
const PATH_WIDTH = 18;
const LINE_TOLERANCE = PATH_WIDTH / 2;

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

const distanceToLineSegment = (
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
) => {
  const A = px - x1;
  const B = py - y1;
  const C = x2 - x1;
  const D = y2 - y1;
  const dot = A * C + B * D;
  const lenSq = C * C + D * D;
  if (lenSq === 0) return Math.sqrt((px - x1) ** 2 + (py - y1) ** 2);
  const param = Math.max(0, Math.min(1, dot / lenSq));
  const xx = x1 + param * C;
  const yy = y1 + param * D;
  return Math.sqrt((px - xx) ** 2 + (py - yy) ** 2);
};

const BallRollPathGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
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
  const [pathStr, setPathStr] = useState('');
  const [progressPathStr, setProgressPathStr] = useState('');
  const rotation = useSharedValue(0);

  const pathPoints = useRef<Array<{ x: number; y: number }>>([]);

  const objectX = useSharedValue(20);
  const objectY = useSharedValue(70);
  const objectScale = useSharedValue(1);
  const sparkleX = useSharedValue(0);
  const sparkleY = useSharedValue(0);
  const lastX = useSharedValue(20);
  const lastY = useSharedValue(70);

  const screenWidth = useRef(400);
  const screenHeight = useRef(600);
  const lastWarningTime = useRef(0);

  const updatePaths = useCallback(() => {
    if (pathPoints.current.length === 0) return;

    let path = `M ${pathPoints.current[0].x} ${pathPoints.current[0].y}`;
    for (let i = 1; i < pathPoints.current.length; i++) {
      path += ` L ${pathPoints.current[i].x} ${pathPoints.current[i].y}`;
    }
    setPathStr(path);

    if (progress.value > 0) {
      // If progress is >= 0.99, draw the complete path including last point
      // This ensures last part is covered with color when path is complete
      if (progress.value >= 0.99) {
        let progressPath = `M ${pathPoints.current[0].x} ${pathPoints.current[0].y}`;
        for (let i = 1; i < pathPoints.current.length; i++) {
          progressPath += ` L ${pathPoints.current[i].x} ${pathPoints.current[i].y}`;
        }
        setProgressPathStr(progressPath);
      } else {
        // Draw partial path based on progress
        const totalSegments = pathPoints.current.length - 1;
        const progressSegment = Math.floor(progress.value * totalSegments);
        const segmentProgress = (progress.value * totalSegments) - progressSegment;
        const clampedSegment = Math.min(progressSegment, totalSegments - 1);

        let progressPath = `M ${pathPoints.current[0].x} ${pathPoints.current[0].y}`;
        for (let i = 1; i <= clampedSegment; i++) {
          progressPath += ` L ${pathPoints.current[i].x} ${pathPoints.current[i].y}`;
        }

        if (segmentProgress > 0 && clampedSegment < totalSegments) {
          const startPt = pathPoints.current[clampedSegment];
          const endPt = pathPoints.current[clampedSegment + 1];
          const x = startPt.x + (endPt.x - startPt.x) * segmentProgress;
          const y = startPt.y + (endPt.y - startPt.y) * segmentProgress;
          progressPath += ` L ${x} ${y}`;
        }
        setProgressPathStr(progressPath);
      }
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
          type: 'ballRollPath',
          correct: finalScore,
          total,
          accuracy,
          xpAwarded: xp,
          skillTags: ['continuous-tracking', 'sustained-attention', 'drag-control'],
        });
        setLogTimestamp(result?.last?.at ?? null);
        router.setParams({ refreshStats: Date.now().toString() });
      } catch (e) {
        console.error('Failed to log ball roll path game:', e);
      }

      speakTTS('Ball rolled perfectly!', 0.78 );
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

      // Calculate rotation based on movement direction
      const dx = newX - lastX.value;
      const dy = newY - lastY.value;
      if (Math.abs(dx) > 0.1 || Math.abs(dy) > 0.1) {
        rotation.value = Math.atan2(dy, dx) * (180 / Math.PI);
      }

      objectX.value = Math.max(5, Math.min(95, newX));
      objectY.value = Math.max(10, Math.min(90, newY));

      lastX.value = newX;
      lastY.value = newY;

      // Check distance to path
      let minDist = Infinity;
      for (let i = 0; i < pathPoints.current.length - 1; i++) {
        const dist = distanceToLineSegment(
          objectX.value,
          objectY.value,
          pathPoints.current[i].x,
          pathPoints.current[i].y,
          pathPoints.current[i + 1].x,
          pathPoints.current[i + 1].y,
        );
        if (dist < minDist) minDist = dist;
      }

      if (minDist > LINE_TOLERANCE) {
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
        // Update progress
        let totalDist = 0;
        const segmentDists: number[] = [];
        for (let i = 0; i < pathPoints.current.length - 1; i++) {
          const segDist = Math.sqrt(
            Math.pow(pathPoints.current[i + 1].x - pathPoints.current[i].x, 2) +
            Math.pow(pathPoints.current[i + 1].y - pathPoints.current[i].y, 2),
          );
          segmentDists.push(segDist);
          totalDist += segDist;
        }

        let minDistForProgress = Infinity;
        let bestSegment = 0;
        let bestParam = 0;

        for (let i = 0; i < pathPoints.current.length - 1; i++) {
          const p1 = pathPoints.current[i];
          const p2 = pathPoints.current[i + 1];
          const dx = p2.x - p1.x;
          const dy = p2.y - p1.y;
          const lenSq = dx * dx + dy * dy;
          
          if (lenSq === 0) continue;
          
          const t = Math.max(0, Math.min(1, 
            ((objectX.value - p1.x) * dx + (objectY.value - p1.y) * dy) / lenSq
          ));
          
          const closestX = p1.x + t * dx;
          const closestY = p1.y + t * dy;
          const dist = Math.sqrt(
            Math.pow(objectX.value - closestX, 2) +
            Math.pow(objectY.value - closestY, 2)
          );
          
          if (dist < minDistForProgress) {
            minDistForProgress = dist;
            bestSegment = i;
            bestParam = t;
          }
        }

        const segStartDist = segmentDists.slice(0, bestSegment).reduce((a, b) => a + b, 0);
        const distAlongSeg = segmentDists[bestSegment] * bestParam;
        const currentDist = segStartDist + distAlongSeg;
        let calculatedProgress = totalDist > 0 ? Math.min(1, currentDist / totalDist) : 0;
        
        // Check if user has reached end point - set progress to 1.0
        const lastPoint = pathPoints.current[pathPoints.current.length - 1];
        const distToEnd = Math.sqrt(
          Math.pow(objectX.value - lastPoint.x, 2) + Math.pow(objectY.value - lastPoint.y, 2),
        );
        
        let newProgress = calculatedProgress;
        // If close to end point, ensure progress reaches 1.0 to complete path coloring
        if (distToEnd <= LINE_TOLERANCE) {
          newProgress = 1.0;
        }
        
        // Always monotonic - only increase progress
        newProgress = Math.max(progress.value, newProgress);
        
        if (newProgress > progress.value) {
          progress.value = newProgress;
          updatePaths();
        }
      }
    })
    .onEnd(() => {
      if (!roundActive || done) return;
      setIsDragging(false);
      objectScale.value = withSpring(1, { damping: 10, stiffness: 200 });

      const lastPoint = pathPoints.current[pathPoints.current.length - 1];
      const distToEnd = Math.sqrt(
        Math.pow(objectX.value - lastPoint.x, 2) + Math.pow(objectY.value - lastPoint.y, 2),
      );

      if (distToEnd <= LINE_TOLERANCE * 2 && progress.value >= 0.75) {
        sparkleX.value = lastPoint.x;
        sparkleY.value = lastPoint.y;

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
              const firstPoint = pathPoints.current[0];
              objectX.value = withSpring(firstPoint.x, { damping: 10, stiffness: 100 });
              objectY.value = withSpring(firstPoint.y, { damping: 10, stiffness: 100 });
              lastX.value = firstPoint.x;
              lastY.value = firstPoint.y;
              rotation.value = 0;
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
        const firstPoint = pathPoints.current[0];
        objectX.value = withSpring(firstPoint.x, { damping: 10, stiffness: 100 });
        objectY.value = withSpring(firstPoint.y, { damping: 10, stiffness: 100 });
        lastX.value = firstPoint.x;
        lastY.value = firstPoint.y;
        rotation.value = 0;
        progress.value = 0;
        updatePaths();
        setIsOffTrack(false);

        try {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          speakTTS('Roll the ball along the path!', 0.78 );
        } catch {}
      }
    });

  useEffect(() => {
    try {
      speakTTS('Roll the ball along the path! Drag to control the ball\'s movement.', 0.78 );
    } catch {}
    // Generate curved rolling path
    const points: Array<{ x: number; y: number }> = [];
    const startX = 20;
    const startY = 70;
    const endX = 80;
    const endY = 30;

    points.push({ x: startX, y: startY });
    // Smooth curved path
    for (let i = 1; i < 6; i++) {
      const t = i / 6;
      const x = startX + (endX - startX) * t;
      const y = startY + (endY - startY) * t + Math.sin(t * Math.PI) * 10;
      points.push({ x, y });
    }
    points.push({ x: endX, y: endY });

    pathPoints.current = points;
    objectX.value = startX;
    objectY.value = startY;
    lastX.value = startX;
    lastY.value = startY;
    rotation.value = 0;
    progress.value = 0;
    updatePaths();
    
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
      { rotate: `${rotation.value}deg` },
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
            <Text style={{ fontSize: 64, marginBottom: 16 }}>⚽</Text>
            <Text style={styles.resultTitle}>Ball Rolled!</Text>
            <Text style={styles.resultSubtitle}>
              You rolled {finalStats.correct} balls out of {finalStats.total}!
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
        <Text style={styles.title}>Ball Roll Path</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • ⚽ Score: {score}
        </Text>
        <Text style={styles.helper}>
          Roll the ball along the path! Drag to control the ball's movement.
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
                d={pathStr}
                stroke="rgba(107, 114, 128, 0.3)"
                strokeWidth={PATH_WIDTH}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {progressPathStr ? (
                <Path
                  d={progressPathStr}
                  stroke="#F59E0B"
                  strokeWidth={PATH_WIDTH}
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ) : null}
            </Svg>

            <Animated.View style={[styles.objectContainer, objectStyle]}>
              <View
                style={[
                  styles.object,
                  {
                    backgroundColor: isOffTrack ? '#EF4444' : '#F59E0B',
                  },
                ]}
              >
                <Text style={styles.objectEmoji}>⚽</Text>
              </View>
            </Animated.View>

            {score > 0 && !isDragging && (
              <Animated.View style={[styles.sparkleContainer, sparkleStyle]} pointerEvents="none">
                <SparkleBurst />
              </Animated.View>
            )}

            {isOffTrack && (
              <View style={styles.warningBox}>
                <Text style={styles.warningText}>Stay on the path! ⚠️</Text>
              </View>
            )}
          </Animated.View>
        </GestureDetector>
      </View>

      <View style={styles.footerBox}>
        <Text style={styles.footerMain}>
          Skills: continuous tracking • sustained attention • drag control
        </Text>
        <Text style={styles.footerSub}>
          Roll the ball along the curved path!
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
    fontSize: 26,
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

export default BallRollPathGame;

