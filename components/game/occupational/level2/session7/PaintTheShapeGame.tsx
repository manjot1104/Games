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
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

const SUCCESS_SOUND = 'https://actions.google.com/sounds/v1/cartoon/balloon_pop.ogg';
const WARNING_SOUND = 'https://actions.google.com/sounds/v1/cartoon/wood_plank_flicks.ogg';
const TOTAL_ROUNDS = 6;
const OBJECT_SIZE = 40;
const LINE_TOLERANCE = 20; // More forgiving
const SHAPE_SIZE = 45;

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

type ShapeType = 'star' | 'heart' | 'pentagon';

const PaintTheShapeGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
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
  const [shapePathStr, setShapePathStr] = useState('');
  const [filledPathStr, setFilledPathStr] = useState('');
  const [currentShape, setCurrentShape] = useState<ShapeType>('star');

  const pathPoints = useRef<Array<{ x: number; y: number }>>([]);

  const objectX = useSharedValue(50);
  const objectY = useSharedValue(50);
  const objectScale = useSharedValue(1);
  const sparkleX = useSharedValue(0);
  const sparkleY = useSharedValue(0);

  const screenWidth = useRef(400);
  const screenHeight = useRef(600);
  const lastWarningTime = useRef(0);
  const lastProgress = useRef(0);

  const generateShape = useCallback((type: ShapeType) => {
    const centerX = 50;
    const centerY = 50;
    const size = SHAPE_SIZE;
    const points: Array<{ x: number; y: number }> = [];

    if (type === 'star') {
      for (let i = 0; i < 5; i++) {
        const angle = (i * 2 * Math.PI) / 5 - Math.PI / 2;
        const radius = size / 2;
        points.push({
          x: centerX + radius * Math.cos(angle),
          y: centerY + radius * Math.sin(angle),
        });
      }
      // Close star path
      const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ') + ' Z';
      setShapePathStr(path);
    } else if (type === 'heart') {
      points.push({ x: centerX, y: centerY + size / 4 });
      points.push({ x: centerX - size / 3, y: centerY - size / 6 });
      points.push({ x: centerX - size / 6, y: centerY - size / 3 });
      points.push({ x: centerX, y: centerY - size / 6 });
      points.push({ x: centerX + size / 6, y: centerY - size / 3 });
      points.push({ x: centerX + size / 3, y: centerY - size / 6 });
      const path = `M ${points[0].x} ${points[0].y} C ${points[1].x} ${points[1].y} ${points[2].x} ${points[2].y} ${points[3].x} ${points[3].y} C ${points[4].x} ${points[4].y} ${points[5].x} ${points[5].y} ${points[0].x} ${points[0].y} Z`;
      setShapePathStr(path);
    } else if (type === 'pentagon') {
      for (let i = 0; i < 5; i++) {
        const angle = (i * 2 * Math.PI) / 5 - Math.PI / 2;
        const radius = size / 2;
        points.push({
          x: centerX + radius * Math.cos(angle),
          y: centerY + radius * Math.sin(angle),
        });
      }
      const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ') + ' Z';
      setShapePathStr(path);
    }

    pathPoints.current = points;
    objectX.value = points[0].x;
    objectY.value = points[0].y;
  }, []);

  const updatePaths = useCallback(() => {
    if (pathPoints.current.length === 0) return;

    if (progress.value > 0) {
      let filledPath = '';
      const numPoints = pathPoints.current.length;
      const pointsToFill = Math.floor(progress.value * numPoints);
      
      if (pointsToFill > 0) {
        filledPath = `M ${pathPoints.current[0].x} ${pathPoints.current[0].y}`;
        for (let i = 1; i <= pointsToFill; i++) {
          const idx = i % numPoints;
          filledPath += ` L ${pathPoints.current[idx].x} ${pathPoints.current[idx].y}`;
        }
        if (progress.value >= 0.95) {
          filledPath += ' Z';
        }
      }
      setFilledPathStr(filledPath);
    } else {
      setFilledPathStr('');
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
          type: 'paintTheShape',
          correct: finalScore,
          total,
          accuracy,
          xpAwarded: xp,
          skillTags: ['whole-arm-movement', 'pre-writing', 'large-shape-tracing'],
        });
        setLogTimestamp(result?.last?.at ?? null);
        router.setParams({ refreshStats: Date.now().toString() });
      } catch (e) {
        console.error('Failed to log paint the shape game:', e);
      }

      speakTTS('Shape painted!', 0.78 );
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

      let minDist = Infinity;
      for (let i = 0; i < pathPoints.current.length; i++) {
        const p1 = pathPoints.current[i];
        const p2 = pathPoints.current[(i + 1) % pathPoints.current.length];
        const dist = distanceToLineSegment(
          objectX.value,
          objectY.value,
          p1.x,
          p1.y,
          p2.x,
          p2.y,
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
        let totalDist = 0;
        const segmentDists: number[] = [];
        for (let i = 0; i < pathPoints.current.length; i++) {
          const p1 = pathPoints.current[i];
          const p2 = pathPoints.current[(i + 1) % pathPoints.current.length];
          const segDist = Math.sqrt(
            Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2),
          );
          segmentDists.push(segDist);
          totalDist += segDist;
        }

        let minDistForProgress = Infinity;
        let bestSegment = 0;
        let bestParam = 0;

        for (let i = 0; i < pathPoints.current.length; i++) {
          const p1 = pathPoints.current[i];
          const p2 = pathPoints.current[(i + 1) % pathPoints.current.length];
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
        const currentProgress = totalDist > 0 ? currentDist / totalDist : 0;
        
        // Only allow clockwise progress - check if actually moving forward
        const progressDiff = currentProgress - lastProgress.current;
        
        // Handle wrap-around: if we're near 0 and last was near 1, we might have wrapped
        if (currentProgress < 0.1 && lastProgress.current > 0.9) {
          // Likely wrapped around - this is valid forward progress
          progress.value = Math.min(1, currentProgress + 1);
          lastProgress.current = currentProgress;
        } else if (progressDiff > -0.05) {
          // Moving forward (or small backward movement within tolerance)
          progress.value = Math.min(1, Math.max(progress.value, currentProgress));
          lastProgress.current = currentProgress;
        }
        // If moving backward significantly, don't update progress
        
        updatePaths();
      }
    })
    .onEnd(() => {
      if (!roundActive || done) return;
      setIsDragging(false);
      objectScale.value = withSpring(1, { damping: 10, stiffness: 200 });

      if (progress.value >= 0.85) {
        sparkleX.value = pathPoints.current[0]?.x || 50;
        sparkleY.value = pathPoints.current[0]?.y || 50;

        setScore(s => {
          const newScore = s + 1;
          if (newScore >= TOTAL_ROUNDS) {
            setTimeout(() => {
              endGame(newScore);
            }, 1000);
          } else {
            setTimeout(() => {
              setRound(r => r + 1);
              const shapes: ShapeType[] = ['star', 'heart', 'pentagon'];
              const nextShape = shapes[Math.floor(Math.random() * shapes.length)];
              setCurrentShape(nextShape);
              generateShape(nextShape);
              progress.value = 0;
              updatePaths();
              setIsOffTrack(false);
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
        progress.value = 0;
        updatePaths();
        setIsOffTrack(false);
        objectX.value = pathPoints.current[0]?.x || 50;
        objectY.value = pathPoints.current[0]?.y || 50;

        try {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          speakTTS('Paint the whole shape!', 0.78 );
        } catch {}
      }
    });

  useEffect(() => {
    try {
      speakTTS('Trace to fill the shape with color!', 0.78 );
    } catch {}
    const shapes: ShapeType[] = ['star', 'heart', 'pentagon'];
    const shape = shapes[Math.floor(Math.random() * shapes.length)];
    setCurrentShape(shape);
    generateShape(shape);
    progress.value = 0;
    lastProgress.current = 0;
    updatePaths();
    
    return () => {
      stopAllSpeech();
      cleanupSounds();
    };
  }, [round, generateShape, updatePaths]);

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
            <Text style={{ fontSize: 64, marginBottom: 16 }}>🎨</Text>
            <Text style={styles.resultTitle}>Shape Painted!</Text>
            <Text style={styles.resultSubtitle}>
              You painted {finalStats.correct} shapes out of {finalStats.total}!
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
        <Text style={styles.title}>Paint the Shape</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • 🎨 Score: {score}
        </Text>
        <Text style={styles.helper}>
          Trace to fill the shape with color!
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
                d={shapePathStr}
                stroke="rgba(148, 163, 184, 0.5)"
                strokeWidth="3"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {filledPathStr ? (
                <Path
                  d={filledPathStr}
                  fill={progress.value >= 0.95 ? '#EC4899' : 'rgba(236, 72, 153, 0.3)'}
                  stroke="#EC4899"
                  strokeWidth="3"
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
                    backgroundColor: isOffTrack ? '#EF4444' : '#EC4899',
                  },
                ]}
              >
                <Text style={styles.objectEmoji}>🖌️</Text>
              </View>
            </Animated.View>

            {score > 0 && !isDragging && (
              <Animated.View style={[styles.sparkleContainer, sparkleStyle]} pointerEvents="none">
                <SparkleBurst />
              </Animated.View>
            )}

            {isOffTrack && (
              <View style={styles.warningBox}>
                <Text style={styles.warningText}>Stay on the shape! ⚠️</Text>
              </View>
            )}
          </Animated.View>
        </GestureDetector>
      </View>

      <View style={styles.footerBox}>
        <Text style={styles.footerMain}>
          Skills: whole-arm movement • pre-writing • shape filling
        </Text>
        <Text style={styles.footerSub}>
          Trace the shape to fill it with color!
        </Text>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FDF2F8',
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
    fontSize: 24,
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

export default PaintTheShapeGame;

