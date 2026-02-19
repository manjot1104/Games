import { logGameAndAward, recordGame } from '@/utils/api';
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
import Svg, { Circle } from 'react-native-svg';
import { SparkleBurst } from '@/components/game/FX';
import ResultCard from '@/components/game/ResultCard';

const SUCCESS_SOUND = 'https://actions.google.com/sounds/v1/cartoon/balloon_pop.ogg';
const WARNING_SOUND = 'https://actions.google.com/sounds/v1/cartoon/wood_plank_flicks.ogg';
const TOTAL_ROUNDS = 6;
const OBJECT_SIZE = 35;
const DOT_SPACING = 8;
const LINE_TOLERANCE = 12;

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

const AntTrailFollowGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
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
  const [hasGoneOffTrack, setHasGoneOffTrack] = useState(false);
  const progress = useSharedValue(0);
  const [trailDots, setTrailDots] = useState<Array<{ x: number; y: number }>>([]);

  const pathPoints = useRef<Array<{ x: number; y: number }>>([]);
  const hasGoneOffTrackRef = useRef(false); // Track if user ever went off track

  const objectX = useSharedValue(20);
  const objectY = useSharedValue(50);
  const objectScale = useSharedValue(1);
  const sparkleX = useSharedValue(0);
  const sparkleY = useSharedValue(0);

  const screenWidth = useRef(400);
  const screenHeight = useRef(600);
  const lastWarningTime = useRef(0);

  const generateTrailDots = useCallback(() => {
    const dots: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < pathPoints.current.length - 1; i++) {
      const p1 = pathPoints.current[i];
      const p2 = pathPoints.current[i + 1];
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const numDots = Math.floor(dist / DOT_SPACING);
      
      for (let j = 0; j < numDots; j++) {
        const t = j / numDots;
        dots.push({
          x: p1.x + dx * t,
          y: p1.y + dy * t,
        });
      }
    }
    // Add last point
    if (pathPoints.current.length > 0) {
      dots.push(pathPoints.current[pathPoints.current.length - 1]);
    }
    setTrailDots(dots);
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
          type: 'antTrailFollow',
          correct: finalScore,
          total,
          accuracy,
          xpAwarded: xp,
          skillTags: ['continuous-tracking', 'sustained-attention', 'dotted-trail'],
        });
        setLogTimestamp(result?.last?.at ?? null);
        router.setParams({ refreshStats: Date.now().toString() });
      } catch (e) {
        console.error('Failed to log ant trail follow game:', e);
      }

      speakTTS('Ant trail followed!', 0.78 );
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

      // Check distance to trail
      let minDist = Infinity;
      for (const dot of trailDots) {
        const dist = Math.sqrt(
          Math.pow(objectX.value - dot.x, 2) + Math.pow(objectY.value - dot.y, 2),
        );
        if (dist < minDist) minDist = dist;
      }

      if (minDist > LINE_TOLERANCE) {
        if (!isOffTrack) {
          setIsOffTrack(true);
          setHasGoneOffTrack(true);
          hasGoneOffTrackRef.current = true; // Mark as off track
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
        const newProgress = totalDist > 0 ? Math.min(1, Math.max(progress.value, currentDist / totalDist)) : 0;
        
        if (newProgress > progress.value) {
          progress.value = newProgress;
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

      // Only complete if reached end point, have sufficient progress, AND never went off track
      if (distToEnd <= LINE_TOLERANCE * 2 && progress.value >= 0.75 && !hasGoneOffTrackRef.current) {
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
              setIsOffTrack(false);
              setHasGoneOffTrack(false);
              hasGoneOffTrackRef.current = false; // Reset for new round
              const firstPoint = pathPoints.current[0];
              objectX.value = withSpring(firstPoint.x, { damping: 10, stiffness: 100 });
              objectY.value = withSpring(firstPoint.y, { damping: 10, stiffness: 100 });
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
        progress.value = 0;
        setIsOffTrack(false);
        setHasGoneOffTrack(false);
        hasGoneOffTrackRef.current = false; // Reset for retry

        try {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          speakTTS('Stay on the dotted trail!', 0.78 );
        } catch {}
      }
    });

  useEffect(() => {
    try {
      speakTTS('Follow the dotted trail! Stay on the path made of dots.', 0.78 );
    } catch {}
    // Generate wavy trail path
    const points: Array<{ x: number; y: number }> = [];
    const startX = 20;
    const startY = 50;
    const endX = 80;
    const endY = 50;

    points.push({ x: startX, y: startY });
    // Wavy trail
    for (let i = 1; i < 8; i++) {
      const t = i / 8;
      const x = startX + (endX - startX) * t;
      const y = startY + Math.sin(t * Math.PI * 3) * 15;
      points.push({ x, y });
    }
    points.push({ x: endX, y: endY });

    pathPoints.current = points;
    objectX.value = startX;
    objectY.value = startY;
    progress.value = 0;
    setIsOffTrack(false);
    setHasGoneOffTrack(false);
    hasGoneOffTrackRef.current = false; // Reset for new round
    generateTrailDots();
  }, [round, generateTrailDots]);

  const handleBack = useCallback(() => {
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
            <Text style={{ fontSize: 64, marginBottom: 16 }}>🐜</Text>
            <Text style={styles.resultTitle}>Trail Followed!</Text>
            <Text style={styles.resultSubtitle}>
              You followed {finalStats.correct} trails out of {finalStats.total}!
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
                setHasGoneOffTrack(false);
                hasGoneOffTrackRef.current = false; // Reset for restart
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
        <Text style={styles.title}>Ant Trail Follow</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • 🐜 Score: {score}
        </Text>
        <Text style={styles.helper}>
          Follow the dotted trail! Stay on the path made of dots.
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
              {trailDots.map((dot, idx) => (
                <Circle
                  key={idx}
                  cx={dot.x}
                  cy={dot.y}
                  r="2"
                  fill="#8B5CF6"
                  opacity={0.6}
                />
              ))}
            </Svg>

            <Animated.View style={[styles.objectContainer, objectStyle]}>
              <View
                style={[
                  styles.object,
                  {
                    backgroundColor: isOffTrack ? '#EF4444' : '#8B5CF6',
                  },
                ]}
              >
                <Text style={styles.objectEmoji}>🐜</Text>
              </View>
            </Animated.View>

            {score > 0 && !isDragging && (
              <Animated.View style={[styles.sparkleContainer, sparkleStyle]} pointerEvents="none">
                <SparkleBurst />
              </Animated.View>
            )}

            {isOffTrack && (
              <View style={styles.warningBox}>
                <Text style={styles.warningText}>Stay on the trail! ⚠️</Text>
              </View>
            )}
          </Animated.View>
        </GestureDetector>
      </View>

      <View style={styles.footerBox}>
        <Text style={styles.footerMain}>
          Skills: continuous tracking • sustained attention • dotted trail
        </Text>
        <Text style={styles.footerSub}>
          Follow the dotted ant trail carefully!
        </Text>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FAF5FF',
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

export default AntTrailFollowGame;

